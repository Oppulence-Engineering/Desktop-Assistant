// Hybrid retriever (RFC 021): vector top-N (cosine) + lexical top-N (BM25, cached
// on the index) fused by reciprocal-rank fusion, then a recency tiebreaker and a
// per-note diversity cap, returning chunks with query-aware snippets + highlights,
// component scores, and file backlinks. On embedding failure it degrades to a
// lexical-only pass; on an empty index it degrades to file-grep — recall never
// hard-fails.
import { z } from 'zod';
import { CorpusEntry, type MemoryIndex } from './store.js';
import { buildSnippet } from './snippet.js';
import { SearchMode, SearchResult, type ChunkMeta } from './types.js';

const VECTOR_TOP_N = 40;
const LEXICAL_TOP_N = 40;
const RRF_K = 60;
const SNIPPET_CHARS = 600;
const RECENCY_HALFLIFE_DAYS = 30;

/** Options for {@link Retriever.search}. */
export const SearchOptions = z.object({
    /** Number of results to return; clamped to [1, 25] by `search` (default 8). */
    k: z.number().int().positive().optional(),
    /** Restrict retrieval to chunks whose path starts with this prefix. */
    pathPrefix: z.string().optional(),
});
export type SearchOptions = z.infer<typeof SearchOptions>;

/** The response from {@link Retriever.search}: the mode used plus ranked results. */
export const SearchResponse = z.object({
    /** Which retrieval path produced these results (see {@link SearchMode}). */
    mode: SearchMode,
    /** Ranked results, best first. */
    results: z.array(SearchResult),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Tunable retrieval behaviour (sourced from `MemoryConfig`); all optional with sane defaults. */
export interface RetrieverTuning {
    /** Max chunks per source note in the result set (0 = no cap). */
    maxPerNote: number;
    /** Recency tiebreaker weight in [0,1] (0 = off). */
    recencyWeight: number;
    /** Max snippet length in characters. */
    snippetChars: number;
}

const DEFAULT_TUNING: RetrieverTuning = { maxPerNote: 2, recencyWeight: 0, snippetChars: SNIPPET_CHARS };

/**
 * Embeds a single query string; throws when embeddings are unavailable (which
 * triggers the lexical fallback). Plain function type — not a zod schema.
 */
export type EmbedQuery = (query: string) => Promise<number[]>;

/**
 * Last-resort lexical fallback (file-grep) used when the index is empty. Plain
 * function type — not a zod schema.
 */
export type LexicalGrep = (query: string, pathPrefix?: string) => Promise<SearchResult[]>;

/** A retrieval candidate while ranking: its base fused score, component scores, and final/normalized score. */
interface Candidate {
    entry: CorpusEntry;
    base: number;
    vector?: number;
    lexical?: number;
    final: number;
    norm: number;
}

/**
 * Hybrid retriever: fuses a vector pass (cosine top-N) with a lexical pass (BM25
 * top-N) via reciprocal-rank fusion, applies a recency tiebreaker and a per-note
 * diversity cap, and returns query-aware snippets with component scores. Degrades
 * gracefully — to lexical-only when embeddings fail, and to file-grep when the
 * index is empty — so recall never hard-fails.
 */
export class Retriever {
    private readonly tuning: RetrieverTuning;

    /**
     * @param index - The opened {@link MemoryIndex} (vectors + corpus).
     * @param embedQuery - Embeds the query string (see {@link EmbedQuery}).
     * @param grep - Last-resort file-grep fallback (see {@link LexicalGrep}).
     * @param tuning - Optional diversity/recency/snippet tuning (defaults applied).
     */
    constructor(
        private readonly index: MemoryIndex,
        private readonly embedQuery: EmbedQuery,
        private readonly grep: LexicalGrep,
        tuning: Partial<RetrieverTuning> = {},
    ) {
        this.tuning = { ...DEFAULT_TUNING, ...tuning };
    }

    /**
     * Run retrieval for a query.
     *
     * @param query - The natural-language query.
     * @param opts - Result count (`k`, clamped to [1, 25], default 8) + optional `pathPrefix`.
     * @returns The mode actually used plus ranked results (best first), each with a
     *          normalized score, component scores, and a query-aware highlighted snippet.
     *          Never throws: embedding failures fall back to lexical, an empty index to file-grep.
     */
    async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
        const k = clamp(opts.k ?? 8, 1, 25);

        // No index yet (disabled or never built) → pure file-grep.
        if (this.index.chunkCount() === 0) {
            return { mode: 'lexical_fallback', results: (await this.grep(query, opts.pathPrefix)).slice(0, k) };
        }

        // Lexical pass (cached BM25) with scores.
        const lexHits = this.index.lexicalSearch(query, LEXICAL_TOP_N, opts.pathPrefix);
        const lexical = lexHits.map((h) => h.ref);
        const lexScore = new Map<string, number>();
        for (const h of lexHits) lexScore.set(chunkKey(h.ref.meta), h.score);

        // Vector pass (cosine); on embedding failure, degrade to lexical-only.
        const vector: CorpusEntry[] = [];
        const vecScore = new Map<string, number>();
        let mode: SearchMode = 'hybrid';
        try {
            const qvec = await this.embedQuery(query);
            for (const h of this.index.query(qvec, VECTOR_TOP_N, opts.pathPrefix)) {
                vector.push({ vectorId: -1, meta: h.meta, text: h.text });
                vecScore.set(chunkKey(h.meta), h.score);
            }
        } catch {
            mode = 'lexical_fallback';
        }

        // Base relevance: RRF for hybrid, synthetic rank score for lexical fallback.
        let candidates: Candidate[];
        if (mode === 'lexical_fallback') {
            candidates = lexical.map((entry, i) => ({
                entry,
                base: 1 / (i + 1),
                lexical: lexScore.get(chunkKey(entry.meta)),
                final: 0,
                norm: 0,
            }));
        } else {
            candidates = reciprocalRankFusion([vector, lexical]).map((s) => ({
                entry: s.entry,
                base: s.score,
                vector: vecScore.get(chunkKey(s.entry.meta)),
                lexical: lexScore.get(chunkKey(s.entry.meta)),
                final: 0,
                norm: 0,
            }));
        }
        if (candidates.length === 0) return { mode, results: [] };

        // Recency tiebreaker + normalization to (0,1].
        const now = Date.now();
        let max = 0;
        for (const c of candidates) {
            c.final = c.base * (1 + this.tuning.recencyWeight * this.recencyFactor(c.entry.meta.path, now));
            if (c.final > max) max = c.final;
        }
        for (const c of candidates) c.norm = max > 0 ? c.final / max : 0;

        // Diversity (per-note cap with backfill), then take k.
        candidates.sort((a, b) => b.final - a.final);
        const selected = diversify(candidates, k, this.tuning.maxPerNote);
        return { mode, results: selected.map((c) => this.toResult(c, query)) };
    }

    /** Exponential recency weight in [0,1] from a note's mtime (1 = just edited).
     *  Short-circuits to 0 when recency is off or the mtime is missing/unparseable. */
    private recencyFactor(notePath: string, now: number): number {
        if (this.tuning.recencyWeight <= 0) return 0;
        const mtime = this.index.fileEntry(notePath)?.mtime;
        if (!mtime) return 0;
        const t = Date.parse(mtime);
        if (!Number.isFinite(t)) return 0;
        const ageDays = Math.max(0, (now - t) / 86_400_000);
        return Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS);
    }

    private toResult(c: Candidate, query: string): SearchResult {
        const { snippet, highlights } = buildSnippet(c.entry.text, query, this.tuning.snippetChars);
        const scores = c.vector !== undefined || c.lexical !== undefined ? { vector: c.vector, lexical: c.lexical } : undefined;
        return {
            path: c.entry.meta.path,
            headingAnchor: c.entry.meta.headingAnchor,
            backlink: `${c.entry.meta.path}#${c.entry.meta.headingAnchor}`,
            snippet,
            score: c.norm,
            highlights: highlights.length > 0 ? highlights : undefined,
            scores,
            startLine: c.entry.meta.startLine,
            endLine: c.entry.meta.endLine,
        };
    }
}

