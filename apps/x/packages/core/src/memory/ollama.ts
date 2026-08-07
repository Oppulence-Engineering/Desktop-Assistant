// On-device embeddings for the memory index, via a local Ollama daemon.
//
// Embeddings are the one part of this app that has no business leaving the
// machine. They are a small model with no reasoning, they run fine on CPU, and
// the input is the user's own notes and mail — every chunk of it, on every
// index pass. Running them locally also removes the whole failure class that
// took the memory index down on 2026-08-07: the gateway allowlist, the pricing
// table, the credit balance and the vendor's 402 all stop mattering.
//
// So local is the default and it is silent by design: there is no setting to
// find, no key to paste, and nothing to install. The daemon itself comes from
// ./ollama-runtime.ts — the user's own if they run one, otherwise a private
// managed copy. Every step degrades to the hosted provider rather than failing,
// so a machine that cannot run this never notices it exists.
import { loadMemoryConfig } from "./config.js";
import { ensureOllamaRuntime } from "./ollama-runtime.js";

const DEFAULT_HOST = "http://127.0.0.1:11434";

/**
 * The local embedding model. `nomic-embed-text` is ~274MB, 768-dimensional and
 * competitive with text-embedding-3-small on retrieval, which matters because
 * switching costs a full index rebuild — a weaker model would be a downgrade
 * the user never asked for.
 */
export const LOCAL_EMBED_MODEL = "nomic-embed-text";
export const LOCAL_EMBED_DIMS = 768;

/**
 * Model identity as recorded in the index manifest.
 *
 * Namespaced deliberately. The manifest's model string is what forces a rebuild
 * when the embedding model changes, and it is what {@link resolveEmbedTarget}
 * routes on when embedding a *query* against already-stored vectors. A bare
 * "nomic-embed-text" would collide with the OpenAI ids in the same field and
 * leave no way to tell which provider produced the vectors on disk.
 */
export const LOCAL_EMBED_MODEL_ID = `ollama/${LOCAL_EMBED_MODEL}`;

/** True when `model` names an Ollama-served model rather than a hosted one. */
export function isLocalEmbedModel(model: string): boolean {
  return model.startsWith("ollama/");
}

/** The bare model name Ollama expects, from a namespaced identity. */
export function ollamaModelName(model: string): string {
  return model.startsWith("ollama/") ? model.slice("ollama/".length) : model;
}

/**
 * Base URL of the daemon serving local embeddings.
 *
 * Reflects the runtime {@link ensureOllamaRuntime} last resolved, so a managed
 * daemon on its own port is addressed correctly. Falls back to the conventional
 * default, which is also what a bare probe should try first. `OLLAMA_HOST` is
 * Ollama's own convention and is commonly set without a scheme, so tolerate both.
 */
export function ollamaHost(): string {
  if (resolvedHost) return resolvedHost;
  const raw = (process.env.OLLAMA_HOST || DEFAULT_HOST).trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Last runtime resolved by {@link localEmbedModelReady}; see {@link ollamaHost}. */
let resolvedHost: string | null = null;

// A probe on every embed call would add a round trip to the hot path, and a
// failing probe is the common case (most machines have no Ollama). Cache both
// answers, and cache the negative for longer — a daemon that isn't there won't
// appear mid-pass, but one that is there can finish pulling a model.
const READY_TTL_MS = 60_000;
const ABSENT_TTL_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 1_500;
const PULL_TIMEOUT_MS = 20 * 60_000;

let cachedReady: { value: boolean; until: number } | null = null;
let pullInFlight: Promise<void> | null = null;

/** Drops the availability cache. For tests and for settings changes. */
export function resetOllamaProbe(): void {
  cachedReady = null;
  pullInFlight = null;
  resolvedHost = null;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`ollama ${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Installed model names, normalised (Ollama reports "name:tag"; an untagged
 * pull lands as ":latest"). `null` means no daemon is reachable — which is the
 * expected answer on most machines, not an error worth surfacing.
 */
export async function listOllamaModels(): Promise<string[] | null> {
  try {
    const body = (await fetchJson(`${ollamaHost()}/api/tags`, {}, PROBE_TIMEOUT_MS)) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (body.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter(Boolean)
      .map((name) => name.replace(/:latest$/, ""));
  } catch {
    return null;
  }
}

/**
 * Pull the embedding model, once. Fire-and-forget: a 274MB download must not
 * block an index pass, so the caller keeps using the hosted provider and picks
 * the local one up on a later tick.
 */
function startPull(): void {
  if (pullInFlight) return;
  console.log(`[Memory] Pulling ${LOCAL_EMBED_MODEL} for on-device embeddings…`);
  pullInFlight = fetchJson(
    `${ollamaHost()}/api/pull`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: LOCAL_EMBED_MODEL, stream: false }),
    },
    PULL_TIMEOUT_MS,
  )
    .then(() => {
      console.log(`[Memory] ${LOCAL_EMBED_MODEL} ready; embeddings now run on-device.`);
      cachedReady = null; // re-probe rather than assume
    })
    .catch((error) => {
      console.log(
        `[Memory] Could not pull ${LOCAL_EMBED_MODEL}:`,
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      pullInFlight = null;
    });
}

/**
 * Whether on-device embedding is usable right now: a daemon is listening and it
 * has the model. When the daemon is up but the model is missing, this kicks off
 * the pull and returns false for this pass.
 */
export async function localEmbedModelReady(): Promise<boolean> {
  if (loadMemoryConfig().localEmbeddings === "off") return false;

  const now = Date.now();
  if (cachedReady && now < cachedReady.until) return cachedReady.value;

  // Resolve (and if needed provision) a daemon before probing for the model.
  resolvedHost = await ensureOllamaRuntime();
  if (!resolvedHost) {
    cachedReady = { value: false, until: now + ABSENT_TTL_MS };
    return false;
  }

  const models = await listOllamaModels();
  if (models === null) {
    resolvedHost = null;
    cachedReady = { value: false, until: now + ABSENT_TTL_MS };
    return false;
  }
  const ready = models.includes(LOCAL_EMBED_MODEL);
  if (!ready) startPull();
  cachedReady = { value: ready, until: now + (ready ? READY_TTL_MS : ABSENT_TTL_MS) };
  return ready;
}
