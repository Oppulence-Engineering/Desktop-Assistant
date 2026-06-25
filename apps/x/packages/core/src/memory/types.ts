// Shared data shapes for the local semantic memory index (RFC 021).
//
// Every shape is defined as a zod schema and its TypeScript type is inferred via
// `z.infer`, so the schema is the single source of truth. These particular shapes
// are in-memory DTOs (produced by the chunker, returned by the retriever); the
// persisted/network shapes that genuinely need runtime validation live next to
// their I/O code (`store.ts`, `config.ts`, `embed.ts`). `ChunkMeta` is the one
// exception — it is also embedded in the persisted corpus, so `store.ts` reuses
// this schema to validate corpus records on load.
import { z } from 'zod';

/**
 * Metadata attached to every indexed chunk: where it came from and how to detect
 * that its content changed. Embedded verbatim in the persisted corpus record, so
 * a change here changes the on-disk corpus shape.
 */
export const ChunkMeta = z.object({
    /** Vault-relative path of the source note, e.g. `"Invoices/INV-456.md"`. */
    path: z.string(),
    /** Heading anchor within the note (e.g. `"h2-status"`); `"frontmatter"` for the entity card. */
    headingAnchor: z.string(),
    /** Frontmatter id when the chunk is an entity card (from the note's frontmatter). */
    frontmatterId: z.string().optional(),
    /** sha256 of the chunk text — the incremental re-embed key (unchanged hash ⇒ vector reused). */
    contentHash: z.string(),
    /** 1-based inclusive start line of the chunk in the source note. */
    startLine: z.number().int(),
    /** 1-based inclusive end line of the chunk in the source note. */
    endLine: z.number().int(),
});
export type ChunkMeta = z.infer<typeof ChunkMeta>;

/** A chunk of note text plus its metadata, as emitted by the chunker. */
export const Chunk = z.object({
    /** The chunk's raw text (what gets embedded and BM25-indexed). */
    text: z.string(),
    /** Provenance + change-detection metadata for this chunk. */
    meta: ChunkMeta,
});
export type Chunk = z.infer<typeof Chunk>;

/** A highlighted span within a snippet (character offsets into `snippet`). */
export const SnippetHighlight = z.object({
    /** Inclusive start offset of the matched span. */
    start: z.number().int(),
    /** Exclusive end offset of the matched span. */
    end: z.number().int(),
});
export type SnippetHighlight = z.infer<typeof SnippetHighlight>;

/** Per-signal relevance scores behind the fused {@link SearchResult.score}. */
export const ResultScores = z.object({
    /** Cosine similarity from the vector pass, when present. */
    vector: z.number().optional(),
    /** BM25 score from the lexical pass, when present. */
    lexical: z.number().optional(),
});
export type ResultScores = z.infer<typeof ResultScores>;

/** One ranked retrieval result returned by the `memory-search` tool. */
export const SearchResult = z.object({
    /** Vault-relative path — the agent can `file-readText` it. */
    path: z.string(),
    /** Heading anchor of the matched chunk within the note. */
    headingAnchor: z.string(),
    /** A short backlink the agent can open: `"path#anchor"`. */
    backlink: z.string(),
    /** The matched chunk text, windowed around the query match and truncated. */
    snippet: z.string(),
    /** Fused relevance score, normalized to (0,1] (higher = better; comparable within one response). */
    score: z.number(),
    /** Character spans within `snippet` that matched the query (for UI highlighting). */
    highlights: z.array(SnippetHighlight).optional(),
    /** The component scores behind `score` (vector cosine, BM25), when available. */
    scores: ResultScores.optional(),
    /** 1-based inclusive start line of the matched chunk. */
    startLine: z.number().int(),
    /** 1-based inclusive end line of the matched chunk. */
    endLine: z.number().int(),
});
export type SearchResult = z.infer<typeof SearchResult>;

/**
 * Retrieval mode, surfaced for observability:
 * - `hybrid` — vector + lexical fused (the normal path);
 * - `lexical_fallback` — embeddings unavailable or index empty, lexical/grep only;
 * - `vector_only` — reserved for a vector-only diagnostic path.
 */
export const SearchMode = z.enum(['hybrid', 'lexical_fallback', 'vector_only']);
export type SearchMode = z.infer<typeof SearchMode>;
