import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetBackgroundBudgetForTests, throughBackgroundBudget } from "../models/gateway-budget.js";

// embedBatch (metered path) needs an access token; stub it so no real auth runs.
vi.mock("../auth/tokens.js", () => ({ getAccessToken: async () => "test-token" }));

// resolveEmbedTarget reads the active chat provider config; stub the repo so we
// can drive the metered-vs-BYOK decision deterministically.
const { getConfig, isSignedInMock } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  isSignedInMock: vi.fn(),
}));
vi.mock("../models/repo.js", async (io) => ({
  ...(await io<typeof import("../models/repo.js")>()),
  FSModelConfigRepo: class {
    getConfig = getConfig;
  },
}));
vi.mock("../account/account.js", () => ({ isSignedIn: isSignedInMock }));

// Daemon availability is exercised in ollama.test.ts; here it is an input, so
// these tests never depend on whether the machine running them has Ollama.
const ready = vi.hoisted(() => ({ value: false }));
vi.mock("./ollama.js", async (io) => ({
  ...(await io<typeof import("./ollama.js")>()),
  localEmbedModelReady: async () => ready.value,
}));

// BYOK path: stub the ai-sdk embedder and the provider factory (keep every other
// real export via importOriginal so module loading isn't disturbed).
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    embedMany: vi.fn(async () => ({ embeddings: [[1, 2, 3]], usage: { tokens: 9 } })),
  };
});
vi.mock("../models/models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../models/models.js")>();
  return { ...actual, createProvider: () => ({ textEmbeddingModel: (m: string) => m }) };
});

import { embedBatch, resolveEmbedModel, resolveEmbedTarget, type EmbedTarget } from "./embed.js";
import { LOCAL_EMBED_MODEL, LOCAL_EMBED_MODEL_ID } from "./ollama.js";

const metered: EmbedTarget = { metered: true, providerConfig: { flavor: "solomon" }, model: "m" };
const byok: EmbedTarget = {
  metered: false,
  providerConfig: { flavor: "openai" },
  model: "text-embedding-3-small",
};

interface FakeRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}
function res(body: unknown, init: { ok?: boolean; status?: number } = {}): FakeRes {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => "",
  };
}
function stubFetch(impl: () => FakeRes): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  getConfig.mockReset();
  isSignedInMock.mockReset();
  isSignedInMock.mockResolvedValue(false);
  // meteredEmbed draws on the shared gateway budget (6 requests per 10s), which
  // is process-wide. Without a reset the seventh request in this file waits for
  // the next window and the test times out — a property of the pacing, not of
  // the code under test here.
  resetBackgroundBudgetForTests();
  ready.value = false;
});

describe("embedBatch — empty input", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("short-circuits empty input without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await embedBatch(metered, [])).toEqual({ vectors: [], tokens: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("embedBatch — metered proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns vectors + tokens on a well-formed response", async () => {
    stubFetch(() => res({ data: [{ embedding: [1, 2, 3] }], usage: { total_tokens: 7 } }));
    expect(await embedBatch(metered, ["hello"])).toEqual({ vectors: [[1, 2, 3]], tokens: 7 });
  });

  it("includes a requested Matryoshka dimensions in the request body (and omits it otherwise)", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body: string }) => {
        body = JSON.parse(init.body) as Record<string, unknown>;
        return res({ data: [{ embedding: [1, 2] }], usage: { total_tokens: 1 } });
      }),
    );
    await embedBatch(
      { metered: true, providerConfig: { flavor: "solomon" }, model: "m", dimensions: 256 },
      ["x"],
    );
    expect(body.dimensions).toBe(256);

    await embedBatch(metered, ["x"]); // no dimensions on the target
    expect("dimensions" in body).toBe(false);
  });

  it("prefixes OpenAI embedding models for the metered gateway", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body: string }) => {
        body = JSON.parse(init.body) as Record<string, unknown>;
        return res({ data: [{ embedding: [1, 2] }], usage: { total_tokens: 1 } });
      }),
    );
    await embedBatch(
      { metered: true, providerConfig: { flavor: "solomon" }, model: "text-embedding-3-small" },
      ["x"],
    );
    expect(body.model).toBe("openai/text-embedding-3-small");
  });

  it("rejects a malformed response shape (missing data[].embedding)", async () => {
    stubFetch(() => res({ unexpected: true }));
    await expect(embedBatch(metered, ["hello"])).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when the vector count does not match the input count", async () => {
    stubFetch(() => res({ data: [{ embedding: [1] }, { embedding: [2] }] }));
    await expect(embedBatch(metered, ["only-one"])).rejects.toThrow(/2 vectors for 1 inputs/);
  });

  it("prefers total_tokens, falls back to prompt_tokens, then estimates", async () => {
    stubFetch(() =>
      res({ data: [{ embedding: [1] }], usage: { total_tokens: 11, prompt_tokens: 5 } }),
    );
    expect((await embedBatch(metered, ["x"])).tokens).toBe(11);

    stubFetch(() => res({ data: [{ embedding: [1] }], usage: { prompt_tokens: 5 } }));
    expect((await embedBatch(metered, ["x"])).tokens).toBe(5);

    stubFetch(() => res({ data: [{ embedding: [1] }] })); // no usage → estimate ceil(len/4)
    expect((await embedBatch(metered, ["hello"])).tokens).toBe(Math.ceil("hello".length / 4));
  });

  it("retries a transient 5xx then succeeds", async () => {
    let n = 0;
    const fetchFn = stubFetch(() => {
      n += 1;
      return n === 1
        ? res({}, { ok: false, status: 503 })
        : res({ data: [{ embedding: [9] }], usage: { total_tokens: 1 } });
    });
    const out = await embedBatch(metered, ["x"]);
    expect(out.vectors).toEqual([[9]]);
    expect(fetchFn).toHaveBeenCalledTimes(2); // one retry
  });

  it("fails fast on a non-retryable 4xx (no retry)", async () => {
    const fetchFn = stubFetch(() => res({}, { ok: false, status: 400 }));
    await expect(embedBatch(metered, ["x"])).rejects.toThrow(/400/);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 400 is not retried
  });

  it("reuses one idempotency key across all retries of a batch", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { headers: Record<string, string> }) => {
        keys.push(init.headers["Idempotency-Key"]);
        return res({}, { ok: false, status: 500 }); // always transient → exhausts retries
      }),
    );
    await expect(embedBatch(metered, ["x"])).rejects.toBeTruthy();
    expect(keys).toHaveLength(3); // MAX_ATTEMPTS
    expect(new Set(keys).size).toBe(1); // stable key → no double-charge on retry
  });
});

