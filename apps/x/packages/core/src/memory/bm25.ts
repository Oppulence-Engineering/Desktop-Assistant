// Lightweight in-memory BM25 over the chunk corpus (RFC 021). Tokenization
// preserves identifiers (invoice numbers, emails) so exact-string recall ranks
// well alongside the vector pass.

const K1 = 1.5;
const B = 0.75;

/**
 * tokenize lowercases and splits on whitespace, trimming surrounding punctuation
 * but keeping internal `-`, `.`, `_`, `@`, `/` so identifiers like `"INV-456"` and
 * `"a@b.com"` survive as single terms (the property that makes exact-id recall work).
 *
 * @param text - Raw text to tokenize.
 * @returns Lowercased tokens, in order, with empty tokens dropped.
 */
export function tokenize(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.toLowerCase().split(/\s+/)) {
        const t = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        if (t.length > 0) out.push(t);
    }
    return out;
}

// BM25Doc/BM25Hit are generic over the caller's ref type, so they stay plain
// interfaces — zod cannot express a type parameter.

/** An input document for {@link BM25}: an opaque `ref` plus its searchable `text`. */
export interface BM25Doc<T> {
    /** Caller-supplied handle returned on a hit (e.g. a corpus entry). */
    ref: T;
    /** The text to index for this document. */
    text: string;
}

/** A scored match from {@link BM25.search}. */
export interface BM25Hit<T> {
    /** The matched document's `ref`. */
    ref: T;
    /** BM25 relevance score (higher = better). */
    score: number;
}

/**
 * BM25 ranks documents for a query using the Okapi BM25 formula (k1=1.5, b=0.75).
 * Built once per corpus snapshot; `search` may be called repeatedly against it.
 */
export class BM25<T> {
    private docTokens: string[][] = [];
    private refs: T[] = [];
    private df = new Map<string, number>();
    private avgLen = 0;
    private readonly n: number;

    constructor(docs: BM25Doc<T>[]) {
        this.n = docs.length;
        let totalLen = 0;
        for (const d of docs) {
            const toks = tokenize(d.text);
            this.docTokens.push(toks);
            this.refs.push(d.ref);
            totalLen += toks.length;
            const seen = new Set<string>();
            for (const t of toks) {
                if (!seen.has(t)) {
                    seen.add(t);
                    this.df.set(t, (this.df.get(t) ?? 0) + 1);
                }
            }
        }
        this.avgLen = this.n > 0 ? totalLen / this.n : 0;
    }

    /**
     * Rank the corpus against a query.
     *
     * @param query - The query text (tokenized the same way as documents).
     * @param topN - Maximum number of hits to return.
     * @returns Up to `topN` hits with score > 0, sorted by score descending.
     */
    search(query: string, topN: number): BM25Hit<T>[] {
        if (this.n === 0) return [];
        const qTerms = Array.from(new Set(tokenize(query)));
        const hits: BM25Hit<T>[] = [];
        for (let i = 0; i < this.docTokens.length; i++) {
            const toks = this.docTokens[i];
            if (toks.length === 0) continue;
            const tf = new Map<string, number>();
            for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
            let score = 0;
            for (const term of qTerms) {
                const f = tf.get(term);
                if (!f) continue;
                const dft = this.df.get(term) ?? 0;
                const idf = Math.log(1 + (this.n - dft + 0.5) / (dft + 0.5));
                const denom = f + K1 * (1 - B + (B * toks.length) / (this.avgLen || 1));
                score += idf * ((f * (K1 + 1)) / denom);
            }
            if (score > 0) hits.push({ ref: this.refs[i], score });
        }
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, topN);
    }
}
