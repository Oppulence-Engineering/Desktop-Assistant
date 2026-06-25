// Gated offline retrieval-quality eval (RFC 021). Builds the index over a committed
// corpus with a DETERMINISTIC embedder (so results are reproducible + CI-safe) and
// measures recall@k / MRR / nDCG@k per bucket against budgets — a regression gate
// for ranking changes (fusion, diversity, recency, scoring). Mirrors the gated
// shape of voice/whisper/whisper.eval.test.ts.
//
// Run: MEMORY_RETRIEVAL_EVAL=1 ./node_modules/.bin/vitest run \
//        src/memory/retrieval.eval.test.ts --disableConsoleIntercept
//
// (A real-embedding mode against the live stack — true semantics — is covered
// qualitatively by e2e-metered.test.ts / e2e-feature.test.ts.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryIndex, type IndexChunk } from './store.js';
import { Retriever } from './retriever.js';
import { chunkMarkdown } from './chunker.js';
import { tokenize } from './bm25.js';

const RUN = process.env.MEMORY_RETRIEVAL_EVAL === '1';
const DIM = 64;
const K = 3;
const BUDGET = { recall: 0.8, mrr: 0.7, ndcg: 0.7 };

interface Corpus {
    corpus: Array<{ path: string; text: string }>;
    queries: Array<{ id: string; query: string; relevantPaths: string[]; bucket: string }>;
}

/** Deterministic hashed bag-of-words embedding (shared tokens → similar vectors). */
function hashEmbed(text: string, dim: number): number[] {
    const v = new Array<number>(dim).fill(0);
    for (const tok of tokenize(text)) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) {
            h ^= tok.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        v[Math.abs(h) % dim] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
}

function metricsFor(resultPaths: string[], relevant: string[]): { recall: number; mrr: number; ndcg: number } {
    const top = Array.from(new Set(resultPaths)).slice(0, K);
    const rel = new Set(relevant);
    const firstHit = top.findIndex((p) => rel.has(p));
    const found = top.filter((p) => rel.has(p)).length;
    let dcg = 0;
    top.forEach((p, i) => {
        if (rel.has(p)) dcg += 1 / Math.log2(i + 2);
    });
    let idcg = 0;
    for (let i = 0; i < Math.min(relevant.length, K); i++) idcg += 1 / Math.log2(i + 2);
    return {
        recall: relevant.length ? found / relevant.length : 0,
        mrr: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
        ndcg: idcg > 0 ? dcg / idcg : 0,
    };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

describe.runIf(RUN)('memory retrieval eval (deterministic embedder)', () => {
    let dir: string;
    let data: Corpus;
    let retriever: Retriever;

    beforeAll(() => {
        data = JSON.parse(fs.readFileSync(new URL('./__fixtures__/retrieval/queries.json', import.meta.url), 'utf-8'));
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-eval-'));
        const idx = MemoryIndex.open(dir, 'eval-embedder', DIM);
        for (const note of data.corpus) {
            const indexChunks: IndexChunk[] = chunkMarkdown(note.path, note.text).map((c) => ({
                meta: c.meta,
                vec: hashEmbed(c.text, DIM),
                text: c.text,
            }));
            idx.setFile(note.path, '2026-01-01T00:00:00.000Z', 'h', indexChunks);
        }
        retriever = new Retriever(idx, async (q) => hashEmbed(q, DIM), async () => [], {
            maxPerNote: 2,
            recencyWeight: 0,
            snippetChars: 600,
        });
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it(`meets retrieval budgets (recall@${K} / MRR / nDCG@${K})`, async () => {
        const perBucket: Record<string, { recall: number[]; mrr: number[]; ndcg: number[] }> = {};
        const all = { recall: [] as number[], mrr: [] as number[], ndcg: [] as number[] };

        for (const q of data.queries) {
            const res = await retriever.search(q.query, { k: K });
            const m = metricsFor(
                res.results.map((r) => r.path),
                q.relevantPaths,
            );
            (perBucket[q.bucket] ??= { recall: [], mrr: [], ndcg: [] }).recall.push(m.recall);
            perBucket[q.bucket].mrr.push(m.mrr);
            perBucket[q.bucket].ndcg.push(m.ndcg);
            all.recall.push(m.recall);
            all.mrr.push(m.mrr);
            all.ndcg.push(m.ndcg);
        }

        console.log('\n[retrieval eval] per-bucket:');
        for (const [bucket, b] of Object.entries(perBucket)) {
            console.log(
                `  ${bucket.padEnd(10)} recall@${K}=${mean(b.recall).toFixed(2)}  MRR=${mean(b.mrr).toFixed(2)}  nDCG@${K}=${mean(b.ndcg).toFixed(2)}`,
            );
        }
        console.log(
            `  ${'OVERALL'.padEnd(10)} recall@${K}=${mean(all.recall).toFixed(2)}  MRR=${mean(all.mrr).toFixed(2)}  nDCG@${K}=${mean(all.ndcg).toFixed(2)}\n`,
        );

        expect(mean(all.recall)).toBeGreaterThanOrEqual(BUDGET.recall);
        expect(mean(all.mrr)).toBeGreaterThanOrEqual(BUDGET.mrr);
        expect(mean(all.ndcg)).toBeGreaterThanOrEqual(BUDGET.ndcg);
    });
});
