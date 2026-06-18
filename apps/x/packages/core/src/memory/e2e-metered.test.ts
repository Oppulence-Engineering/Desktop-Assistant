// Live end-to-end test of the memory index over the REAL metered path:
//   desktop runMemoryIndex/memorySearch → embed.ts (metered) → rowboat-api
//   /v1/llm/embeddings → real OpenAI text-embedding-3-small → on-disk index → search.
//
// Gated behind MEMORY_E2E_METERED=1 (and a live kind stack), so it never runs in
// the normal unit suite. Run with:
//   API_URL=http://localhost:18085 MEMORY_E2E_METERED=1 \
//     ./node_modules/.bin/vitest run src/memory/e2e-metered.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Isolate the desktop data dir; everything else (embed, auth, retriever) is REAL.
const TEST_WORKDIR = vi.hoisted(() => '/tmp/rowboat-mem-e2e-metered');
vi.mock('../config/config.js', async (io) => ({
    ...(await io<typeof import('../config/config.js')>()),
    WorkDir: TEST_WORKDIR,
}));

import { runMemoryIndex, memorySearch } from './index.js';

const RUN = process.env.MEMORY_E2E_METERED === '1';
const MINT =
    process.env.E2E_MINT_URL ||
    'http://localhost:18090/mint?workos_user_id=user_kind_smoke&email=kind%40solomon-ai.co';

describe.runIf(RUN)('memory index — live metered E2E (rowboat-api → real OpenAI)', () => {
    beforeAll(async () => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_WORKDIR, 'config'), { recursive: true });
        fs.mkdirSync(path.join(TEST_WORKDIR, 'knowledge'), { recursive: true });

        // solomon flavor → embed.ts chooses the metered proxy path.
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'models.json'),
            JSON.stringify({ provider: { flavor: 'solomon' }, model: 'mock' }),
        );
        // Embed model "openai/…" so rowboat-api's router proxies to real OpenAI; dims probed.
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'index.json'),
            JSON.stringify({ enabled: true, model: 'openai/text-embedding-3-small', dims: 0, batchSize: 64 }),
        );

        // Mint a real devstack token and plant it (unexpired) under both product ids.
        const minted = (await (await fetch(MINT)).json()) as Record<string, string>;
        const access = minted.access_token || minted.token || minted.accessToken;
        if (!access) throw new Error(`mint returned no token: ${JSON.stringify(Object.keys(minted))}`);
        const tokens = { access_token: access, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + 3000 };
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'oauth.json'),
            JSON.stringify({ providers: { solomon: { tokens }, rowboat: { tokens } } }),
        );

        // Three notes on clearly different topics.
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'knowledge', 'Acme-Invoice.md'),
            '# Acme Corp\n\nThe outstanding accounts-receivable balance for Acme is overdue; the payment is thirty days late.',
        );
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'knowledge', 'Recipe.md'),
            '# Banana Bread\n\nCream the butter and sugar, fold in mashed bananas and flour, then bake at 350F.',
        );
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'knowledge', 'Standup.md'),
            '# Team Standup\n\nDiscussed sprint velocity, the code review backlog, and the deploy schedule.',
        );
    }, 60_000);

    afterAll(() => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
    });

    it('indexes via the metered proxy, then finds the right note SEMANTICALLY', async () => {
        const stats = await runMemoryIndex();
        console.log('[index stats]', stats);
        expect('disabled' in stats).toBe(false);
        if (!('disabled' in stats)) {
            expect(stats.filesProcessed).toBe(3);
            expect(stats.chunkCount).toBeGreaterThanOrEqual(3);
            expect(stats.tokens).toBeGreaterThan(0); // real embedding tokens were billed
        }

        // Query shares NO keywords with the target note ("unpaid bill / customer"
        // vs "accounts-receivable / overdue / payment") — so a correct top hit can
        // only come from neural embeddings, not BM25 lexical overlap.
        const res = await memorySearch('money a customer still owes us on an unpaid bill', { k: 3 });
        console.log(
            '[search] mode=%s results=%o',
            res.mode,
            res.results.map((r) => ({ path: r.path, score: Number(r.score.toFixed(4)), snippet: r.snippet.slice(0, 50) })),
        );
        expect(res.mode).toBe('hybrid'); // 'hybrid' ⇒ the live embedding round-trip succeeded
        expect(res.results[0].path).toBe('Acme-Invoice.md'); // semantic match, no shared keywords
    }, 60_000);
});
