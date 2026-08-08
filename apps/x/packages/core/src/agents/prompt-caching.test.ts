import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { withPromptCaching } from "./prompt-caching.js";

/**
 * The agent loop takes one model step per call and re-invokes with the whole
 * accumulated conversation, so the opening user message is re-sent — and
 * re-billed at the full input rate — on every step. The email labeler sends a
 * batch of 15 emails (~30k tokens) and then edits one file per step, so that
 * prefix was being paid for roughly sixteen times per batch.
 *
 * A cache breakpoint on that message makes the vendor bill the repeats at a
 * tenth. These tests pin where the breakpoint goes and, just as importantly,
 * where it does not: a breakpoint below the vendor's minimum cacheable length
 * is ignored, and one on every message wastes the limited number available.
 */

function userMessage(chars: number): ModelMessage {
  return { role: "user", content: "x".repeat(chars) };
}

describe("withPromptCaching", () => {
  it("marks a large user message for both provider namespaces", () => {
    const out = withPromptCaching([userMessage(40_000)]);
    const opts = out[0].providerOptions as Record<string, { cacheControl?: unknown }>;

    // Managed mode goes through OpenRouter; BYOK talks to Anthropic directly.
    // The runtime does not know which, and providers ignore foreign namespaces.
    expect(opts.openrouter.cacheControl).toEqual({ type: "ephemeral" });
    expect(opts.anthropic.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("leaves short conversations alone", () => {
    // Below the vendor minimum a breakpoint is silently ignored, so adding one
    // is noise that suggests caching is happening when it is not.
    const messages = [userMessage(200)];
    expect(withPromptCaching(messages)[0].providerOptions).toBeUndefined();
  });

  it("marks only the first large user message", () => {
    const out = withPromptCaching([userMessage(40_000), userMessage(40_000)]);
    expect(out[0].providerOptions).toBeDefined();
    // Breakpoints are a limited resource (four at Anthropic) and the prefix is
    // what repeats; spending one per message would exhaust them on a long run.
    expect(out[1].providerOptions).toBeUndefined();
  });

  it("does not mark assistant or tool messages", () => {
    const out = withPromptCaching([
      { role: "assistant", content: "y".repeat(40_000) } as ModelMessage,
      userMessage(40_000),
    ]);
    expect(out[0].providerOptions).toBeUndefined();
    expect(out[1].providerOptions).toBeDefined();
  });

  it("preserves existing providerOptions", () => {
    const messages: ModelMessage[] = [
      { ...userMessage(40_000), providerOptions: { openrouter: { somethingElse: true } } },
    ];
    const opts = withPromptCaching(messages)[0].providerOptions as Record<
      string,
      Record<string, unknown>
    >;
    expect(opts.openrouter.somethingElse).toBe(true);
    expect(opts.openrouter.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("does not mutate the input", () => {
    // convertFromMessages' output is reused by the caller across steps; a
    // mutating helper would accumulate breakpoints on the same array.
    const messages = [userMessage(40_000)];
    withPromptCaching(messages);
    expect(messages[0].providerOptions).toBeUndefined();
  });
});
