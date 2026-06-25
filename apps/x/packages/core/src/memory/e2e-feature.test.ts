// FEATURE end-to-end: a real LLM agent turn that autonomously calls the actual
// `memory-search` builtin tool and answers from what it retrieves. Both chat and
// embeddings go through the live metered gateway → rowboat-api → real OpenAI.
//
// Gated behind MEMORY_E2E_FEATURE=1 + a live kind stack. Run with:
//   API_URL=http://localhost:18085 MEMORY_E2E_FEATURE=1 \
//     ./node_modules/.bin/vitest run src/memory/e2e-feature.test.ts --disableConsoleIntercept
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_WORKDIR = vi.hoisted(() => '/tmp/rowboat-mem-e2e-feature');
vi.mock('../config/config.js', async (io) => ({
    ...(await io<typeof import('../config/config.js')>()),
    WorkDir: TEST_WORKDIR,
}));

import { generateText, stepCountIs } from 'ai';
import { runMemoryIndex } from './index.js';
import { createProvider } from '../models/models.js';
import { BuiltinTools } from '../application/lib/builtin-tools.js';

const RUN = process.env.MEMORY_E2E_FEATURE === '1';
const MINT =
    process.env.E2E_MINT_URL ||
    'http://localhost:18090/mint?workos_user_id=user_kind_smoke&email=kind%40solomon-ai.co';
const CHAT_MODEL = process.env.E2E_CHAT_MODEL || 'openai/gpt-4o-mini';

describe.runIf(RUN)('memory FEATURE — agent autonomously uses memory-search (live)', () => {
    beforeAll(async () => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_WORKDIR, 'config'), { recursive: true });
        fs.mkdirSync(path.join(TEST_WORKDIR, 'knowledge'), { recursive: true });
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'models.json'),
            JSON.stringify({ provider: { flavor: 'solomon' }, model: CHAT_MODEL }),
        );
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'index.json'),
            JSON.stringify({ enabled: true, model: 'openai/text-embedding-3-small', dims: 0, batchSize: 64 }),
        );
        const minted = (await (await fetch(MINT)).json()) as Record<string, string>;
        const access = minted.access_token || minted.token || minted.accessToken;
        if (!access) throw new Error('mint returned no token');
        const tokens = { access_token: access, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + 3000 };
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'config', 'oauth.json'),
            JSON.stringify({ providers: { solomon: { tokens }, rowboat: { tokens } } }),
        );
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'knowledge', 'Acme-Invoice.md'),
            '# Acme Corp\n\nThe outstanding accounts-receivable balance for Acme is overdue; the payment is thirty days late. Finance should send a dunning reminder.',
        );
        fs.writeFileSync(
            path.join(TEST_WORKDIR, 'knowledge', 'Recipe.md'),
            '# Banana Bread\n\nCream the butter and sugar, fold in mashed bananas and flour, then bake at 350F.',
        );
        // Build the index over the live metered path before the agent queries it.
        const stats = await runMemoryIndex();
        console.log('[feature] index built:', stats);
    }, 90_000);

    afterAll(() => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
    });

    it('the LLM calls memory-search and grounds its answer in the retrieved note', async () => {
        const model = createProvider({ flavor: 'solomon' }).languageModel(CHAT_MODEL);
        const result = await generateText({
            model,
            tools: { 'memory-search': BuiltinTools['memory-search'] },
            stopWhen: stepCountIs(5),
            prompt:
                'You have a memory-search tool over the user\'s notes. ' +
                'What is the current status of Acme Corp\'s payments? ' +
                'Use memory-search to find out, then answer in one sentence and cite the note path.',
        });

        const toolCalls = result.steps.flatMap((s) => s.toolCalls ?? []);
        const memCall = toolCalls.find((c) => c.toolName === 'memory-search');
        console.log('[feature] tool calls:', JSON.stringify(toolCalls.map((c) => ({ name: c.toolName, input: c.input }))));
        console.log('[feature] answer:', result.text);

        expect(memCall, 'the LLM should have invoked memory-search').toBeDefined();
        // Answer is grounded in the retrieved Acme note (overdue / late / AR).
        expect(result.text).toMatch(/Acme/i);
        expect(result.text.toLowerCase()).toMatch(/overdue|late|accounts.receivable|past due|thirty days|30 days/);
    }, 120_000);
});
