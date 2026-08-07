// Incremental indexer (RFC 021). Diffs the markdown vault (mtime+hash, the same
// semantics as knowledge graph_state), chunks changed files, re-embeds ONLY new
// or changed chunks (chunk-hash reuse), and upserts vectors + the manifest. A
// model/dims change forces a full rebuild; a monthly token cap pauses embedding.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { chunkMarkdown } from './chunker.js';
import { MemoryIndex, type IndexChunk } from './store.js';
import type { Chunk } from './types.js';
import { writeJsonAtomicSync } from "../filesystem/atomic_write.js";

/**
 * Embeds a batch of texts and reports the token cost. Injected into {@link Indexer}
 * so the index logic stays decoupled from the embeddings provider (and trivially
 * fakeable in tests). Kept as a plain function type — not a zod schema — because
 * zod cannot meaningfully validate a function value.
 */
export interface EmbedBatchFn {
    (texts: string[]): Promise<{ vectors: number[][]; tokens: number }>;
}

/**
 * Construction options for {@link Indexer}. Plain interface (not a zod schema)
 * because it carries callbacks (`embed`, `log`).
 */
export interface IndexerOptions {
    /** Index dir (`WorkDir/index`). */
    dir: string;
    /** Vault root to index (`WorkDir/knowledge`). */
    knowledgeDir: string;
    /** Embedding model identity; a change vs the manifest forces a full rebuild. */
    model: string;
    /** Vector dimensionality hint; `0` = infer from the first embedding. */
    dimsHint: number;
    /** Chunks per embed request. */
    batchSize: number;
    /** Monthly embed-token cap; `0` = no cap. */
    maxMonthlyEmbedTokens: number;
    /** The embeddings provider (see {@link EmbedBatchFn}). */
    embed: EmbedBatchFn;
    /** Optional progress logger. */
    log?: (msg: string) => void;
}

/** Per-run indexing metrics, returned by {@link Indexer.run} and surfaced to analytics. */
export const IndexStats = z.object({
    /** Files (re)chunked + embedded this pass. */
    filesProcessed: z.number().int(),
    /** Chunks embedded this pass. */
    chunksNew: z.number().int(),
    /** Chunks whose embedding was reused (unchanged content hash). */
    chunksReused: z.number().int(),
    /** Chunks dropped (deleted/changed files). */
    chunksDeleted: z.number().int(),
    /** Embedding tokens consumed this pass. */
    tokens: z.number().int(),
    /** `true` when this pass was a full rebuild (model change or corrupt store). */
    rebuilt: z.boolean(),
    /** `true` when the pass stopped early on the monthly embed-token cap. */
    paused: z.boolean(),
    /** Wall-clock duration of the pass, in ms. */
    durationMs: z.number(),
    /** Total chunks in the index after the pass. */
    chunkCount: z.number().int(),
});
export type IndexStats = z.infer<typeof IndexStats>;

// Well-known embedding dimensions so a fresh index need not probe the provider.
const KNOWN_DIMS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    // On-device (Ollama). Namespaced so the manifest records which provider
    // produced the vectors — see LOCAL_EMBED_MODEL_ID in memory/ollama.ts.
    'ollama/nomic-embed-text': 768,
    // In-process ONNX — see memory/onnx/assets.ts.
    'local/all-MiniLM-L6-v2': 384,
};

/**
 * Indexer performs one incremental (or full) pass over the markdown vault:
 * diff by mtime+hash, chunk changed files, re-embed only new/changed chunks
 * (chunk-hash reuse), upsert vectors + manifest. A model/dims change or a corrupt
 * store forces a full rebuild; the monthly token cap pauses embedding mid-pass.
 */
export class Indexer {
    constructor(private readonly opts: IndexerOptions) {}

