import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetBackgroundBudgetForTests, throughBackgroundBudget } from "./gateway-budget.js";

/**
 * The bearer must be minted when a request is sent, not when it is queued.
 *
 * Background LLM work goes through a rate-limit queue that, during a backlog,
 * holds a request far longer than an access token lives — these tokens last
 * minutes and isTokenExpired only looks 60 seconds ahead, so one can be handed
 * out with a minute left. Capturing it before the wait meant the queue drained
 * with an expired bearer and the gateway answered 401 to all of it at once: 35
 * "Unauthorized (AI_APICallError)" failures across labeling and graph sync in a
 * single hour, plus the embeddings path's own 401s.
 *
 * The embeddings path already documents this hazard for its abort timer. The
 * bearer had the same problem and never got the same fix.
 */

const auth = vi.hoisted(() => ({ token: "token-1" }));
vi.mock("../auth/tokens.js", () => ({ getAccessToken: async () => auth.token }));

const useCase = vi.hoisted(() => ({
  value: { useCase: "knowledge_sync", subUseCase: "label_emails" } as
    | { useCase: string; subUseCase?: string }
    | undefined,
}));
vi.mock("../analytics/use_case.js", () => ({ getCurrentUseCase: () => useCase.value }));

import { authedFetch } from "./gateway.js";

/** Captures what each outbound request actually carried. */
function captureFetch(): { auth: string[]; keys: string[] } {
  const seen = { auth: [] as string[], keys: [] as string[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const a = headers.get("Authorization");
      const k = headers.get("Idempotency-Key");
      if (a) seen.auth.push(a);
      if (k) seen.keys.push(k);
      return { status: 200 } as unknown as Response;
    }),
  );
  return seen;
}

beforeEach(() => {
  resetBackgroundBudgetForTests();
  auth.token = "token-1";
  useCase.value = { useCase: "knowledge_sync", subUseCase: "label_emails" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetBackgroundBudgetForTests();
});

describe("authedFetch — bearer lifetime", () => {
  it("uses the token current at send time, not at queue time", async () => {
    vi.useFakeTimers();
    const seen = captureFetch();

    // Fill this window's allowance so the next request has to wait its turn.
    Array.from({ length: 7 }, () =>
      throughBackgroundBudget(async () => ({ status: 200 })).catch(() => {}),
    );

    const pending = authedFetch("https://api.test/v1/llm/chat/completions", { method: "POST" });

    await vi.advanceTimersByTimeAsync(0);
    expect(seen.auth, "request jumped the queue instead of waiting").toEqual([]);

    // The refresh that happens while a real request sits in a backlog.
    auth.token = "token-2";

    await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(seen.auth).toEqual(["Bearer token-2"]);
  });

  it("sends interactive work immediately, without the queue", async () => {
    useCase.value = { useCase: "copilot_chat" };
    const seen = captureFetch();

    // Allowance already spent — an interactive request must not be held by it.
    Array.from({ length: 7 }, () =>
      throughBackgroundBudget(async () => ({ status: 200 })).catch(() => {}),
    );

    await authedFetch("https://api.test/v1/llm/chat/completions", { method: "POST" });
    expect(seen.auth).toEqual(["Bearer token-1"]);
  });

  it("gives each request its own idempotency key", async () => {
    const seen = captureFetch();
    await authedFetch("https://api.test/v1/llm/chat/completions", { method: "POST" });
    await authedFetch("https://api.test/v1/llm/chat/completions", { method: "POST" });
    expect(seen.keys).toHaveLength(2);
    expect(new Set(seen.keys).size, "two requests shared an idempotency key").toBe(2);
  });

  it("passes the caller's idempotency key through when one is set", async () => {
    const seen = captureFetch();
    await authedFetch("https://api.test/v1/llm/chat/completions", {
      method: "POST",
      headers: { "Idempotency-Key": "caller-owned" },
    });
    expect(seen.keys).toEqual(["caller-owned"]);
  });
});
