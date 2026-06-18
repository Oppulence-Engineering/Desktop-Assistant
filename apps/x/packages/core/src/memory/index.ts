// Public façade for the local semantic memory index (RFC 021): memorySearch
// (used by the memory-search builtin tool) and runMemoryIndex (hooked into the
// knowledge sync tick). The loaded index is cached and reloaded only when the
// manifest changes, so warm-index search stays fast.
import fs from 'fs';
import path from 'path';
import * as files from '../filesystem/files.js';
import { capture } from '../analytics/posthog.js';
import { WorkDir } from '../config/config.js';
import { indexDir, loadMemoryConfig } from './config.js';
import { embedBatch, resolveEmbedTarget } from './embed.js';
import { expandQuery } from './expand.js';
import { Indexer, type IndexStats } from './indexer.js';
import { MemoryIndex } from './store.js';
import { Retriever, type SearchResponse } from './retriever.js';
import type { SearchResult } from './types.js';

function knowledgeDir(): string {
    return path.join(WorkDir, 'knowledge');
}

// --- query-embedding LRU cache -----------------------------------------------
// Repeated/agent-retry queries skip a network round-trip. Keyed by model+dims+text;
// small + bounded (correctness doesn't depend on it — purely a latency/cost saver).

const QUERY_EMBED_CACHE_MAX = 64;
const queryEmbedCache = new Map<string, number[]>();

function cacheGet(key: string): number[] | undefined {
    const v = queryEmbedCache.get(key);
    if (v) {
        queryEmbedCache.delete(key); // move-to-front (LRU)
        queryEmbedCache.set(key, v);
    }
    return v;
}

function cacheSet(key: string, v: number[]): void {
    queryEmbedCache.set(key, v);
    if (queryEmbedCache.size > QUERY_EMBED_CACHE_MAX) {
        const oldest = queryEmbedCache.keys().next().value;
        if (oldest !== undefined) queryEmbedCache.delete(oldest);
    }
}

// --- cached index (reload on manifest change) --------------------------------

let cached: { index: MemoryIndex; mtimeMs: number; model: string } | null = null;

function manifestMtimeMs(): number {
    try {
        return fs.statSync(path.join(indexDir(), 'manifest.json')).mtimeMs;
    } catch {
        return 0;
    }
}

function loadedIndex(model: string, dims: number): MemoryIndex {
    const mtimeMs = manifestMtimeMs();
    if (cached && cached.mtimeMs === mtimeMs && cached.model === model) return cached.index;
    const index = MemoryIndex.open(indexDir(), model, dims);
    cached = { index, mtimeMs, model: index.model() };
    return index;
}

// --- retrieval (the memory-search tool) --------------------------------------

/**
 * memorySearch runs hybrid (vector + lexical) retrieval over the indexed vault.
 * It opens the index exactly as persisted (the manifest's model + dims are
 * authoritative for the on-disk vectors), and on any failure — disabled, no index
 * yet, or embeddings unavailable — returns a lexical file-grep fallback, so the
 * agent never hard-fails. This is the implementation behind the `memory-search` tool.
 *
 * @param query - The natural-language query.
 * @param opts - `k` results to return (clamped to [1, 25], default 8) and an
 *               optional `pathPrefix` to scope retrieval to a sub-tree of the vault.
 * @returns The retrieval mode used plus ranked results (see {@link SearchResponse}).
 *
 * @example
 * ```ts
 * const { mode, results } = await memorySearch('overdue AR for Acme', { k: 5 });
 * // results[0].backlink → "Invoices/INV-456.md#h2-status"
 * ```
 */
export async function memorySearch(
    query: string,
    opts: { k?: number; pathPrefix?: string } = {},
): Promise<SearchResponse> {
    const start = Date.now();
    const cfg = loadMemoryConfig();
    let expanded = false;
    let res: SearchResponse;

    // Open the index AS PERSISTED: the stored manifest's model + dims are
    // authoritative for the vectors on disk (the query is embedded with that same
    // model + dims). A config drift is reconciled by the indexer on the next tick.
    const persisted = cfg.enabled ? MemoryIndex.readManifest(indexDir()) : null;
    if (!persisted || persisted.dims === 0) {
        res = { mode: 'lexical_fallback', results: await grepFallback(query, opts.pathPrefix, opts.k ?? 8) };
    } else {
        const index = loadedIndex(persisted.model, persisted.dims);
        const embedModel = index.model();

        // Optional HyDE: embed a hypothetical answer instead of the bare query.
        let embedText: string | undefined;
        if (cfg.queryExpansion) {
            try {
                const ex = await expandQuery(query);
                if (ex.hypothetical?.trim()) {
                    embedText = `${query}\n${ex.hypothetical}`;
                    expanded = true;
                }
            } catch {
                // best-effort — fall back to the raw query
            }
        }

        const embedQuery = async (q: string): Promise<number[]> => {
            const text = embedText ?? q;
            const key = `${embedModel}:${cfg.embedDimensions}:${text}`;
            const cached = cacheGet(key);
            if (cached) return cached;
            const target = await resolveEmbedTarget(embedModel, cfg.embedDimensions);
            const { vectors } = await embedBatch(target, [text]);
            const v = vectors[0];
            if (!v || v.length === 0) throw new Error('empty query embedding');
            cacheSet(key, v);
            return v;
        };
        const grep = (q: string, prefix?: string) => grepFallback(q, prefix, opts.k ?? 8);
        res = await new Retriever(index, embedQuery, grep, {
            maxPerNote: cfg.maxPerNote,
            recencyWeight: cfg.recencyWeight,
            snippetChars: cfg.snippetChars,
        }).search(query, opts);
    }

    capture('memory_searched', {
        mode: res.mode,
        result_count: res.results.length,
        zero_result: res.results.length === 0,
        k: opts.k ?? 8,
        scoped: !!opts.pathPrefix,
        expanded,
        duration_ms: Date.now() - start,
    });
    return res;
}

