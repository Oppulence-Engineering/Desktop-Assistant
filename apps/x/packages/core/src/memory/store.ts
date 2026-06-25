// Local vector store + manifest for the semantic memory index (RFC 021).
//
// Single embeddable store under WorkDir/index/, no daemon and no native
// dependency: vectors live in a compact binary file (Float32), the manifest
// (files → chunks → vectorId, the incremental source of truth) and the BM25
// corpus (vectorId → text) live in JSON. This is the pure-TS store; sqlite-vec
// is the documented scale-up path (RFC 021 Alternatives, revisit at >1M chunks).
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BM25, type BM25Hit } from './bm25.js';
import { ChunkMeta } from './types.js';

/** On-disk manifest format version; a mismatch forces a full rebuild. */
const MANIFEST_VERSION = 1;

/**
 * One chunk's entry in the manifest: its anchor, content hash (the incremental
 * re-embed key), and the `vectorId` that ties it to a row in `vectors.bin` and a
 * record in `corpus.json`. Persisted inside {@link Manifest}.
 */
export const ManifestChunk = z.object({
    /** Heading anchor of the chunk (mirrors {@link ChunkMeta.headingAnchor}). */
    anchor: z.string(),
    /** sha256 of the chunk text — unchanged hash ⇒ the vector is reused on re-index. */
    chunkHash: z.string(),
    /** Stable id linking this chunk to its row in `vectors.bin` and `corpus.json`. */
    vectorId: z.number().int(),
    /** 1-based inclusive start line in the source note. */
    startLine: z.number().int(),
    /** 1-based inclusive end line in the source note. */
    endLine: z.number().int(),
    /** Frontmatter id when the chunk is an entity card. */
    frontmatterId: z.string().optional(),
});
export type ManifestChunk = z.infer<typeof ManifestChunk>;

/** A file's manifest entry: its change-detection keys plus its chunk list. */
export const ManifestFile = z.object({
    /** Source file mtime (ISO string) — the cheap first-pass change check. */
    mtime: z.string(),
    /** sha256 of the whole file — the authoritative change check. */
    hash: z.string(),
    /** The file's chunks, in document order. */
    chunks: z.array(ManifestChunk),
});
export type ManifestFile = z.infer<typeof ManifestFile>;

/**
 * The persisted `manifest.json`: the incremental source of truth for "what is
 * indexed, at which content hash, under which model/dims". Written last on every
 * persist as the consistency anchor (its chunk count is cross-checked against
 * `vectors.bin` and `corpus.json`).
 */
export const Manifest = z.object({
    /** Format version; mismatch vs {@link MANIFEST_VERSION} forces a rebuild. */
    version: z.number().int(),
    /** Embedding model that produced the vectors; mismatch forces a rebuild. */
    model: z.string(),
    /** Vector dimensionality; mismatch forces a rebuild. */
    dims: z.number().int(),
    /** Vault-relative path → that file's manifest entry. */
    files: z.record(z.string(), ManifestFile),
});
export type Manifest = z.infer<typeof Manifest>;

/** A chunk ready to upsert: its metadata, embedding vector, and text. */
export const IndexChunk = z.object({
    /** Provenance + change-detection metadata. */
    meta: ChunkMeta,
    /** The embedding vector (length = manifest dims). */
    vec: z.array(z.number()),
    /** The chunk text (stored in the corpus for lexical search). */
    text: z.string(),
});
export type IndexChunk = z.infer<typeof IndexChunk>;

/**
 * A corpus entry the retriever scores (vector + lexical). This is also the exact
 * shape of each record persisted in `corpus.json` (see {@link CorpusFile}), so the
 * same schema validates the corpus on load.
 */
export const CorpusEntry = z.object({
    /** Stable id linking back to the vector and manifest chunk. */
    vectorId: z.number().int(),
    /** Provenance + change-detection metadata. */
    meta: ChunkMeta,
    /** The chunk text (BM25 input + result snippet source). */
    text: z.string(),
});
export type CorpusEntry = z.infer<typeof CorpusEntry>;

