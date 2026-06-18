import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryIndex, type IndexChunk, type CorpusEntry } from './store.js';
import { Retriever, reciprocalRankFusion } from './retriever.js';
import type { SearchResult } from './types.js';

function entry(p: string, anchor: string, start: number, text: string): CorpusEntry {
    return {
        vectorId: start,
        meta: { path: p, headingAnchor: anchor, contentHash: 'h', startLine: start, endLine: start + 1 },
        text,
    };
}

function chunk(p: string, anchor: string, vec: number[], text: string): IndexChunk {
    return { meta: { path: p, headingAnchor: anchor, contentHash: anchor, startLine: 1, endLine: 2 }, vec, text };
}

describe('reciprocalRankFusion', () => {
    it('ranks an item appearing high in both lists above singletons', () => {
        const a = entry('a.md', 'h1', 1, 'alpha');
        const b = entry('b.md', 'h1', 1, 'beta');
        const c = entry('c.md', 'h1', 1, 'gamma');
        const vector = [a, b]; // a rank0, b rank1
        const lexical = [a, c]; // a rank0, c rank1
        const fused = reciprocalRankFusion([vector, lexical]);
        expect(fused[0].entry.meta.path).toBe('a.md'); // present in both → highest
        expect(fused[0].score).toBeGreaterThan(fused[1].score); // scores are carried + ordered
        expect(fused.map((e) => e.entry.meta.path)).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('dedups a chunk present in both lists and sums its score', () => {
        const a = entry('a.md', 'h1', 1, 'alpha');
        const fused = reciprocalRankFusion([[a], [a]]); // same chunk, rank 0 in both
        expect(fused).toHaveLength(1);
        expect(fused[0].score).toBeCloseTo(2 / 61, 10); // 1/(60+1) + 1/(60+1)
    });
});

describe('Retriever', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const grep = async (): Promise<SearchResult[]> => [
        { path: 'grep.md', headingAnchor: 'x', backlink: 'grep.md#x', snippet: 'from grep', score: 0, startLine: 1, endLine: 1 },
    ];

    it('hybrid search fuses vector + lexical and returns backlinks', async () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('Acme.md', 'm', 'h', [
            chunk('Acme.md', 'h1-ar', [1, 0, 0], 'Acme overdue AR balance is high'),
            chunk('Other.md', 'h1-z', [0, 0, 1], 'unrelated content'),
        ]);
        const embedQuery = async () => [1, 0, 0]; // points at the AR chunk
        const r = new Retriever(idx, embedQuery, grep);
        const res = await r.search('overdue AR for Acme', { k: 5 });
        expect(res.mode).toBe('hybrid');
        expect(res.results[0].path).toBe('Acme.md');
        expect(res.results[0].backlink).toBe('Acme.md#h1-ar');
    });

    it('falls back to lexical ranking when embeddings fail', async () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('Acme.md', 'm', 'h', [chunk('Acme.md', 'h1-ar', [1, 0, 0], 'Acme overdue AR balance')]);
        const embedQuery = async (): Promise<number[]> => {
            throw new Error('embeddings down');
        };
        const r = new Retriever(idx, embedQuery, grep);
        const res = await r.search('Acme AR', { k: 5 });
        expect(res.mode).toBe('lexical_fallback');
        expect(res.results[0].path).toBe('Acme.md'); // BM25 over the corpus, not file-grep
    });

    it('falls back to file-grep when the index is empty', async () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        const r = new Retriever(idx, async () => [1, 0, 0], grep);
        const res = await r.search('anything', { k: 5 });
        expect(res.mode).toBe('lexical_fallback');
        expect(res.results[0].path).toBe('grep.md');
    });

    it('scopes hybrid search by pathPrefix', async () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('Invoices/INV-1.md', 'm', 'h', [chunk('Invoices/INV-1.md', 'h1-a', [1, 0], 'acme invoice overdue')]);
        idx.setFile('People/Bob.md', 'm', 'h', [chunk('People/Bob.md', 'h1-b', [1, 0], 'acme person bob')]);
        const r = new Retriever(idx, async () => [1, 0], grep);
        const res = await r.search('acme', { k: 10, pathPrefix: 'Invoices/' });
        expect(res.results.length).toBeGreaterThan(0);
        expect(res.results.every((x) => x.path.startsWith('Invoices/'))).toBe(true);
    });

    it('clamps k to at least 1', async () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-a', [1, 0], 'acme one'), chunk('a.md', 'h1-b', [0, 1], 'acme two')]);
        const r = new Retriever(idx, async () => [1, 0], grep);
        const res = await r.search('acme', { k: 0 });
        expect(res.results).toHaveLength(1); // clamp(0, 1, 25) → 1
    });

    it('clamps k to at most 25', async () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        const chunks = Array.from({ length: 30 }, (_, i) => chunk('a.md', `h1-${i}`, [1, 0], `acme item ${i}`));
        idx.setFile('a.md', 'm', 'h', chunks);
        const r = new Retriever(idx, async () => [1, 0], grep);
        const res = await r.search('acme', { k: 100 });
        expect(res.results).toHaveLength(25); // clamp(100, 1, 25) → 25
    });

    it('truncates long snippets to the configured cap', async () => {
        const long = 'x'.repeat(1000);
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-a', [1, 0], long)]);
        const r = new Retriever(idx, async () => [1, 0], grep); // vector pass surfaces the chunk
        const res = await r.search('x', { k: 5 });
        const hit = res.results.find((h) => h.path === 'a.md')!;
        expect(hit.snippet).toHaveLength(601); // 600 chars + '…'
        expect(hit.snippet.endsWith('…')).toBe(true);
    });

    it('caps results per note but backfills to k when one note dominates', async () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [
            chunk('a.md', 'h1-1', [1, 0], 'alpha one'),
            chunk('a.md', 'h1-2', [1, 0], 'alpha two'),
            chunk('a.md', 'h1-3', [1, 0], 'alpha three'),
        ]);
        idx.setFile('b.md', 'm', 'h', [chunk('b.md', 'h1-b', [1, 0], 'alpha b')]);
        const r = new Retriever(idx, async () => [1, 0], grep, { maxPerNote: 2, recencyWeight: 0, snippetChars: 600 });
        const res = await r.search('alpha', { k: 3 });
        expect(res.results).toHaveLength(3); // backfilled to k
        expect(res.results.filter((x) => x.path === 'a.md').length).toBeLessThanOrEqual(2); // capped
        expect(res.results.some((x) => x.path === 'b.md')).toBe(true); // diversity surfaced the other note
    });

    it('returns component scores and a normalized top score', async () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-ar', [1, 0, 0], 'acme overdue ar balance')]);
        const r = new Retriever(idx, async () => [1, 0, 0], grep);
        const res = await r.search('acme overdue', { k: 5 });
        expect(res.results[0].score).toBeCloseTo(1, 5); // normalized → top is 1
        expect(res.results[0].scores?.vector).toBeGreaterThan(0);
        expect(res.results[0].scores?.lexical).toBeGreaterThan(0);
    });

    it('ranks the more recently edited note higher at equal relevance (recencyWeight > 0)', async () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        const oldT = new Date(Date.now() - 400 * 86_400_000).toISOString();
        const newT = new Date().toISOString();
        idx.setFile('old.md', oldT, 'h', [chunk('old.md', 'h1', [1, 0], 'budget planning notes')]);
        idx.setFile('new.md', newT, 'h', [chunk('new.md', 'h1', [1, 0], 'budget planning notes')]);
        const r = new Retriever(idx, async () => [1, 0], grep, { maxPerNote: 2, recencyWeight: 0.5, snippetChars: 600 });
        const res = await r.search('budget planning', { k: 2 });
        expect(res.results[0].path).toBe('new.md');
    });
});
