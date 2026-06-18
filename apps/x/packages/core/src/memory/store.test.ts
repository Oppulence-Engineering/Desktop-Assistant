import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryIndex, type IndexChunk } from './store.js';
import type { ChunkMeta } from './types.js';

function meta(p: string, anchor: string, hash: string): ChunkMeta {
    return { path: p, headingAnchor: anchor, contentHash: hash, startLine: 1, endLine: 2 };
}

function chunk(p: string, anchor: string, vec: number[]): IndexChunk {
    return { meta: meta(p, anchor, anchor + '-hash'), vec, text: `${p} ${anchor} text` };
}

describe('MemoryIndex', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memidx-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('upserts, queries by cosine, and ranks the nearest vector first', () => {
        const idx = MemoryIndex.open(dir, 'text-embedding-3-small', 3);
        idx.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0]), chunk('a.md', 'h1-y', [0, 1, 0])]);
        const hits = idx.query([0.9, 0.1, 0], 2);
        expect(hits.length).toBe(2);
        expect(hits[0].meta.headingAnchor).toBe('h1-x'); // closest to [1,0,0]
        expect(idx.chunkCount()).toBe(2);
    });

    it('replaces a file’s chunks on re-set (incremental) and removes on removeFile', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-a', [1, 0])]);
        idx.setFile('a.md', 'm2', 'h2', [chunk('a.md', 'h1-b', [0, 1]), chunk('a.md', 'h1-c', [1, 1])]);
        expect(idx.chunkCount()).toBe(2); // prior chunk dropped
        idx.removeFile('a.md');
        expect(idx.chunkCount()).toBe(0);
        expect(idx.indexedPaths()).toEqual([]);
    });

    it('persists and reopens with vectors + corpus intact', () => {
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();
        const b = MemoryIndex.open(dir, 'm', 3);
        expect(b.chunkCount()).toBe(1);
        expect(b.corpus()[0].text).toContain('h1-x text');
        expect(b.query([1, 0, 0], 1)[0].meta.headingAnchor).toBe('h1-x');
        expect(b.fileEntry('a.md')?.hash).toBe('h1');
    });

    it('rebuilds (empties) on model/dims mismatch', () => {
        const a = MemoryIndex.open(dir, 'model-a', 3);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();
        expect(MemoryIndex.needsRebuild(dir, 'model-b', 3)).toBe(true);
        const b = MemoryIndex.open(dir, 'model-b', 3); // different model
        expect(b.chunkCount()).toBe(0);
        expect(b.model()).toBe('model-b');
    });

    it('isStoreConsistent + recovery: truncated vectors.bin → empty index on open', () => {
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0]), chunk('a.md', 'h1-y', [0, 1, 0])]);
        a.persist();
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(true);

        // Simulate a crash mid-write: vectors.bin has only the header (0 records)
        // while the manifest still claims 2 chunks.
        fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.alloc(8));
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(false);

        // open() must detect the inconsistency and degrade to an empty index so the
        // retriever falls back to lexical and the next indexer pass rebuilds.
        const b = MemoryIndex.open(dir, 'm', 3);
        expect(b.chunkCount()).toBe(0);
        expect(b.indexedPaths()).toEqual([]);
    });

    it('recovers from a malformed corpus record (safeParse → empty index, no throw)', () => {
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();

        // Corrupt corpus.json with a record that fails schema validation (bad
        // vectorId, missing meta/text) while the manifest + vectors stay valid.
        fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify({ records: [{ vectorId: 'nope' }] }));
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(false);

        // open() must not throw: the corpus fails to load, the self-consistency
        // guard sees manifest chunks with no text, and the index drops to empty so
        // retrieval degrades to lexical and the next indexer pass rebuilds.
        const b = MemoryIndex.open(dir, 'm', 3);
        expect(b.chunkCount()).toBe(0);
        expect(b.indexedPaths()).toEqual([]);
    });

    it('readDims returns the persisted dimensionality (not a caller guess)', () => {
        expect(MemoryIndex.readDims(dir)).toBeNull(); // nothing persisted yet
        const a = MemoryIndex.open(dir, 'm', 1024);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)))]);
        a.persist();
        expect(MemoryIndex.readDims(dir)).toBe(1024);
    });

    it('persist is a no-op when nothing changed (dirty flag)', () => {
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();
        const mtime1 = fs.statSync(path.join(dir, 'manifest.json')).mtimeMs;
        a.persist(); // no mutations since last persist → should not rewrite
        const mtime2 = fs.statSync(path.join(dir, 'manifest.json')).mtimeMs;
        expect(mtime2).toBe(mtime1);
    });

    it('scopes query by pathPrefix', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('Invoices/INV-1.md', 'm', 'h', [chunk('Invoices/INV-1.md', 'h1-a', [1, 0])]);
        idx.setFile('People/Bob.md', 'm', 'h', [chunk('People/Bob.md', 'h1-b', [1, 0])]);
        const hits = idx.query([1, 0], 10, 'Invoices/');
        expect(hits.length).toBe(1);
        expect(hits[0].meta.path).toBe('Invoices/INV-1.md');
    });

    it('reuses a stored vector by (path, chunkHash) and misses otherwise', () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 2, 3])]);
        expect(idx.existingVector('a.md', 'h1-x-hash')).toEqual([1, 2, 3]); // chunk() sets hash = anchor+'-hash'
        expect(idx.existingVector('a.md', 'nonexistent-hash')).toBeUndefined();
        expect(idx.existingVector('unknown.md', 'h1-x-hash')).toBeUndefined();
    });

    it('query returns nothing for a zero-norm query vector', () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        expect(idx.query([0, 0, 0], 5)).toEqual([]);
    });

    it('query skips zero-norm stored vectors', () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-zero', [0, 0, 0]), chunk('a.md', 'h1-x', [1, 0, 0])]);
        const hits = idx.query([1, 0, 0], 5);
        expect(hits).toHaveLength(1);
        expect(hits[0].meta.headingAnchor).toBe('h1-x');
    });

    it('indexedPaths lists every indexed file', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-a', [1, 0])]);
        idx.setFile('b.md', 'm', 'h', [chunk('b.md', 'h1-b', [0, 1])]);
        expect(idx.indexedPaths().sort()).toEqual(['a.md', 'b.md']);
    });

    it('leaves no .tmp files after an atomic persist', () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        idx.persist();
        const stray = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
        expect(stray).toEqual([]);
        expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'vectors.bin'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'corpus.json'))).toBe(true);
    });

    it('needsRebuild reflects model/dims compatibility', () => {
        expect(MemoryIndex.needsRebuild(dir, 'm', 3)).toBe(false); // nothing persisted yet
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();
        expect(MemoryIndex.needsRebuild(dir, 'm', 3)).toBe(false); // same model+dims
        expect(MemoryIndex.needsRebuild(dir, 'other', 3)).toBe(true); // model changed
        expect(MemoryIndex.needsRebuild(dir, 'm', 5)).toBe(true); // dims changed
    });

    it('readManifest returns null when absent and the parsed manifest when present', () => {
        expect(MemoryIndex.readManifest(dir)).toBeNull();
        const a = MemoryIndex.open(dir, 'mdl', 4);
        a.setFile('a.md', 'mt', 'fh', [chunk('a.md', 'h1-x', [1, 0, 0, 0])]);
        a.persist();
        const m = MemoryIndex.readManifest(dir)!;
        expect(m.model).toBe('mdl');
        expect(m.dims).toBe(4);
        expect(m.files['a.md'].hash).toBe('fh');
        expect(m.files['a.md'].chunks).toHaveLength(1);
    });

    it('removeFile on an unknown path is a no-op', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-a', [1, 0])]);
        idx.removeFile('does-not-exist.md');
        expect(idx.chunkCount()).toBe(1);
        expect(idx.indexedPaths()).toEqual(['a.md']);
    });

    it('corpus() returns every chunk with its text and meta', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-a', [1, 0]), chunk('a.md', 'h1-b', [0, 1])]);
        const corpus = idx.corpus();
        expect(corpus).toHaveLength(2);
        expect(corpus.map((c) => c.meta.headingAnchor).sort()).toEqual(['h1-a', 'h1-b']);
        expect(corpus.every((c) => c.text.includes('text'))).toBe(true);
    });

    it('assigns fresh monotonic vectorIds when a file is re-set', () => {
        const idx = MemoryIndex.open(dir, 'm', 3);
        idx.setFile('a.md', 'm1', 'h1', [chunk('a.md', 'h1-x', [1, 0, 0])]); // vectorId 1
        idx.setFile('a.md', 'm2', 'h2', [chunk('a.md', 'h1-y', [0, 1, 0])]); // old dropped, vectorId 2
        const corpus = idx.corpus();
        expect(corpus).toHaveLength(1);
        expect(corpus[0].vectorId).toBe(2); // not reusing the freed id 1
    });

    it('isStoreConsistent is true with nothing persisted and after a clean persist', () => {
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(true); // no manifest
        const a = MemoryIndex.open(dir, 'm', 3);
        a.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1-x', [1, 0, 0])]);
        a.persist();
        expect(MemoryIndex.isStoreConsistent(dir)).toBe(true);
    });

    it('lexicalSearch ranks by BM25 and reuses the cached index', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'apple', [1, 0]), chunk('a.md', 'banana', [0, 1])]);
        const hits = idx.lexicalSearch('apple', 5);
        expect(hits[0].ref.meta.headingAnchor).toBe('apple');
        expect(hits[0].score).toBeGreaterThan(0);
        // Second call reuses the cached BM25 → same top hit.
        expect(idx.lexicalSearch('apple', 5)[0].ref.meta.headingAnchor).toBe('apple');
    });

    it('lexicalSearch scopes by pathPrefix', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('Invoices/INV-1.md', 'm', 'h', [chunk('Invoices/INV-1.md', 'overdue', [1, 0])]);
        idx.setFile('People/Bob.md', 'm', 'h', [chunk('People/Bob.md', 'overdue', [0, 1])]);
        const hits = idx.lexicalSearch('overdue', 10, 'Invoices/');
        expect(hits).toHaveLength(1);
        expect(hits[0].ref.meta.path).toBe('Invoices/INV-1.md');
    });

    it('rebuilds the BM25 cache after the corpus changes', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'apple', [1, 0])]);
        expect(idx.lexicalSearch('apple', 5)).toHaveLength(1); // builds + caches
        idx.setFile('b.md', 'm', 'h', [chunk('b.md', 'apple', [0, 1])]); // mutation → invalidate
        expect(idx.lexicalSearch('apple', 5)).toHaveLength(2); // rebuilt over the new corpus
    });

    it('relatedPaths ranks neighbors by mean vector and excludes self', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1', [1, 0]), chunk('a.md', 'h2', [0.9, 0.1])]); // ~[1,0]
        idx.setFile('near.md', 'm', 'h', [chunk('near.md', 'h1', [1, 0])]); // aligned with a
        idx.setFile('far.md', 'm', 'h', [chunk('far.md', 'h1', [0, 1])]); // orthogonal
        const related = idx.relatedPaths('a.md', 5);
        expect(related.map((r) => r.path)).not.toContain('a.md'); // excludes self
        expect(related[0].path).toBe('near.md'); // most similar first
        expect(related[0].score).toBeGreaterThan(related[related.length - 1].score);
    });

    it('relatedPaths returns [] for a note with no indexed chunks', () => {
        const idx = MemoryIndex.open(dir, 'm', 2);
        idx.setFile('a.md', 'm', 'h', [chunk('a.md', 'h1', [1, 0])]);
        expect(idx.relatedPaths('missing.md', 5)).toEqual([]);
    });
});