    /**
     * Run one indexing pass.
     *
     * @param nowMs - Current epoch ms (injected for deterministic tests; drives the
     *                monthly budget window and the duration metric).
     * @returns Metrics for the pass (see {@link IndexStats}); `filesProcessed === 0`
     *          with `rebuilt === false` means nothing changed (a no-op tick).
     */
    async run(nowMs: number): Promise<IndexStats> {
        const start = nowMs;
        const log = this.opts.log ?? (() => {});
        const stats: IndexStats = {
            filesProcessed: 0,
            chunksNew: 0,
            chunksReused: 0,
            chunksDeleted: 0,
            tokens: 0,
            rebuilt: false,
            paused: false,
            durationMs: 0,
            chunkCount: 0,
        };

        const files = walkMarkdown(this.opts.knowledgeDir);
        const manifest = MemoryIndex.readManifest(this.opts.dir);
        const modelMismatch = !!manifest && manifest.model !== this.opts.model;
        // A partial/corrupt prior write (manifest ⟂ vectors/corpus) forces a clean
        // rebuild rather than serving an inconsistent index (RFC 021 failure modes).
        const corrupt = !!manifest && !MemoryIndex.isStoreConsistent(this.opts.dir);
        if (corrupt) log('[memory] store inconsistent; rebuilding index from scratch');
        const fresh = !manifest || modelMismatch || corrupt;
        stats.rebuilt = modelMismatch || corrupt;

        // Diff: which files are new/changed, which were deleted.
        const changed: string[] = [];
        for (const abs of files) {
            const rel = path.relative(this.opts.knowledgeDir, abs);
            const hash = hashFile(abs);
            const prior = manifest?.files[rel];
            if (fresh || !prior || prior.hash !== hash) changed.push(abs);
        }
        const presentRel = new Set(files.map((f) => path.relative(this.opts.knowledgeDir, f)));
        const deleted = manifest ? Object.keys(manifest.files).filter((rel) => !presentRel.has(rel)) : [];

        if (!fresh && changed.length === 0 && deleted.length === 0) {
            // Nothing to do; report the current size for the gauge.
            const idx = MemoryIndex.open(this.opts.dir, this.opts.model, manifest!.dims);
            stats.chunkCount = idx.chunkCount();
            stats.durationMs = 0;
            return stats;
        }

        const budget = new TokenBudget(this.opts.dir, this.opts.maxMonthlyEmbedTokens, nowMs);

        if (fresh) {
            // Full (re)build: embed every chunk of every present file.
            const dims = await this.resolveFreshDims(files, log);
            if (dims === 0) {
                stats.paused = true;
                stats.durationMs = nowMs - start;
                return stats;
            }
            const idx = MemoryIndex.open(this.opts.dir, this.opts.model, dims); // rebuild on mismatch
            for (const abs of files) {
                if (budget.exhausted()) {
                    stats.paused = true;
                    log('[memory] monthly embed token cap hit; pausing index build');
                    break;
                }
                const rel = path.relative(this.opts.knowledgeDir, abs);
                const chunks = chunkMarkdown(rel, fs.readFileSync(abs, 'utf-8'));
                const indexChunks = await this.embedChunks(chunks, idx, false, budget, stats);
                idx.setFile(rel, mtimeOf(abs), hashFile(abs), indexChunks);
                stats.filesProcessed++;
            }
            idx.persist();
            budget.persist();
            stats.chunkCount = idx.chunkCount();
            stats.durationMs = nowMs - start;
            return stats;
        }

        // Incremental: only changed files; reuse unchanged chunk vectors.
        const idx = MemoryIndex.open(this.opts.dir, this.opts.model, manifest!.dims);
        for (const abs of changed) {
            if (budget.exhausted()) {
                stats.paused = true;
                log('[memory] monthly embed token cap hit; pausing incremental index');
                break;
            }
            const rel = path.relative(this.opts.knowledgeDir, abs);
            const chunks = chunkMarkdown(rel, fs.readFileSync(abs, 'utf-8'));
            const indexChunks = await this.embedChunks(chunks, idx, true, budget, stats);
            idx.setFile(rel, mtimeOf(abs), hashFile(abs), indexChunks);
            stats.filesProcessed++;
        }
        for (const rel of deleted) {
            idx.removeFile(rel);
            stats.chunksDeleted++;
        }
        idx.persist();
        budget.persist();
        stats.chunkCount = idx.chunkCount();
        stats.durationMs = nowMs - start;
        return stats;
    }

