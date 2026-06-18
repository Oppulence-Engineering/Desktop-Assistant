import { describe, it, expect } from 'vitest';
import { BM25, tokenize } from './bm25.js';

describe('tokenize', () => {
    it('lowercases and splits on whitespace', () => {
        expect(tokenize('Hello   WORLD\tFoo\nBar')).toEqual(['hello', 'world', 'foo', 'bar']);
    });

    it('preserves identifiers, emails, versions, and paths as single terms', () => {
        expect(tokenize('INV-456')).toEqual(['inv-456']);
        expect(tokenize('a@b.com')).toEqual(['a@b.com']);
        expect(tokenize('foo_bar v1.2.3 path/to/x')).toEqual(['foo_bar', 'v1.2.3', 'path/to/x']);
    });

    it('strips surrounding punctuation but keeps internal separators', () => {
        expect(tokenize('(hello), [world]!')).toEqual(['hello', 'world']);
        expect(tokenize('end.')).toEqual(['end']);
        expect(tokenize('a.b')).toEqual(['a.b']);
    });

    it('returns an empty array for blank or empty input', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize('   \t\n ')).toEqual([]);
        expect(tokenize('!!! ,,, ...')).toEqual([]);
    });
});

describe('BM25', () => {
    it('returns no hits for an empty corpus', () => {
        expect(new BM25<string>([]).search('anything', 5)).toEqual([]);
    });

    it('returns no hits when no document contains a query term', () => {
        const bm = new BM25([{ ref: 'a', text: 'the quick brown fox' }]);
        expect(bm.search('zzz', 5)).toEqual([]);
    });

    it('ranks a document containing a rare term above common-only documents', () => {
        const bm = new BM25([
            { ref: 'a', text: 'rare common' },
            { ref: 'b', text: 'common' },
            { ref: 'c', text: 'common' },
            { ref: 'd', text: 'common' },
        ]);
        const hits = bm.search('rare common', 10);
        expect(hits[0].ref).toBe('a'); // matches the rare (high-IDF) term
    });

    it('applies length normalization (shorter doc with same TF scores higher)', () => {
        const filler = Array.from({ length: 30 }, (_, i) => `wordnum${i}`).join(' ');
        const bm = new BM25([
            { ref: 'short', text: 'acme' },
            { ref: 'long', text: `acme ${filler}` },
        ]);
        const hits = bm.search('acme', 10);
        expect(hits[0].ref).toBe('short');
        expect(hits.map((h) => h.ref).sort()).toEqual(['long', 'short']);
    });

    it('respects the topN limit', () => {
        const bm = new BM25([
            { ref: 'a', text: 'common' },
            { ref: 'b', text: 'common' },
            { ref: 'c', text: 'common' },
        ]);
        expect(bm.search('common', 2)).toHaveLength(2);
    });

    it('deduplicates repeated query terms (Set semantics)', () => {
        const bm = new BM25([
            { ref: 'a', text: 'rare common common' },
            { ref: 'b', text: 'common' },
        ]);
        const once = bm.search('rare', 5);
        const twice = bm.search('rare rare', 5);
        expect(twice).toEqual(once); // a repeated term must not inflate the score
    });

    it('accumulates score across distinct query terms', () => {
        const bm = new BM25([
            { ref: 'both', text: 'alpha beta' },
            { ref: 'one', text: 'alpha' },
        ]);
        const hits = bm.search('alpha beta', 5);
        expect(hits[0].ref).toBe('both'); // matches two query terms → higher than one
    });

    it('preserves the caller ref type on hits', () => {
        const refA = { id: 1 };
        const refB = { id: 2 };
        const bm = new BM25([
            { ref: refA, text: 'invoice overdue' },
            { ref: refB, text: 'meeting notes' },
        ]);
        const hits = bm.search('invoice', 5);
        expect(hits[0].ref).toBe(refA); // same object reference, not a copy
    });
});