/** grepFallback is the last-resort lexical recall over the vault (RFC 021). */
async function grepFallback(query: string, pathPrefix: string | undefined, k: number): Promise<SearchResult[]> {
    const terms = query
        .split(/\s+/)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .filter((t) => t.length > 0);
    if (terms.length === 0) return [];
    const searchPath = pathPrefix ? path.posix.join('knowledge', pathPrefix) : 'knowledge';
    try {
        const res = await files.grep({ pattern: terms.join('|'), searchPath, fileGlob: '**/*.md', maxResults: k });
        return res.matches.map((m) => ({
            path: m.file,
            headingAnchor: '',
            backlink: `${m.file}:${m.line}`,
            snippet: m.content,
            score: 0,
            startLine: m.line,
            endLine: m.line,
        }));
    } catch {
        return [];
    }
}

// --- indexing (the sync tick) ------------------------------------------------

let inFlight: Promise<IndexStats | { disabled: true }> | null = null;

/**
 * runMemoryIndex performs one incremental index pass over the vault. Safe to call
 * on every knowledge sync tick: idempotent and a no-op when nothing changed.
 * Single-flighted — overlapping calls share the in-flight pass rather than racing
 * two indexers on the same on-disk store. Emits the `memory_index_built` analytics
 * event when a pass did real work.
 *
 * @returns The pass metrics ({@link IndexStats}), or `{ disabled: true }` when the
 *          memory index is turned off in config.
 *
 * @example
 * ```ts
 * const stats = await runMemoryIndex();
 * if (!('disabled' in stats)) console.log(`indexed ${stats.chunkCount} chunks`);
 * ```
 */
export function runMemoryIndex(): Promise<IndexStats | { disabled: true }> {
    if (inFlight) return inFlight;
    inFlight = runMemoryIndexOnce().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

async function runMemoryIndexOnce(): Promise<IndexStats | { disabled: true }> {
    const cfg = loadMemoryConfig();
    if (!cfg.enabled) return { disabled: true };
    const target = await resolveEmbedTarget(cfg.model, cfg.embedDimensions);
    const indexer = new Indexer({
        dir: indexDir(),
        knowledgeDir: knowledgeDir(),
        model: cfg.model,
        // A requested Matryoshka size pins the dims (and the stored vectors are that size);
        // otherwise fall back to the configured/inferred dims.
        dimsHint: cfg.embedDimensions || cfg.dims,
        batchSize: cfg.batchSize,
        maxMonthlyEmbedTokens: cfg.maxMonthlyEmbedTokens,
        embed: (texts) => embedBatch(target, texts),
        log: (m) => console.log(m),
    });
    const stats = await indexer.run(Date.now());
    // Invalidate the cached index so the next search sees the new vectors.
    cached = null;
    if (stats.filesProcessed > 0 || stats.rebuilt) {
        console.log(
            `[memory] indexed files=${stats.filesProcessed} new=${stats.chunksNew} reused=${stats.chunksReused} ` +
                `deleted=${stats.chunksDeleted} tokens=${stats.tokens} chunks=${stats.chunkCount} ` +
                `rebuilt=${stats.rebuilt} paused=${stats.paused} ms=${stats.durationMs}`,
        );
        capture('memory_index_built', {
            files_processed: stats.filesProcessed,
            chunks: stats.chunkCount,
            chunks_new: stats.chunksNew,
            chunks_reused: stats.chunksReused,
            chunks_deleted: stats.chunksDeleted,
            tokens: stats.tokens,
            rebuilt: stats.rebuilt,
            paused: stats.paused,
            duration_ms: stats.durationMs,
            metered: target.metered,
        });
    }
    return stats;
}

// --- status + related notes (UI surfaces) ------------------------------------

/** A lightweight snapshot of the index for the Settings UI (no vector load). */
export interface MemoryStatus {
    enabled: boolean;
    model: string | null;
    dims: number;
    chunkCount: number;
    lastBuiltMs: number | null;
}

/** memoryStatus reads index size + freshness from the manifest without loading vectors. */
export function memoryStatus(): MemoryStatus {
    const cfg = loadMemoryConfig();
    const manifest = MemoryIndex.readManifest(indexDir());
    const chunkCount = manifest ? Object.values(manifest.files).reduce((n, f) => n + f.chunks.length, 0) : 0;
    const mtime = manifestMtimeMs();
    return {
        enabled: cfg.enabled,
        model: manifest?.model ?? null,
        dims: manifest?.dims ?? 0,
        chunkCount,
        lastBuiltMs: mtime > 0 ? mtime : null,
    };
}

/** A semantically-related note (a neighbor of some source note). */
export interface RelatedNote {
    path: string;
    score: number;
}

/**
 * relatedNotes returns notes most similar to `notePath` by mean-pooled chunk vector
 * (excluding the note itself). Synchronous — it reuses the stored vectors, no
 * embedding call. Empty when memory is disabled or no index exists yet.
 */
export function relatedNotes(notePath: string, k = 8): RelatedNote[] {
    const cfg = loadMemoryConfig();
    if (!cfg.enabled) return [];
    const persisted = MemoryIndex.readManifest(indexDir());
    if (!persisted || persisted.dims === 0) return [];
    return loadedIndex(persisted.model, persisted.dims).relatedPaths(notePath, k);
}

export type { SearchResponse } from './retriever.js';
export type { SearchResult } from './types.js';