/** A corpus entry with its fused relevance score (output of reciprocal-rank fusion). */
export const ScoredEntry = z.object({
    /** The fused corpus entry. */
    entry: CorpusEntry,
    /** Its reciprocal-rank-fusion score (higher = better). */
    score: z.number(),
});
export type ScoredEntry = z.infer<typeof ScoredEntry>;

/**
 * reciprocalRankFusion fuses ranked lists by the sum of `1 / (RRF_K + rank)`,
 * keyed on each chunk's stable identity (`path#anchor#startLine`). An item ranked
 * highly in multiple lists accumulates score, so cross-signal agreement wins.
 *
 * @param lists - Ranked corpus lists to fuse (e.g. `[vectorHits, lexicalHits]`).
 * @returns Entries with their fused score, sorted descending (best first).
 */
export function reciprocalRankFusion(lists: CorpusEntry[][]): ScoredEntry[] {
    const score = new Map<string, number>();
    const byKey = new Map<string, CorpusEntry>();
    for (const list of lists) {
        list.forEach((entry, rank) => {
            const key = chunkKey(entry.meta);
            score.set(key, (score.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
            if (!byKey.has(key)) byKey.set(key, entry);
        });
    }
    return Array.from(score.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key, s]) => ({ entry: byKey.get(key)!, score: s }));
}

/**
 * diversify caps how many chunks one note contributes (`maxPerNote`) so a single
 * note can't flood the top-k, then backfills from the capped remainder so a query
 * that only matches one note still returns up to `k` results.
 */
function diversify(ordered: Candidate[], k: number, maxPerNote: number): Candidate[] {
    if (maxPerNote <= 0) return ordered.slice(0, k);
    const perNote = new Map<string, number>();
    const picked: Candidate[] = [];
    const skipped: Candidate[] = [];
    for (const c of ordered) {
        if (picked.length >= k) break;
        const n = perNote.get(c.entry.meta.path) ?? 0;
        if (n < maxPerNote) {
            picked.push(c);
            perNote.set(c.entry.meta.path, n + 1);
        } else {
            skipped.push(c);
        }
    }
    for (const c of skipped) {
        if (picked.length >= k) break;
        picked.push(c);
    }
    return picked;
}

function chunkKey(m: ChunkMeta): string {
    return `${m.path}#${m.headingAnchor}#${m.startLine}`;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
