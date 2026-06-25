// Query-aware snippet extraction for memory-search results (RFC 021). Given a
// chunk's full text and the query, pick the most relevant ~maxChars window (the
// densest cluster of matched query terms) and return it together with highlight
// spans (character offsets INTO the returned snippet) for UI emphasis. Falls back
// to a leading window when nothing matches (the previous behaviour).
import { tokenize } from './bm25.js';
import type { SnippetHighlight } from './types.js';

const ELLIPSIS = '…';

/** A windowed snippet plus the spans within it that matched the query. */
export interface Snippet {
    snippet: string;
    highlights: SnippetHighlight[];
}

interface Range {
    start: number;
    end: number;
}

/** All merged [start,end) ranges where any query term occurs in `text`
 *  (case-insensitive); overlapping/adjacent hits collapse into one span. */
function matchRanges(text: string, terms: string[]): Range[] {
    const lower = text.toLowerCase();
    const ranges: Range[] = [];
    for (const term of terms) {
        if (!term) continue;
        let from = 0;
        for (;;) {
            const i = lower.indexOf(term, from);
            if (i === -1) break;
            ranges.push({ start: i, end: i + term.length });
            from = i + term.length;
        }
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Range[] = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else merged.push({ ...r });
    }
    return merged;
}

/** Window start (in text coords) for the [start, start+maxChars) slice that
 *  covers the most matched characters; ties resolve to the earliest window. */
function bestWindowStart(ranges: Range[], textLen: number, maxChars: number): number {
    let bestStart = 0;
    let bestCovered = -1;
    for (const r of ranges) {
        // Place this match ~20% in from the left so there's leading context.
        const start = Math.max(0, Math.min(r.start - Math.floor(maxChars * 0.2), textLen - maxChars));
        const end = start + maxChars;
        let covered = 0;
        for (const m of ranges) {
            const s = Math.max(m.start, start);
            const e = Math.min(m.end, end);
            if (e > s) covered += e - s;
        }
        if (covered > bestCovered) {
            bestCovered = covered;
            bestStart = start;
        }
    }
    return bestStart;
}

/** Clamp match ranges to [winStart,winEnd) and shift into snippet coordinates. */
function clampHighlights(ranges: Range[], winStart: number, winEnd: number, offset: number): SnippetHighlight[] {
    const out: SnippetHighlight[] = [];
    for (const r of ranges) {
        const s = Math.max(r.start, winStart);
        const e = Math.min(r.end, winEnd);
        if (e > s) out.push({ start: s + offset, end: e + offset });
    }
    return out;
}

/**
 * Build a query-aware snippet.
 *
 * @param text - The full chunk text.
 * @param query - The natural-language / keyword query (tokenized internally).
 * @param maxChars - Maximum snippet length (excluding ellipses).
 * @returns The windowed snippet and highlight spans (offsets into the snippet).
 */
export function buildSnippet(text: string, query: string, maxChars: number): Snippet {
    const terms = Array.from(new Set(tokenize(query)));
    const ranges = matchRanges(text, terms);

    if (text.length <= maxChars) {
        // Whole chunk fits — highlight the raw matches as-is.
        return { snippet: text, highlights: clampHighlights(ranges, 0, text.length, 0) };
    }
    if (ranges.length === 0) {
        // No query match → leading window (preserves the prior behaviour).
        return { snippet: text.slice(0, maxChars) + ELLIPSIS, highlights: [] };
    }

    const start = bestWindowStart(ranges, text.length, maxChars);
    const end = Math.min(text.length, start + maxChars);
    const lead = start > 0 ? ELLIPSIS : '';
    const trail = end < text.length ? ELLIPSIS : '';
    const snippet = lead + text.slice(start, end) + trail;
    // text coord c → snippet coord c - start + lead.length.
    const offset = lead.length - start;
    return { snippet, highlights: clampHighlights(ranges, start, end, offset) };
}
