// Embeddings provider for the memory index (RFC 021). Chooses the metered
// /v1/llm/embeddings proxy (managed users) vs a BYOK direct call, the same way
// gateway.ts routes chat — no new model-key surface. Returns vectors + the
// token count so the indexer can enforce the monthly cost guard.
import { embedMany } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAccessToken } from "../auth/tokens.js";
import { isSignedIn } from "../account/account.js";
import { API_URL } from "../config/env.js";
import { throughBackgroundBudget } from "../models/gateway-budget.js";
import { createProvider, Provider } from "../models/models.js";
import { FSModelConfigRepo } from "../models/repo.js";
import { PRODUCT_PROVIDER_ID } from "@x/shared/dist/branding.js";

/** The result of an embed call: one vector per input text plus the billed token count. */
export const EmbedResult = z.object({
  /** One embedding vector per input text, in input order. */
  vectors: z.array(z.array(z.number())),
  /** Tokens consumed (provider-reported, else estimated) — feeds the monthly cost guard. */
  tokens: z.number(),
});
export type EmbedResult = z.infer<typeof EmbedResult>;

/** Where/how to embed: the metered gateway proxy vs a BYOK provider, plus the model. */
export const EmbedTarget = z.object({
  /** `true` → route through the metered gateway proxy; `false` → BYOK direct. */
  metered: z.boolean(),
  /** The resolved chat provider config (reused for BYOK credentials). */
  providerConfig: Provider,
  /** The embedding model id. */
  model: z.string(),
  /** Requested embedding dimensionality (Matryoshka); omitted = the provider's native size. */
  dimensions: z.number().int().positive().optional(),
});
export type EmbedTarget = z.infer<typeof EmbedTarget>;

/**
 * resolveEmbedTarget decides metered vs BYOK from the active chat provider
 * (flavor `solomon`/`rowboat` ⇒ metered), reusing the chat credentials for BYOK.
 * Falls back to BYOK OpenAI defaults when no chat config exists yet.
 *
 * @param model - The embedding model id to embed with.
 * @param dimensions - Optional Matryoshka dimensionality to request (text-embedding-3+).
 * @returns The routing decision + provider config + model (+ dimensions).
 */
export async function resolveEmbedTarget(model: string, dimensions?: number): Promise<EmbedTarget> {
  if (await isSignedIn()) {
    return {
      metered: true,
      providerConfig: { flavor: PRODUCT_PROVIDER_ID },
      model,
      dimensions: dimensions && dimensions > 0 ? dimensions : undefined,
    };
  }
  let providerConfig: z.infer<typeof Provider> = { flavor: "openai" };
  try {
    const chat = await new FSModelConfigRepo().getConfig();
    providerConfig = chat.provider;
  } catch {
    // No chat config yet → assume BYOK OpenAI defaults.
  }
  const metered = providerConfig.flavor === "solomon" || providerConfig.flavor === "rowboat";
  return {
    metered,
    providerConfig,
    model,
    dimensions: dimensions && dimensions > 0 ? dimensions : undefined,
  };
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

/**
 * embedBatch embeds a batch of texts via the resolved target, retrying transient
 * failures (429 / 5xx / network) with exponential backoff and validating that the
 * provider returned exactly one vector per input.
 *
 * @param target - Routing + provider config from {@link resolveEmbedTarget}.
 * @param texts - The texts to embed (empty input short-circuits to an empty result).
 * @returns One vector per input text (input order) plus the token count.
 * @throws If, after retries, the provider errors or returns a vector count that
 *         does not match the number of inputs.
 */
export async function embedBatch(target: EmbedTarget, texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [], tokens: 0 };
  // One idempotency key per logical batch, STABLE across retries — so a retry
  // after a timeout where the server actually succeeded does not double-charge
  // the metered endpoint.
  const idempotencyKey = randomUUID();
  const result = await withRetry(() =>
    target.metered
      ? meteredEmbed(target.model, texts, idempotencyKey, target.dimensions)
      : byokEmbed(target, texts),
  );
  if (result.vectors.length !== texts.length) {
    throw new Error(
      `embeddings returned ${result.vectors.length} vectors for ${texts.length} inputs`,
    );
  }
  return result;
}

async function byokEmbed(target: EmbedTarget, texts: string[]): Promise<EmbedResult> {
  const provider = createProvider(target.providerConfig);
  const { embeddings, usage } = await embedMany({
    model: provider.textEmbeddingModel(target.model),
    values: texts,
    // Matryoshka dimension reduction (text-embedding-3+ honors `dimensions`).
    ...(target.dimensions
      ? { providerOptions: { openai: { dimensions: target.dimensions } } }
      : {}),
  });
  return { vectors: embeddings, tokens: usage?.tokens ?? estimateTokens(texts) };
}

/**
 * Shape of the metered `/v1/llm/embeddings` proxy response (OpenAI-compatible).
 * `.passthrough()` tolerates extra fields the proxy may add over time, while the
 * required `data[].embedding` arrays are validated so a malformed body is rejected
 * rather than silently producing `undefined` vectors.
 */
const EmbeddingsResponse = z
  .object({
    data: z.array(z.object({ embedding: z.array(z.number()) }).passthrough()),
    usage: z
      .object({ prompt_tokens: z.number().optional(), total_tokens: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

async function meteredEmbed(
  model: string,
  texts: string[],
  idempotencyKey: string,
  dimensions?: number,
): Promise<EmbedResult> {
  const token = await getAccessToken();
  // The timeout has to start when the request does, not when it is queued.
  //
  // /v1/llm/embeddings shares the rate-limit bucket with chat, so memory
  // indexing draws on the same background budget — otherwise a rebuild
  // silently spends the allowance the labeling agent is waiting for. But that
  // queue can hold a request for far longer than REQUEST_TIMEOUT_MS during a
  // backlog. Arming the AbortController before queueing made the wait count
  // against the request: the call aborted before it was ever sent, withRetry
  // burned attempts on it, and each abort counted as a transport failure
  // toward the circuit breaker — so a big enough backlog would pause itself.
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await throughBackgroundBudget(() => {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      return fetch(`${API_URL}/v1/llm/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          // The metered proxy requires an idempotency key (428 without it);
          // stable across retries of this batch (see embedBatch). Deliberately
          // unlike the gateway's per-request key: a retry here must not be
          // billed twice.
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          model: normalizeMeteredModel(model),
          input: texts,
          ...(dimensions ? { dimensions } : {}),
        }),
        signal: controller.signal,
      });
    });
    if (!res.ok) {
      const err = new Error(
        `embeddings proxy ${res.status}: ${await res.text().catch(() => "")}`,
      ) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    const parsed = EmbeddingsResponse.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error("embeddings proxy returned an unexpected response shape");
    }
    const vectors = parsed.data.data.map((d) => d.embedding);
    const tokens =
      parsed.data.usage?.total_tokens ?? parsed.data.usage?.prompt_tokens ?? estimateTokens(texts);
    return { vectors, tokens };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMeteredModel(model: string): string {
  if (model.includes("/")) return model;
  if (model.startsWith("text-embedding-")) return `openai/${model}`;
  return model;
}

/** withRetry retries transient embedding failures (429, 5xx, aborts/network)
 *  with exponential backoff; client errors (4xx other than 429) fail fast. */
async function withRetry(fn: () => Promise<EmbedResult>): Promise<EmbedResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) throw err;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  // Network errors / aborts / timeouts have no HTTP status → treat as transient.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(texts: string[]): number {
  let chars = 0;
  for (const t of texts) chars += t.length;
  return Math.ceil(chars / 4);
}