describe("embedBatch — BYOK direct", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the ai-sdk embedder and never touches the metered proxy", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await embedBatch(byok, ["hello"]);
    expect(out.vectors).toEqual([[1, 2, 3]]); // from the mocked embedMany
    expect(out.tokens).toBe(9); // from the mocked usage
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveEmbedTarget", () => {
  it("routes signed-in users through the metered proxy before reading BYOK model config", async () => {
    isSignedInMock.mockResolvedValue(true);
    getConfig.mockResolvedValue({ provider: { flavor: "openai" } });
    const target = await resolveEmbedTarget("text-embedding-3-small");
    expect(target.metered).toBe(true);
    expect(target.providerConfig.flavor).toBe("solomon");
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("routes solomon/rowboat chat providers through the metered proxy", async () => {
    getConfig.mockResolvedValue({ provider: { flavor: "solomon" } });
    expect((await resolveEmbedTarget("m")).metered).toBe(true);
    getConfig.mockResolvedValue({ provider: { flavor: "rowboat" } });
    expect((await resolveEmbedTarget("m")).metered).toBe(true);
  });

  it("routes other providers as BYOK (not metered) and reuses the chat config", async () => {
    getConfig.mockResolvedValue({ provider: { flavor: "anthropic", apiKey: "sk-x" } });
    const target = await resolveEmbedTarget("text-embedding-3-small");
    expect(target.metered).toBe(false);
    expect(target.providerConfig.flavor).toBe("anthropic");
    expect(target.model).toBe("text-embedding-3-small");
  });

  it("falls back to BYOK OpenAI defaults when no chat config exists", async () => {
    getConfig.mockRejectedValue(new Error("no config"));
    const target = await resolveEmbedTarget("m");
    expect(target.metered).toBe(false);
    expect(target.providerConfig.flavor).toBe("openai");
  });

  it("threads a positive dimensions value onto the target (Matryoshka)", async () => {
    getConfig.mockResolvedValue({ provider: { flavor: "openai" } });
    expect((await resolveEmbedTarget("m", 512)).dimensions).toBe(512);
    expect((await resolveEmbedTarget("m", 0)).dimensions).toBeUndefined();
    expect((await resolveEmbedTarget("m")).dimensions).toBeUndefined();
  });
});

describe("resolveEmbedTarget — on-device", () => {
  it("routes a local model id to the Ollama daemon", async () => {
    const target = await resolveEmbedTarget(LOCAL_EMBED_MODEL_ID);
    expect(target.metered).toBe(false);
    expect(target.providerConfig.flavor).toBe("ollama");
    expect(target.providerConfig.baseURL).toContain("11434");
    // The provider takes the bare name; the namespace is our bookkeeping.
    expect(target.model).toBe(LOCAL_EMBED_MODEL);
  });

  // Matryoshka truncation is an OpenAI feature. Passing it through would leave
  // the manifest recording a dimensionality the returned vectors do not have.
  it("drops the Matryoshka dimensions request for a local model", async () => {
    expect((await resolveEmbedTarget(LOCAL_EMBED_MODEL_ID, 512)).dimensions).toBeUndefined();
  });

  // Routing follows the model id, never "what is reachable". memorySearch embeds
  // a query with the model recorded in the manifest, and vectors from two models
  // are not comparable — quietly answering from a different model would return
  // confidently wrong rankings instead of a failure the retriever can catch and
  // fall back to lexical on.
  it("sends a hosted model id to the hosted provider even when a daemon is up", async () => {
    ready.value = true;
    isSignedInMock.mockResolvedValue(true);
    const target = await resolveEmbedTarget("text-embedding-3-small");
    expect(target.metered).toBe(true);
    expect(target.providerConfig.flavor).not.toBe("ollama");
  });

  it("does not send the OpenAI dimensions option to a non-OpenAI provider", async () => {
    const embedMany = vi.mocked((await import("ai")).embedMany);
    embedMany.mockClear();
    await embedBatch(
      {
        metered: false,
        providerConfig: { flavor: "ollama", baseURL: "http://127.0.0.1:11434" },
        model: LOCAL_EMBED_MODEL,
        dimensions: 512,
      },
      ["x"],
    );
    expect(embedMany.mock.calls[0]?.[0]).not.toHaveProperty("providerOptions");
  });
});

describe("resolveEmbedModel", () => {
  it("prefers on-device when the daemon can serve it", async () => {
    ready.value = true;
    expect(await resolveEmbedModel("text-embedding-3-small")).toBe(LOCAL_EMBED_MODEL_ID);
  });

  it("stays hosted when no daemon can serve it", async () => {
    ready.value = false;
    expect(await resolveEmbedModel("text-embedding-3-small")).toBe("text-embedding-3-small");
  });

  // Someone who set a non-default model in index.json meant it. Silently
  // overriding a deliberate choice is worse than missing the optimisation.
  it("leaves an explicitly configured model alone", async () => {
    ready.value = true;
    expect(await resolveEmbedModel("text-embedding-3-large")).toBe("text-embedding-3-large");
  });

  it("honours the off switch", async () => {
    ready.value = true;
    process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS = "off";
    try {
      expect(await resolveEmbedModel("text-embedding-3-small")).toBe("text-embedding-3-small");
    } finally {
      delete process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS;
    }
  });

  it("keeps an already-local id local", async () => {
    ready.value = false;
    expect(await resolveEmbedModel(LOCAL_EMBED_MODEL_ID)).toBe(LOCAL_EMBED_MODEL_ID);
  });
});

describe("embedBatch — queue wait vs request timeout", () => {
  afterEach(() => vi.useRealTimers());

  it("does not spend the request timeout waiting in the background queue", async () => {
    // meteredEmbed goes through the shared budget, which can hold a request far
    // longer than REQUEST_TIMEOUT_MS during a backlog. Arming the
    // AbortController before queueing made that wait count against the request:
    // the call aborted before it was ever sent, withRetry burned an attempt on
    // it, and each abort counted as a transport failure toward the circuit
    // breaker — so a large enough backlog paused itself.
    vi.useFakeTimers();
    resetBackgroundBudgetForTests();
    isSignedInMock.mockResolvedValue(true);

    let fetchCalls = 0;
    const fetchFn = vi.fn(async (_url: unknown, init: RequestInit) => {
      fetchCalls += 1;
      if (init?.signal?.aborted) throw new Error("aborted before send");
      return res({ data: [{ embedding: [1] }], usage: { total_tokens: 1 } });
    });
    vi.stubGlobal("fetch", fetchFn);

    // ~40s of backlog ahead of it, well past the 30s request timeout.
    Array.from({ length: 300 }, () =>
      throughBackgroundBudget(async () => ({ status: 200 })).catch(() => {}),
    );

    const pending = embedBatch(metered, ["hello"]);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(pending).resolves.toMatchObject({ vectors: [[1]] });
    expect(fetchCalls, "one attempt, not a retry after a spurious abort").toBe(1);

    resetBackgroundBudgetForTests();
    vi.unstubAllGlobals();
  });
});

describe("embedBatch — draws on the shared gateway budget", () => {
  afterEach(() => vi.useRealTimers());

  it("waits its turn behind other background work", async () => {
    // /v1/llm/embeddings shares the server's rate-limit bucket with chat, so a
    // memory rebuild that skipped the queue would spend the allowance the
    // labeling agent is waiting on. Nothing else asserts this: unwiring
    // meteredEmbed from the budget leaves every other test passing.
    vi.useFakeTimers();
    resetBackgroundBudgetForTests();
    isSignedInMock.mockResolvedValue(true);

    let embedFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        embedFetches += 1;
        return res({ data: [{ embedding: [1] }], usage: { total_tokens: 1 } });
      }),
    );

    // Fill this second's allowance with other background work.
    Array.from({ length: 7 }, () =>
      throughBackgroundBudget(async () => ({ status: 200 })).catch(() => {}),
    );

    const pending = embedBatch(metered, ["hello"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(embedFetches, "embed jumped the queue instead of waiting its turn").toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toMatchObject({ vectors: [[1]] });
    expect(embedFetches).toBe(1);

    resetBackgroundBudgetForTests();
    vi.unstubAllGlobals();
  });
});
