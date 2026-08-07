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
import { loadMemoryConfig, MemoryConfig } from "./config.js";
import {
  LOCAL_EMBED_MODEL_ID,
  isLocalEmbedModel,
  localEmbedModelReady,
  ollamaHost,
  ollamaModelName,
} from "./ollama.js";
import { MINILM, assetsInstalled, installAssets } from "./onnx/assets.js";
import { embedLocally, ensureEmbedder } from "./onnx/embedder.js";

/** True when `model` is served in-process by ONNX Runtime rather than over HTTP. */
export function isOnDeviceModel(model: string): boolean {
  return model.startsWith("local/");
}

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
  // In-process: no provider, no HTTP. `ollama` is a placeholder flavor that
  // createProvider never sees, because embedBatch dispatches on the id first.
  if (isOnDeviceModel(model)) {
    return { metered: false, providerConfig: { flavor: "ollama" }, model, dimensions: undefined };
  }
  // Routing keys on the model id, not on what happens to be reachable. It has
  // to: memorySearch embeds a query with the model recorded in the manifest,
  // and vectors from two models are not comparable. If the id says Ollama, the
  // request goes to Ollama or it fails — falling back to a hosted model here
  // would silently return nonsense rankings rather than an error the retriever
  // can catch and answer lexically.
  if (isLocalEmbedModel(model)) {
    return {
      metered: false,
      providerConfig: { flavor: "ollama", baseURL: ollamaHost() },
      model: ollamaModelName(model),
      // Matryoshka truncation is an OpenAI feature; Ollama returns native size.
      dimensions: undefined,
    };
  }
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

/**
 * resolveEmbedModel picks which embedding model this index pass should use:
 * the on-device one whenever a local daemon can serve it, otherwise whatever is
 * configured. This is the "automatically" part — no setting to find, no key to
 * paste. A change either way flips the manifest's model identity and the
 * indexer rebuilds, which is correct: vectors from two models cannot be mixed.
 *
 * An explicitly configured model is left alone. Someone who set
 * `model` in index.json to something other than the default meant it, and
 * silently overriding a deliberate choice is worse than missing an optimisation.
 *
 * @param configured - The model from memory config.
 * @returns The model identity to index with.
 */
export async function resolveEmbedModel(configured: string): Promise<string> {
  if (isOnDeviceModel(configured) || isLocalEmbedModel(configured)) return configured;
  if (configured !== MemoryConfig.shape.model.parse(undefined)) return configured;
  if (loadMemoryConfig().localEmbeddings === "off") return configured;

  // In-process ONNX is preferred over Ollama: no daemon, no port, ~35MB of
  // runtime instead of 145MB (and it is the only local backend that works the
  // same on Windows and Linux, where Ollama ships 1.4GB of GPU runners).
  if (await assetsInstalled(MINILM)) {
    if (await ensureEmbedder(MINILM)) return MINILM.id;
  } else {
    // Fire-and-forget: a 23MB download must not hold up an index pass.
    void installAssets(MINILM);
  }

  return (await localEmbedModelReady()) ? LOCAL_EMBED_MODEL_ID : configured;
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
  // On-device first: it cannot 429, 402 or time out, so the retry/idempotency
  // machinery below has nothing to protect against.
  //
  // Loads on demand rather than assuming resolveEmbedModel ran. memorySearch
  // reaches here via resolveEmbedTarget(manifest.model) without going through
  // model selection at all, so after a restart the session is cold — and an
  // unloaded embedder would have made every search fall back to lexical for the
  // rest of the process's life.
  if (isOnDeviceModel(target.model)) {
    if (!(await ensureEmbedder())) {
      throw new Error("on-device embedder unavailable");
    }
    return embedLocally(texts);
  }
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
    // Scoped to the OpenAI flavor: on any other provider this is a namespaced
    // option nobody reads, and the returned vectors would be full-size while
    // the manifest recorded the requested dims.
    ...(target.dimensions && target.providerConfig.flavor === "openai"
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
