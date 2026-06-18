import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Indexer, type EmbedBatchFn } from './indexer.js';
import { MemoryIndex } from './store.js';

// Deterministic fake embedder (dims=3) that counts calls + tokens, so we can
// assert exactly which chunks were re-embedded.
function fakeEmbed(): EmbedBatchFn & { calls: number; embedded: number } {
    const fn = (async (texts: string[]) => {
        fn.calls++;
        fn.embedded += texts.length;
        return {
            vectors: texts.map((t) => [t.length, t.charCodeAt(0) || 0, 1]),
            tokens: Math.ceil(texts.reduce((s, t) => s + t.length, 0) / 4),
        };
    }) as EmbedBatchFn & { calls: number; embedded: number };
    fn.calls = 0;
    fn.embedded = 0;
    return fn;
}

describe('Indexer', () => {
    let root: string;
    let knowledge: string;
    let dir: string;
    let embed: ReturnType<typeof fakeEmbed>;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'memindexer-'));
        knowledge = path.join(root, 'knowledge');
        dir = path.join(root, 'index');
        fs.mkdirSync(knowledge, { recursive: true });
        embed = fakeEmbed();
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    function makeIndexer(model = 'm') {
        return new Indexer({
            dir,
            knowledgeDir: knowledge,
            model,
            dimsHint: 3,
            batchSize: 64,
            maxMonthlyEmbedTokens: 0,
            embed,
        });
    }

    const note = (a: string, b: string) => `# Title\n\n## A\n\n${a}\n\n## B\n\n${b}\n`;

    it('embeds all chunks on first build and is a no-op when unchanged', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha text', 'beta text'));
        const s1 = await makeIndexer().run(Date.now());
        expect(s1.filesProcessed).toBe(1);
        expect(s1.chunksNew).toBeGreaterThanOrEqual(2);
        expect(s1.chunkCount).toBe(s1.chunksNew);

        embed.calls = 0;
        const s2 = await makeIndexer().run(Date.now());
        expect(s2.filesProcessed).toBe(0); // unchanged → no work
        expect(embed.calls).toBe(0);
    });

    it('re-embeds ONLY the changed chunk on an edit (incremental)', async () => {
        const p = path.join(knowledge, 'n.md');
        fs.writeFileSync(p, note('alpha text', 'beta text'));
        const s1 = await makeIndexer().run(Date.now());
        const total = s1.chunksNew;

        // Edit only section A.
        fs.writeFileSync(p, note('alpha text CHANGED', 'beta text'));
        embed.embedded = 0;
        const s2 = await makeIndexer().run(Date.now());
        expect(s2.filesProcessed).toBe(1);
        expect(s2.chunksNew).toBe(1); // only section A re-embedded
        expect(s2.chunksReused).toBe(total - 1); // the rest reused
        expect(embed.embedded).toBe(1);
    });

    it('drops chunks for a deleted note', async () => {
        const p = path.join(knowledge, 'n.md');
        fs.writeFileSync(p, note('a', 'b'));
        await makeIndexer().run(Date.now());
        fs.rmSync(p);
        const s = await makeIndexer().run(Date.now());
        expect(s.chunksDeleted).toBe(1);
        expect(s.chunkCount).toBe(0);
    });

    it('full-rebuilds on a model change (vectors incomparable)', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('a', 'b'));
        await makeIndexer('model-a').run(Date.now());
        expect(MemoryIndex.needsRebuild(dir, 'model-b', 3)).toBe(true);

        embed.embedded = 0;
        const s = await makeIndexer('model-b').run(Date.now());
        expect(s.rebuilt).toBe(true);
        expect(s.chunksReused).toBe(0); // nothing reused across models
        expect(s.chunksNew).toBeGreaterThanOrEqual(2);
        expect(embed.embedded).toBe(s.chunksNew);
        const idx = MemoryIndex.open(dir, 'model-b', 3);
        expect(idx.model()).toBe('model-b');
    });

    it('full-rebuilds when the persisted store is corrupt (manifest ⟂ vectors)', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha text', 'beta text'));
        const s1 = await makeIndexer().run(Date.now());
        expect(s1.rebuilt).toBe(false);
        const total = s1.chunksNew;

        // Corrupt the store: truncate vectors.bin to header-only (0 records) while
        // the manifest still lists `total` chunks — a crash-mid-write footprint.
        fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.alloc(8));
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(false);

        // Next pass: no file changed, but the indexer must notice the inconsistency
        // and rebuild from scratch rather than serving a broken index.
        embed.embedded = 0;
        const s2 = await makeIndexer().run(Date.now());
        expect(s2.rebuilt).toBe(true);
        expect(s2.chunksReused).toBe(0); // corruption forces a clean re-embed
        expect(s2.chunksNew).toBe(total);
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(true); // healed
    });

    it('pauses when the monthly embed-token cap is already exhausted', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha', 'beta'));
        // Pre-seed this month's usage over the cap (cap hit on a prior run).
        const now = Date.UTC(2026, 5, 15); // 2026-06-15
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'embed_usage.json'), JSON.stringify({ month: '2026-06', tokens: 100 }));
        const indexer = new Indexer({
            dir,
            knowledgeDir: knowledge,
            model: 'm',
            dimsHint: 3,
            batchSize: 64,
            maxMonthlyEmbedTokens: 50, // already exceeded
            embed,
        });
        const s = await indexer.run(now);
        expect(s.paused).toBe(true);
        expect(embed.embedded).toBe(0); // nothing embedded once exhausted
    });

    it('infers dims from an embedding probe when there is no hint or known model', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha', 'beta'));
        const indexer = new Indexer({
            dir,
            knowledgeDir: knowledge,
            model: 'some-custom-model', // not in the KNOWN_DIMS table
            dimsHint: 0, // → must probe
            batchSize: 64,
            maxMonthlyEmbedTokens: 0,
            embed,
        });
        const s = await indexer.run(Date.now());
        expect(s.filesProcessed).toBe(1);
        expect(MemoryIndex.readDims(dir)).toBe(3); // fakeEmbed returns 3-dim vectors
    });

    it('uses the KNOWN_DIMS table (no probe) for a well-known model', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha', 'beta'));
        const indexer = new Indexer({
            dir,
            knowledgeDir: knowledge,
            model: 'text-embedding-3-small', // in the KNOWN_DIMS table → 1536
            dimsHint: 0,
            batchSize: 64,
            maxMonthlyEmbedTokens: 0,
            embed,
        });
        await indexer.run(Date.now());
        expect(MemoryIndex.readDims(dir)).toBe(1536); // resolved from the table, not a probe
    });

    it('batches embeds according to batchSize', async () => {
        // note() yields 3 chunks (Title, A, B); batchSize 2 → ceil(3/2) = 2 embed calls.
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha', 'beta'));
        const indexer = new Indexer({
            dir,
            knowledgeDir: knowledge,
            model: 'm',
            dimsHint: 3,
            batchSize: 2,
            maxMonthlyEmbedTokens: 0,
            embed,
        });
        await indexer.run(Date.now());
        expect(embed.calls).toBe(2);
    });

    it('walks nested directories and ignores non-markdown files', async () => {
        fs.writeFileSync(path.join(knowledge, 'a.md'), note('a', 'b'));
        fs.mkdirSync(path.join(knowledge, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(knowledge, 'sub', 'b.md'), note('c', 'd'));
        fs.writeFileSync(path.join(knowledge, 'notes.txt'), 'not markdown');
        const s = await makeIndexer().run(Date.now());
        expect(s.filesProcessed).toBe(2); // a.md + sub/b.md; notes.txt ignored
    });

    it('is a clean no-op on an empty vault when a dims hint is present', async () => {
        const s = await makeIndexer().run(Date.now());
        expect(s.filesProcessed).toBe(0);
        expect(s.chunkCount).toBe(0);
        expect(s.paused).toBe(false);
        expect(embed.calls).toBe(0);
    });

    it('persists monthly token usage to embed_usage.json', async () => {
        fs.writeFileSync(path.join(knowledge, 'n.md'), note('alpha', 'beta'));
        await makeIndexer().run(Date.UTC(2026, 5, 20)); // 2026-06
        const usage = JSON.parse(fs.readFileSync(path.join(dir, 'embed_usage.json'), 'utf-8'));
        expect(usage.month).toBe('2026-06');
        expect(usage.tokens).toBeGreaterThan(0);
    });
});