/** The persisted `corpus.json` shape: a flat list of {@link CorpusEntry} records. */
const CorpusFile = z.object({
    records: z.array(CorpusEntry),
});

/** A single cosine-similarity hit returned by {@link MemoryIndex.query}. */
export const QueryHit = z.object({
    /** Provenance + change-detection metadata of the matched chunk. */
    meta: ChunkMeta,
    /** The matched chunk text. */
    text: z.string(),
    /** Cosine similarity in [-1, 1] (higher = closer). */
    score: z.number(),
});
export type QueryHit = z.infer<typeof QueryHit>;

/**
 * MemoryIndex owns the manifest, the vectors, and the BM25 corpus. It is the
 * single source of truth for "what is indexed at which content hash". Incremental
 * indexing replaces a file's chunks atomically (setFile / removeFile).
 */
export class MemoryIndex {
    private manifest: Manifest;
    private vectors = new Map<number, Float32Array>();
    private text = new Map<number, string>();
    private meta = new Map<number, ChunkMeta>();
    private nextId = 1;
    private dirty = false;
    /** Lazily-built BM25 over the corpus; invalidated whenever the corpus changes. */
    private bm25Cache: BM25<CorpusEntry> | null = null;

    private constructor(
        private readonly dir: string,
        manifest: Manifest,
    ) {
        this.manifest = manifest;
    }

    /** open loads (or initializes) the index at WorkDir/index for model+dims. */
    static open(dir: string, model: string, dims: number): MemoryIndex {
        fs.mkdirSync(dir, { recursive: true });
        const manifestPath = path.join(dir, 'manifest.json');
        let manifest: Manifest = { version: MANIFEST_VERSION, model, dims, files: {} };
        if (fs.existsSync(manifestPath)) {
            // Validate the persisted manifest; an unreadable or malformed manifest
            // is treated as "no index" → a clean build under the requested model+dims.
            const parsed = Manifest.safeParse(readJsonSafe(manifestPath));
            if (parsed.success) manifest = parsed.data;
        }
        const idx = new MemoryIndex(dir, manifest);
        // A model/dims mismatch means vectors are incomparable → start clean.
        if (manifest.model !== model || manifest.dims !== dims || manifest.version !== MANIFEST_VERSION) {
            idx.manifest = { version: MANIFEST_VERSION, model, dims, files: {} };
            return idx;
        }
        idx.loadVectors();
        idx.loadCorpus();
        idx.rebuildNextId();
        // Corruption guard (RFC 021 failure modes): if a crash left the manifest,
        // vectors, and corpus inconsistent, drop to an empty index so the retriever
        // degrades to lexical and the indexer rebuilds on its next pass.
        if (!idx.selfConsistent()) {
            idx.vectors.clear();
            idx.text.clear();
            idx.meta.clear();
            idx.manifest = { version: MANIFEST_VERSION, model, dims, files: {} };
            idx.nextId = 1;
        }
        return idx;
    }

    /** isStoreConsistent cheaply checks (by counts) whether the persisted
     *  manifest, vectors, and corpus agree — used by the indexer to force a
     *  rebuild after a partial/corrupt write without loading the vectors. */
    static isStoreConsistent(dir: string): boolean {
        const manifest = MemoryIndex.readManifest(dir);
        if (!manifest) return true; // nothing persisted yet → "consistent" (fresh build)
        const manifestChunks = Object.values(manifest.files).reduce((n, f) => n + f.chunks.length, 0);
        const vectorCount = vectorRecordCount(path.join(dir, 'vectors.bin'), manifest.dims);
        const corpusCount = corpusRecordCount(path.join(dir, 'corpus.json'));
        if (vectorCount === null || corpusCount === null) return manifestChunks === 0;
        return manifestChunks === vectorCount && manifestChunks === corpusCount;
    }

    /** readDims returns the persisted manifest's vector dimensionality (the
     *  authoritative dims for the stored vectors), or null when absent. */
    static readDims(dir: string): number | null {
        const m = MemoryIndex.readManifest(dir);
        return m ? m.dims : null;
    }

