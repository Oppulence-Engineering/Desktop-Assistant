import z from "zod";
import { LlmProvider } from "@x/shared/dist/models.js";
import { IModelConfigRepo } from "./repo.js";
import { isSignedIn } from "../account/account.js";
import container from "../di/container.js";
import {
  PRODUCT_PROVIDER_ID,
  LEGACY_PRODUCT_PROVIDER_ID,
  isProductProvider,
} from "@x/shared/dist/branding.js";

// Signed-in defaults must be ids the gateway actually serves *and can reach*,
// which means three things have to agree: this constant, the rate table in
// rowboat-api internal/pricing/pricing.go, and LLM_ALLOWED_MODELS in
// charts/rowboat-api/values-production.yaml. Miss the allowlist and every
// signed-in call returns model_not_allowed; miss the rate table and rate()
// falls back to DefaultModel — 30/150 per 1K, the sonnet rate — so the customer
// is billed roughly 10x what the model costs.
//
// These were openai/gpt-4.1-mini, then anthropic/claude-haiku-4-5 when the
// direct-to-OpenAI leg started returning 502 for every request. Everything now
// routes through OpenRouter, so that constraint is gone.
//
// gemini-3.1-flash-lite is $0.25/$1.50 per 1M against haiku's $1/$5: 4x cheaper
// input, 3.3x cheaper output, on the highest-volume work we run (email
// labelling, note tagging, live notes) — which is where the spend actually is,
// since those run per-thread and per-note without anyone asking for them.
//
// It also emits no reasoning tokens, which is worth more than it sounds. A
// measured "reply with PONG" on gemini-3.5-flash cost $0.000669 for an 8-token
// prompt because 71 of its 73 output tokens were reasoning, billed at the
// output rate; the identical call on flash-lite cost $0.000019. Prefer a
// non-reasoning model for anything that runs on a loop.
//
// Change all four together, and update the two server-side files above in the
// same commit.
const SIGNED_IN_DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_DEFAULT_PROVIDER = PRODUCT_PROVIDER_ID;
const SIGNED_IN_KG_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_LIVE_NOTE_AGENT_MODEL = "google/gemini-3.1-flash-lite";
const SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL = "google/gemini-3.1-flash-lite";

// ... (ERRORS.md E52) Only honor a signed-in user's saved model when it's a real
// gateway-served id. Gateway ids are namespaced ("openai/…", "anthropic/…",
// "google/gemini-2.5*"); the bootstrap/BYOK default ("gpt-4.1-mini") is bare and
// NOT served under that name by the gateway, so for those (and any unset value)
// we fall back to the curated default instead of sending an id the gateway would
// reject with `model_not_allowed`.
function honorGatewayModel(saved: string | undefined, fallback: string): string {
  return saved && saved.includes("/") ? saved : fallback;
}

/**
 * The single source of truth for "what model+provider should we use when
 * the caller didn't specify and the agent didn't declare". Returns names only.
 * This is the only place that branches on signed-in state.
 */
export async function getDefaultModelAndProvider(): Promise<{ model: string; provider: string }> {
  const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
  const cfg = await repo.getConfig();
  if (await isSignedIn()) {
    // ... (ERRORS.md E52) Honor the model SolomonModelSettings saved to
    // config/models.json; routing stays on the product gateway regardless.
    return {
      model: honorGatewayModel(cfg.model, SIGNED_IN_DEFAULT_MODEL),
      provider: SIGNED_IN_DEFAULT_PROVIDER,
    };
  }
  return { model: cfg.model, provider: cfg.provider.flavor };
}

/**
 * Resolve a provider name (as stored on a run, an agent, or returned by
 * getDefaultModelAndProvider) into the full LlmProvider config that
 * createProvider expects (apiKey/baseURL/headers).
 *
 * - "solomon" → gateway provider (auth via OAuth bearer; no creds field).
 * - other names → look up models.json's `providers[name]` map.
 * - fallback: if the name matches the active default's flavor (legacy
 *   single-provider configs that didn't write to the providers map yet).
 */
export async function resolveProviderConfig(name: string): Promise<z.infer<typeof LlmProvider>> {
  if (isProductProvider(name)) {
    return {
      flavor:
        name === LEGACY_PRODUCT_PROVIDER_ID ? LEGACY_PRODUCT_PROVIDER_ID : PRODUCT_PROVIDER_ID,
    };
  }
  const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
  const cfg = await repo.getConfig();
  const entry = cfg.providers?.[name];
  if (entry) {
    return LlmProvider.parse({
      flavor: name,
      apiKey: entry.apiKey,
      baseURL: entry.baseURL,
      headers: entry.headers,
    });
  }
  if (cfg.provider.flavor === name) {
    return cfg.provider;
  }
  throw new Error(`Provider '${name}' is referenced but not configured`);
}

/**
 * Model used by knowledge-graph agents (note_creation, labeling_agent, etc.)
 * when they're the top-level of a run. Signed-in: curated default.
 * BYOK: user override (`knowledgeGraphModel`) or assistant model.
 */
export async function getKgModel(): Promise<string> {
  const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
  if (await isSignedIn()) {
    // ... (ERRORS.md E52) Honor the saved KG selection; "Same as assistant"
    // (knowledgeGraphModel unset) → the resolved assistant model.
    return honorGatewayModel(
      cfg.knowledgeGraphModel,
      honorGatewayModel(cfg.model, SIGNED_IN_KG_MODEL),
    );
  }
  return cfg.knowledgeGraphModel ?? cfg.model;
}

/**
 * Model used by the live-note agent + routing classifier.
 * Signed-in: curated default. BYOK: user override (`liveNoteAgentModel`) or
 * assistant model.
 */
export async function getLiveNoteAgentModel(): Promise<string> {
  if (await isSignedIn()) return SIGNED_IN_LIVE_NOTE_AGENT_MODEL;
  const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
  return cfg.liveNoteAgentModel ?? cfg.model;
}

/**
 * Model used by the auto-permission classifier.
 * Signed-in: curated default. BYOK: user override
 * (`autoPermissionDecisionModel`) or assistant model.
 */
export async function getAutoPermissionDecisionModel(): Promise<string> {
  if (await isSignedIn()) return SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL;
  const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
  return cfg.autoPermissionDecisionModel ?? cfg.model;
}

/**
 * Model used by the meeting-notes summarizer. No special signed-in default —
 * historically meetings used the assistant model. BYOK: user override
 * (`meetingNotesModel`) or assistant model.
 */
export async function getMeetingNotesModel(): Promise<string> {
  if (await isSignedIn()) return SIGNED_IN_DEFAULT_MODEL;
  const cfg = await container.resolve<IModelConfigRepo>("modelConfigRepo").getConfig();
  return cfg.meetingNotesModel ?? cfg.model;
}

/**
 * Model used by the background-task agent + routing classifier. Currently
 * mirrors `getLiveNoteAgentModel()` — both surfaces want a fast, reliable
 * agent model. Split into its own getter so a future per-feature override
 * doesn't require touching all call sites.
 */
export async function getBackgroundTaskAgentModel(): Promise<string> {
  return getLiveNoteAgentModel();
}
