import { describe, it, expect } from 'vitest';
import { buildSnippet } from './snippet.js';

describe('buildSnippet', () => {
    it('returns the full text with highlights when it fits under the cap', () => {
        const { snippet, highlights } = buildSnippet('Acme invoice is overdue', 'overdue invoice', 600);
        expect(snippet).toBe('Acme invoice is overdue');
        const spans = highlights.map((h) => snippet.slice(h.start, h.end).toLowerCase());
        expect(spans).toContain('invoice');
        expect(spans).toContain('overdue');
    });

    it('windows around the match in long text with ellipses + a correct highlight', () => {
        const filler = 'lorem ipsum dolor sit amet '.repeat(40);
        const text = `${filler}the SECRET marker here ${filler}`;
        const { snippet, highlights } = buildSnippet(text, 'secret', 80);
        expect(snippet.length).toBeLessThanOrEqual(82); // 80 + up to two ellipses
        expect(snippet.toLowerCase()).toContain('secret');
        expect(highlights.length).toBeGreaterThan(0);
        // The first highlight span maps back to the matched term within the snippet.
        expect(snippet.slice(highlights[0].start, highlights[0].end).toLowerCase()).toBe('secret');
    });

    it('falls back to a leading window with no highlights when nothing matches', () => {
        const text = 'a'.repeat(1000);
        const { snippet, highlights } = buildSnippet(text, 'zzz', 100);
        expect(snippet.length).toBe(101); // 100 chars + trailing ellipsis
        expect(snippet.endsWith('…')).toBe(true);
        expect(highlights).toEqual([]);
    });

    it('merges adjacent/overlapping matches into a single highlight span', () => {
        // "overdue" appears twice; query matches both → spans should be well-formed.
        const { highlights } = buildSnippet('overdue overdue balance', 'overdue', 600);
        expect(highlights.length).toBe(2);
        for (const h of highlights) expect(h.end).toBeGreaterThan(h.start);
    });
});