    /** selfConsistent verifies every manifest chunk has a loaded vector + corpus
     *  entry (a stricter, in-memory version of isStoreConsistent). */
    private selfConsistent(): boolean {
        for (const f of Object.values(this.manifest.files)) {
            for (const c of f.chunks) {
                if (!this.vectors.has(c.vectorId) || !this.text.has(c.vectorId)) return false;
            }
        }
        return true;
    }

    /** readManifest peeks at the persisted manifest (file→hash map, model, dims)
     *  WITHOUT loading vectors — used by the indexer to diff the vault cheaply. */
    static readManifest(dir: string): Manifest | null {
        const manifestPath = path.join(dir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return null;
        const parsed = Manifest.safeParse(readJsonSafe(manifestPath));
        return parsed.success ? parsed.data : null;
    }

    /** existingVector returns a still-stored vector for a chunk hash within a
     *  file, enabling chunk-level incremental re-embed (reuse unchanged chunks). */
    existingVector(relPath: string, chunkHash: string): number[] | undefined {
        const f = this.manifest.files[relPath];
        if (!f) return undefined;
        const c = f.chunks.find((x) => x.chunkHash === chunkHash);
        if (!c) return undefined;
        const v = this.vectors.get(c.vectorId);
        return v ? Array.from(v) : undefined;
    }

    /** needsRebuild reports whether a persisted index is incompatible with model+dims. */
    static needsRebuild(dir: string, model: string, dims: number): boolean {
        const manifestPath = path.join(dir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return false; // nothing to rebuild; fresh build
        const parsed = Manifest.safeParse(readJsonSafe(manifestPath));
        if (!parsed.success) return true; // unreadable/invalid manifest → rebuild
        const m = parsed.data;
        return m.model !== model || m.dims !== dims || m.version !== MANIFEST_VERSION;
    }

    model(): string {
        return this.manifest.model;
    }
    dims(): number {
        return this.manifest.dims;
    }
    chunkCount(): number {
        return this.vectors.size;
    }
    fileEntry(relPath: string): ManifestFile | undefined {
        return this.manifest.files[relPath];
    }

    /** setFile replaces all chunks for a file (removing prior ones first). */
    setFile(relPath: string, mtime: string, hash: string, chunks: IndexChunk[]): void {
        this.removeFile(relPath);
        const manifestChunks: ManifestChunk[] = [];
        for (const c of chunks) {
            const vectorId = this.nextId++;
            this.vectors.set(vectorId, Float32Array.from(c.vec));
            this.text.set(vectorId, c.text);
            this.meta.set(vectorId, c.meta);
            manifestChunks.push({
                anchor: c.meta.headingAnchor,
                chunkHash: c.meta.contentHash,
                vectorId,
                startLine: c.meta.startLine,
                endLine: c.meta.endLine,
                frontmatterId: c.meta.frontmatterId,
            });
        }
        this.manifest.files[relPath] = { mtime, hash, chunks: manifestChunks };
        this.dirty = true;
        this.bm25Cache = null; // corpus changed → drop the cached BM25
    }

    /** removeFile drops a file and all its vectors/corpus entries. */
    removeFile(relPath: string): void {
        const existing = this.manifest.files[relPath];
        if (!existing) return;
        for (const c of existing.chunks) {
            this.vectors.delete(c.vectorId);
            this.text.delete(c.vectorId);
            this.meta.delete(c.vectorId);
        }
        delete this.manifest.files[relPath];
        this.dirty = true;
        this.bm25Cache = null; // corpus changed → drop the cached BM25
    }

    /** indexedPaths lists the vault-relative paths currently in the index. */
    indexedPaths(): string[] {
        return Object.keys(this.manifest.files);
    }

    /** corpus returns every chunk for the lexical (BM25) pass. */
    corpus(): CorpusEntry[] {
        const out: CorpusEntry[] = [];
        for (const [vectorId, text] of this.text) {
            const meta = this.meta.get(vectorId);
            if (meta) out.push({ vectorId, meta, text });
        }
        return out;
    }

    /**
     * lexicalSearch ranks the corpus by BM25. The BM25 index is built once on first
     * use and cached until the corpus changes (vs the previous behaviour of rebuilding
     * it on every search). A `pathPrefix` filters the full-corpus ranking — IDF stays
     * global, which is the desirable behaviour for scoped queries.
     *
     * @param query - The query text.
     * @param topN - Maximum hits to return.
     * @param pathPrefix - Optional vault-path prefix to scope results to.
     * @returns BM25 hits (`ref` = the corpus entry, `score` = BM25), best first.
     */
    lexicalSearch(query: string, topN: number, pathPrefix?: string): BM25Hit<CorpusEntry>[] {
        if (!this.bm25Cache) {
            this.bm25Cache = new BM25(this.corpus().map((c) => ({ ref: c, text: c.text })));
        }
        if (!pathPrefix) return this.bm25Cache.search(query, topN);
        // Over-fetch then filter so a scoped query still returns up to topN hits.
        const raw = this.bm25Cache.search(query, Math.max(topN * 5, 200));
        return raw.filter((h) => h.ref.meta.path.startsWith(pathPrefix)).slice(0, topN);
    }

    /**
     * relatedPaths returns the vault paths most similar to `notePath`, by the cosine
     * similarity of the note's mean-pooled chunk vector to other chunks, keeping the
     * best score per other path. Reuses stored vectors (no embedding). Empty when the
     * note has no indexed vectors.
     */
    relatedPaths(notePath: string, n: number): Array<{ path: string; score: number }> {
        const file = this.manifest.files[notePath];
        if (!file || file.chunks.length === 0) return [];
        const dims = this.manifest.dims;
        const mean = new Float32Array(dims);
        let count = 0;
        for (const c of file.chunks) {
            const v = this.vectors.get(c.vectorId);
            if (!v) continue;
            for (let i = 0; i < dims; i++) mean[i] += v[i] ?? 0;
            count++;
        }
        if (count === 0) return [];
        for (let i = 0; i < dims; i++) mean[i] /= count;
        // Over-fetch chunk hits, then keep the best score per OTHER note.
        const best = new Map<string, number>();
        for (const hit of this.query(Array.from(mean), n * 6)) {
            if (hit.meta.path === notePath) continue;
            const prev = best.get(hit.meta.path);
            if (prev === undefined || hit.score > prev) best.set(hit.meta.path, hit.score);
        }
        return Array.from(best.entries())
            .map(([path, score]) => ({ path, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, n);
    }

    /** query returns the top-n chunks by cosine similarity to qvec. */
    query(qvec: number[], n: number, pathPrefix?: string): QueryHit[] {
        const q = Float32Array.from(qvec);
        const qn = norm(q);
        if (qn === 0) return [];
        const hits: QueryHit[] = [];
        for (const [vectorId, vec] of this.vectors) {
            const meta = this.meta.get(vectorId);
            if (!meta) continue; // corpus/vectors drift → skip rather than crash
            if (pathPrefix && !meta.path.startsWith(pathPrefix)) continue;
            const vn = norm(vec);
            if (vn === 0) continue;
            hits.push({ meta, text: this.text.get(vectorId) ?? '', score: dot(q, vec) / (qn * vn) });
        }
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, n);
    }

    /** persist writes the vectors, corpus, then manifest to disk — manifest LAST
     *  as the commit marker — each via a temp-file rename so a crash mid-write
     *  never leaves a partially-written file. No-op when nothing changed. */
    persist(): void {
        if (!this.dirty) return;
        fs.mkdirSync(this.dir, { recursive: true });
        this.writeVectors();
        this.writeCorpus();
        // Manifest renamed last: it is the consistency anchor (its chunk count is
        // cross-checked against vectors/corpus on load).
        writeFileAtomic(path.join(this.dir, 'manifest.json'), Buffer.from(JSON.stringify(this.manifest, null, 2)));
        this.dirty = false;
    }

    // --- persistence ---------------------------------------------------------

    private vectorsPath(): string {
        return path.join(this.dir, 'vectors.bin');
    }
    private corpusPath(): string {
        return path.join(this.dir, 'corpus.json');
    }

    private writeVectors(): void {
        const dims = this.manifest.dims;
        const recSize = 4 + dims * 4; // uint32 id + dims float32
        const buf = Buffer.alloc(8 + this.vectors.size * recSize);
        buf.writeUInt32LE(MANIFEST_VERSION, 0);
        buf.writeUInt32LE(dims, 4);
        let off = 8;
        for (const [vectorId, vec] of this.vectors) {
            buf.writeUInt32LE(vectorId, off);
            off += 4;
            for (let i = 0; i < dims; i++) {
                buf.writeFloatLE(vec[i] ?? 0, off);
                off += 4;
            }
        }
        writeFileAtomic(this.vectorsPath(), buf);
    }

    private loadVectors(): void {
        const p = this.vectorsPath();
        if (!fs.existsSync(p)) return;
        const buf = fs.readFileSync(p);
        if (buf.length < 8) return;
        const dims = buf.readUInt32LE(4);
        if (dims !== this.manifest.dims) return; // mismatch → leave empty (rebuild)
        const recSize = 4 + dims * 4;
        let off = 8;
        while (off + recSize <= buf.length) {
            const vectorId = buf.readUInt32LE(off);
            off += 4;
            const vec = new Float32Array(dims);
            for (let i = 0; i < dims; i++) {
                vec[i] = buf.readFloatLE(off);
                off += 4;
            }
            this.vectors.set(vectorId, vec);
        }
    }

    private writeCorpus(): void {
        const records: Array<{ vectorId: number; meta: ChunkMeta; text: string }> = [];
        for (const [vectorId, text] of this.text) {
            const meta = this.meta.get(vectorId);
            if (meta) records.push({ vectorId, meta, text });
        }
        writeFileAtomic(this.corpusPath(), Buffer.from(JSON.stringify({ records })));
    }

    private loadCorpus(): void {
        const p = this.corpusPath();
        if (!fs.existsSync(p)) return;
        const parsed = CorpusFile.safeParse(readJsonSafe(p));
        // A corrupt/malformed corpus is left empty on purpose: the consistency guard
        // in open() then sees manifest chunks without text and drops to an empty
        // index, so the retriever degrades to lexical and the indexer rebuilds.
        if (!parsed.success) return;
        for (const r of parsed.data.records) {
            this.text.set(r.vectorId, r.text);
            this.meta.set(r.vectorId, r.meta);
        }
    }

    private rebuildNextId(): void {
        let max = 0;
        for (const f of Object.values(this.manifest.files)) {
            for (const c of f.chunks) if (c.vectorId > max) max = c.vectorId;
        }
        this.nextId = max + 1;
    }
}

/** writeFileAtomic writes via a sibling temp file + rename (atomic on the same
 *  filesystem), so a crash mid-write never leaves a half-written file. */
function writeFileAtomic(target: string, data: Buffer): void {
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
}

/** vectorRecordCount derives the record count from vectors.bin's size + header
 *  (no full read). Returns null when the file is absent/too small/dims-mismatched. */
function vectorRecordCount(p: string, dims: number): number | null {
    try {
        const size = fs.statSync(p).size;
        if (size < 8 || dims <= 0) return null;
        const recSize = 4 + dims * 4;
        const stored = (size - 8) % recSize === 0 ? (size - 8) / recSize : null;
        return stored;
    } catch {
        return null;
    }
}

/**
 * corpusRecordCount validates `corpus.json` and returns its record count for the
 * consistency cross-check. A malformed corpus returns `null` (treated as
 * inconsistent), which forces a rebuild rather than serving partial data.
 */
function corpusRecordCount(p: string): number | null {
    const parsed = CorpusFile.safeParse(readJsonSafe(p));
    return parsed.success ? parsed.data.records.length : null;
}

/** readJsonSafe reads + JSON-parses a file, returning `undefined` on any I/O or
 *  syntax error so callers can `safeParse(undefined)` and fall back uniformly. */
function readJsonSafe(p: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return undefined;
    }
}

function dot(a: Float32Array, b: Float32Array): number {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}

function norm(a: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s);
}