    /** embedChunks reuses an existing vector when reuse=true and the chunk hash
     *  is unchanged; otherwise it embeds (counting new/reused for the metric). */
    private async embedChunks(
        chunks: Chunk[],
        idx: MemoryIndex,
        reuse: boolean,
        budget: TokenBudget,
        stats: IndexStats,
    ): Promise<IndexChunk[]> {
        const result: Array<IndexChunk | null> = new Array(chunks.length).fill(null);
        const toEmbed: { i: number; text: string }[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const existing = reuse ? idx.existingVector(c.meta.path, c.meta.contentHash) : undefined;
            if (existing) {
                result[i] = { meta: c.meta, vec: existing, text: c.text };
                stats.chunksReused++;
            } else {
                toEmbed.push({ i, text: c.text });
            }
        }
        for (let b = 0; b < toEmbed.length; b += this.opts.batchSize) {
            if (budget.exhausted()) break;
            const slice = toEmbed.slice(b, b + this.opts.batchSize);
            const { vectors, tokens } = await this.opts.embed(slice.map((s) => s.text));
            budget.add(tokens);
            stats.tokens += tokens;
            for (let j = 0; j < slice.length; j++) {
                const ci = slice[j].i;
                result[ci] = { meta: chunks[ci].meta, vec: vectors[j] ?? [], text: chunks[ci].text };
                stats.chunksNew++;
            }
        }
        return result.filter((x): x is IndexChunk => x !== null && x.vec.length > 0);
    }

    /** resolveFreshDims picks the embedding dimensionality for a fresh build:
     *  the configured hint, the known-model table, else a one-text probe. */
    private async resolveFreshDims(files: string[], log: (m: string) => void): Promise<number> {
        if (this.opts.dimsHint > 0) return this.opts.dimsHint;
        if (KNOWN_DIMS[this.opts.model]) return KNOWN_DIMS[this.opts.model];
        if (files.length === 0) return 0;
        try {
            const probe = await this.opts.embed(['dimension probe']);
            return probe.vectors[0]?.length ?? 0;
        } catch (err) {
            log(`[memory] dimension probe failed: ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
    }
}

/** Persisted monthly embed-token usage (`index/embed_usage.json`). */
const EmbedUsage = z.object({
    /** Month key in `YYYY-MM`. */
    month: z.string(),
    /** Tokens consumed so far this month. */
    tokens: z.number(),
});

/** TokenBudget tracks monthly embed tokens against a cap, persisted to disk. */
class TokenBudget {
    private month: string;
    private tokens: number;
    constructor(
        private readonly dir: string,
        private readonly cap: number,
        nowMs: number,
    ) {
        this.month = new Date(nowMs).toISOString().slice(0, 7); // YYYY-MM
        this.tokens = 0;
        try {
            // Carry over this month's usage; a missing/malformed/other-month file
            // resets to 0 (validate-or-fall-back, never throw).
            const parsed = EmbedUsage.safeParse(JSON.parse(fs.readFileSync(this.path(), 'utf-8')));
            if (parsed.success && parsed.data.month === this.month) this.tokens = parsed.data.tokens;
        } catch {
            // fresh month / no file / unreadable JSON → start at 0
        }
    }
    exhausted(): boolean {
        return this.cap > 0 && this.tokens >= this.cap;
    }
    add(n: number): void {
        this.tokens += n;
    }
    persist(): void {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            // Atomic: a torn file reads as corrupt, the loader answers with
            // tokens = 0, and the monthly embed-token cap silently resets.
            writeJsonAtomicSync(this.path(), { month: this.month, tokens: this.tokens });
        } catch {
            // best-effort
        }
    }
    private path(): string {
        return path.join(this.dir, 'embed_usage.json');
    }
}

function walkMarkdown(root: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(root)) return out;
    // Track visited real directory paths so a symlink cycle can't loop forever.
    const visited = new Set<string>();
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let real: string;
        try {
            real = fs.realpathSync(dir);
        } catch {
            continue;
        }
        if (visited.has(real)) continue;
        visited.add(real);
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            let st: fs.Stats;
            try {
                st = fs.statSync(full); // follows symlinks; the visited set breaks cycles
            } catch {
                continue; // dangling symlink / permission error
            }
            if (st.isDirectory()) stack.push(full);
            else if (st.isFile() && entry.name.endsWith('.md')) out.push(full);
        }
    }
    out.sort();
    return out;
}

function hashFile(abs: string): string {
    // sha256 of content (mirrors knowledge/graph_state.computeFileHash).
    return crypto.createHash('sha256').update(fs.readFileSync(abs, 'utf-8')).digest('hex');
}

function mtimeOf(abs: string): string {
    return fs.statSync(abs).mtime.toISOString();
}
