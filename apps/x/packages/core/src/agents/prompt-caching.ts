import type { ModelMessage } from "ai";

// Anthropic will not cache a prefix shorter than ~2048 tokens on the small
// models, and a breakpoint below that is silently ignored. Roughly four
// characters per token, so ~8k characters is where asking becomes useful.
const MIN_CACHEABLE_CHARS = 8_000;

/**
 * Mark the first large user message as a prompt-cache breakpoint.
 *
 * The agent loop runs one model step per call (`stepCountIs(1)`) and re-invokes
 * with the accumulated conversation, so the opening user message is re-sent —
 * and re-billed in full — on every step. For the email labeler that message is
 * a batch of 15 emails at ~8k characters each, resent once per file it edits:
 * the same ~30k-token prefix paid for roughly sixteen times per batch.
 *
 * A breakpoint tells the vendor to cache everything up to that point. Cache
 * reads bill at a tenth of fresh input, and the gateway reads
 * `usage.prompt_tokens_details.cached_tokens`, so the saving reaches the
 * customer's credits rather than stopping at our vendor bill.
 *
 * Both provider namespaces are set because the same runtime serves managed mode
 * (OpenRouter through our gateway) and BYOK Anthropic. A provider ignores
 * namespaces it does not own, so setting both avoids branching on how the model
 * was constructed.
 *
 * Lives outside runtime.ts because that module builds the DI container on
 * import; this is a pure function and its tests should not need a container.
 */
export function withPromptCaching(messages: ModelMessage[]): ModelMessage[] {
  const idx = messages.findIndex(
    (m) => m.role === "user" && JSON.stringify(m.content).length >= MIN_CACHEABLE_CHARS,
  );
  if (idx === -1) return messages;

  const cacheControl = { type: "ephemeral" as const };
  const target = messages[idx];
  const existing = (target.providerOptions ?? {}) as Record<string, Record<string, unknown>>;
  const copy = messages.slice();
  copy[idx] = {
    ...target,
    providerOptions: {
      ...existing,
      openrouter: { ...(existing.openrouter ?? {}), cacheControl },
      anthropic: { ...(existing.anthropic ?? {}), cacheControl },
    },
  } as ModelMessage;
  return copy;
}
