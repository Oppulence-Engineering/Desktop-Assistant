// Optional LLM query expansion / HyDE for memory search (RFC 021). Asks a fast
// model for a few related search terms plus a short hypothetical answer; the caller
// embeds the hypothetical (HyDE) to lift vector recall on paraphrased/conceptual
// queries. Off by default — wired in only when MemoryConfig.queryExpansion is on.
import { generateObject } from 'ai';
import { z } from 'zod';
import { withUseCase } from '../analytics/use_case.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { getKgModel } from '../models/defaults.js';
import { createProvider } from '../models/models.js';
import { FSModelConfigRepo } from '../models/repo.js';

/** The result of expanding a query: related terms + a hypothetical answer (HyDE). */
export const QueryExpansion = z.object({
    /** 3–6 short alternative phrasings / closely-related keywords. */
    expansions: z.array(z.string()),
    /** A one-sentence hypothetical note excerpt that would answer the query (for embedding). */
    hypothetical: z.string(),
});
export type QueryExpansion = z.infer<typeof QueryExpansion>;

const SYSTEM =
    'You expand a user search query for retrieval over personal notes. Return 3-6 short ' +
    'alternative phrasings or closely-related keywords (synonyms, entity names, domain terms), and ' +
    'a one-sentence hypothetical note excerpt that would perfectly answer the query (used for ' +
    'embedding). Stay faithful to the query; do not invent specific facts.';

/**
 * expandQuery asks a fast model for related terms + a hypothetical answer for HyDE,
 * reusing the active chat provider/model and recording token usage.
 *
 * @param query - The user's original query.
 * @returns Related terms + a hypothetical answer excerpt.
 * @throws If the LLM call fails — callers should treat expansion as best-effort and
 *         fall back to the raw query.
 */
export async function expandQuery(query: string): Promise<QueryExpansion> {
    const chat = await new FSModelConfigRepo().getConfig();
    const modelId = await getKgModel();
    const model = createProvider(chat.provider).languageModel(modelId);
    const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'memory_query_expand' }, () =>
        generateObject({ model, schema: QueryExpansion, system: SYSTEM, prompt: `Query: ${query}` }),
    );
    captureLlmUsage({
        useCase: 'knowledge_sync',
        subUseCase: 'memory_query_expand',
        model: modelId,
        provider: chat.provider.flavor,
        usage: result.usage,
    });
    return result.object;
}
