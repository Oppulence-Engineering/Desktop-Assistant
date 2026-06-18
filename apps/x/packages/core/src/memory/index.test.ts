import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Isolate WorkDir to a temp dir, capture analytics, and replace the embedder with
// a deterministic 3-dim fake so the façade can be exercised end-to-end offline.
const TEST_WORKDIR = vi.hoisted(() => '/tmp/rowboat-mem-index-test');
const { captureSpy } = vi.hoisted(() => ({ captureSpy: vi.fn() }));

vi.mock('../config/config.js', async (io) => ({
    ...(await io<typeof import('../config/config.js')>()),
    WorkDir: TEST_WORKDIR,
}));
vi.mock('../analytics/posthog.js', async (io) => ({
    ...(await io<typeof import('../analytics/posthog.js')>()),
    capture: captureSpy,
}));
vi.mock('./embed.js', () => ({
    resolveEmbedTarget: async (model: string) => ({ metered: false, providerConfig: { flavor: 'openai' }, model }),
    embedBatch: async (_t: unknown, texts: string[]) => ({
        vectors: texts.map((t) => [t.length, t.charCodeAt(0) || 0, 1]),
        tokens: texts.length,
    }),
}));

import { memorySearch, runMemoryIndex, memoryStatus, relatedNotes } from './index.js';

const savedEnv = { ...process.env };

beforeEach(() => {
    fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_WORKDIR, 'knowledge'), { recursive: true });
    fs.mkdirSync(path.join(TEST_WORKDIR, 'config'), { recursive: true });
    delete process.env.SOLOMON_MEMORY_ENABLED;
    delete process.env.SOLOMON_MEMORY_MODEL;
    captureSpy.mockClear();
});
afterEach(() => {
    fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
    process.env = { ...savedEnv };
});

describe('runMemoryIndex', () => {
    it('returns { disabled: true } when the index is disabled', async () => {
        process.env.SOLOMON_MEMORY_ENABLED = 'false';
        await expect(runMemoryIndex()).resolves.toEqual({ disabled: true });
        expect(captureSpy).not.toHaveBeenCalled();
    });

    it('is single-flighted (overlapping calls share one in-flight pass)', () => {
        process.env.SOLOMON_MEMORY_ENABLED = 'false';
        const a = runMemoryIndex();
        const b = runMemoryIndex();
        expect(a).toBe(b); // same promise — not a second racing indexer
        return Promise.all([a, b]);
    });
});

describe('memorySearch', () => {
    it('returns a lexical fallback (no results) when disabled over an empty vault', async () => {
        process.env.SOLOMON_MEMORY_ENABLED = 'false';
        const res = await memorySearch('anything', { k: 5 });
        expect(res.mode).toBe('lexical_fallback');
        expect(res.results).toEqual([]);
    });

    it('falls back to lexical when enabled but no index has been built yet', async () => {
        // enabled (default) but indexDir has no manifest → persisted is null → grep.
        const res = await memorySearch('acme overdue', { k: 5 });
        expect(res.mode).toBe('lexical_fallback');
        expect(res.results).toEqual([]); // empty knowledge dir → no grep matches
    });
});

describe('façade end-to-end', () => {
    it('indexes a note, emits analytics, then finds it via hybrid search', async () => {
        // A custom (non-KNOWN_DIMS) model forces a dims probe → dims = 3 throughout.
        process.env.SOLOMON_MEMORY_MODEL = 'custom-test-model';
        fs.writeFileSync(path.join(TEST_WORKDIR, 'knowledge', 'Acme.md'), '# Acme\n\nAcme overdue AR balance is high.');

        const stats = await runMemoryIndex();
        expect('disabled' in stats).toBe(false);
        if (!('disabled' in stats)) {
            expect(stats.filesProcessed).toBe(1);
            expect(stats.chunkCount).toBeGreaterThan(0);
        }
        // Analytics fired for a pass that did real work.
        expect(captureSpy).toHaveBeenCalledWith('memory_index_built', expect.objectContaining({ files_processed: 1 }));

        const res = await memorySearch('Acme overdue AR', { k: 5 });
        expect(res.mode).toBe('hybrid');
        expect(res.results[0].path).toBe('Acme.md');
        expect(res.results[0].backlink).toContain('Acme.md#');
    });

    it('exposes memoryStatus and relatedNotes after indexing', async () => {
        process.env.SOLOMON_MEMORY_MODEL = 'custom-test-model'; // probe → dims 3
        fs.writeFileSync(path.join(TEST_WORKDIR, 'knowledge', 'Acme.md'), '# Acme\n\nAcme overdue accounts receivable balance.');
        fs.writeFileSync(path.join(TEST_WORKDIR, 'knowledge', 'Followup.md'), '# Followup\n\nAcme dunning reminder for the overdue balance.');
        await runMemoryIndex();

        const status = memoryStatus();
        expect(status.enabled).toBe(true);
        expect(status.chunkCount).toBeGreaterThanOrEqual(2);
        expect(status.lastBuiltMs).toBeGreaterThan(0);

        const related = relatedNotes('Acme.md', 5);
        expect(related.length).toBeGreaterThan(0);
        expect(related.map((r) => r.path)).not.toContain('Acme.md'); // excludes self
        expect(related.every((r) => typeof r.score === 'number')).toBe(true);
    });
});
