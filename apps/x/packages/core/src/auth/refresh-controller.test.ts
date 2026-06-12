import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshController } from "./refresh-controller.js";
import { ReconnectRequiredError, TransientRefreshError } from "./refresh-errors.js";
import type { IOAuthRepo, ProviderConnection } from "./repo.js";
import type { OAuthTokens } from "./types.js";

const NOW = 1_800_000_000_000; // fixed epoch ms

function tokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_at: Math.floor(NOW / 1000) - 120, // expired
    token_type: "Bearer",
    ...overrides,
  };
}

function freshTokens(rt = "rt-2"): OAuthTokens {
  return {
    access_token: "at-2",
    refresh_token: rt,
    expires_at: Math.floor(NOW / 1000) + 3600,
    token_type: "Bearer",
  };
}

/** Minimal in-memory repo implementing the full IOAuthRepo surface. */
function makeRepo(initial: ProviderConnection): IOAuthRepo & { store: ProviderConnection } {
  const repo = {
    store: { ...initial },
    read: vi.fn(async () => ({ ...repo.store })),
    upsert: vi.fn(async (_p: string, conn: Partial<ProviderConnection>) => {
      repo.store = { ...repo.store, ...conn };
    }),
    delete: vi.fn(async () => {
      repo.store = {};
    }),
    getClientFacingConfig: vi.fn(async () => ({})),
    compareAndSwapTokens: vi.fn(
      async (_p: string, expectedRt: string | null, conn: Partial<ProviderConnection>) => {
        const storedRt = repo.store.tokens?.refresh_token ?? null;
        if (storedRt !== expectedRt) {
          return { written: false, current: { ...repo.store } };
        }
        repo.store = { ...repo.store, ...conn };
        return { written: true, current: { ...repo.store } };
      },
    ),
  };
  return repo;
}

function makeController(
  repo: IOAuthRepo,
  refresh: (rt: string) => Promise<OAuthTokens>,
): RefreshController {
  return new RefreshController({
    repo: () => repo,
    refresh,
    now: () => Date.now(), // driven by fake timers
    random: () => 0, // deterministic jitter
  });
}

describe("RefreshController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a valid token without refreshing", async () => {
    const repo = makeRepo({ tokens: freshTokens() });
    const refresh = vi.fn();
    const c = makeController(repo, refresh);
    await expect(c.getAccessToken()).resolves.toBe("at-2");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("throws not_signed_in when no tokens exist", async () => {
    const repo = makeRepo({});
    const c = makeController(repo, vi.fn());
    await expect(c.getAccessToken()).rejects.toMatchObject({
      name: "AuthUnavailableError",
      reason: "not_signed_in",
    });
  });

  it("single-flights concurrent refreshes", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return freshTokens();
    });
    const c = makeController(repo, refresh);
    const calls = Promise.all(Array.from({ length: 10 }, () => c.getAccessToken()));
    await vi.advanceTimersByTimeAsync(60);
    const results = await calls;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(["at-2"]));
    expect(repo.store.tokens?.refresh_token).toBe("rt-2");
  });

  it("honors Retry-After on 429 and fast-fails during backoff with zero fetches", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new TransientRefreshError("rate limited", 429, 30_000))
      .mockResolvedValue(freshTokens());
    const c = makeController(repo, refresh);

    await expect(c.getAccessToken()).rejects.toBeInstanceOf(TransientRefreshError);
    expect(c.getState().state).toBe("backoff");
    expect(c.getState().retryAt).toBeGreaterThanOrEqual(NOW + 30_000);

    // Inside the window: AuthUnavailableError, no network.
    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "refresh_backoff" });
    expect(refresh).toHaveBeenCalledTimes(1);

    // After the window: retries and succeeds.
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(c.getAccessToken()).resolves.toBe("at-2");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(c.getState().state).toBe("idle");
  });

  it("backs off exponentially with a 5min cap on repeated 5xx", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn().mockRejectedValue(new TransientRefreshError("upstream", 502));
    const c = makeController(repo, refresh);

    let prevRetry = NOW;
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await expect(c.getAccessToken()).rejects.toBeInstanceOf(TransientRefreshError);
      const retryAt = c.getState().retryAt!;
      delays.push(retryAt - Date.now());
      const wait = retryAt - Date.now() + 1;
      await vi.advanceTimersByTimeAsync(wait);
      expect(retryAt).toBeGreaterThan(prevRetry);
      prevRetry = retryAt;
    }
    expect(delays[0]).toBe(5_000);
    expect(delays[1]).toBe(10_000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5 * 60_000);
    expect(delays[7]).toBe(5 * 60_000);
  });

  it("enters reconnect_required on invalid_grant: one error upsert, then no fetch, no repeat writes", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn().mockRejectedValue(new ReconnectRequiredError("invalid_grant"));
    const c = makeController(repo, refresh);

    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(repo.store.error).toBeTruthy();
    expect(repo.store.tokens?.refresh_token).toBe("rt-1"); // tokens left in place

    const writes = (repo.compareAndSwapTokens as ReturnType<typeof vi.fn>).mock.calls.length;
    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    expect(refresh).toHaveBeenCalledTimes(1); // no further network
    expect((repo.compareAndSwapTokens as ReturnType<typeof vi.fn>).mock.calls.length).toBe(writes);
  });

  it("recovers from reconnect_required when a different refresh token appears", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new ReconnectRequiredError("invalid_grant"))
      .mockResolvedValue(freshTokens("rt-3"));
    const c = makeController(repo, refresh);

    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });

    // User re-signs in: new (expired, to force a refresh) bundle with a new RT.
    repo.store = { tokens: tokens({ refresh_token: "rt-new" }), error: null };
    await expect(c.getAccessToken()).resolves.toBe("at-2");
    expect(refresh).toHaveBeenLastCalledWith("rt-new");
    expect(c.getState().state).toBe("idle");
  });

  it("treats expired bundle with null refresh_token as terminal once (no loop)", async () => {
    const repo = makeRepo({ tokens: tokens({ refresh_token: null }) });
    const refresh = vi.fn();
    const c = makeController(repo, refresh);

    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    expect(refresh).not.toHaveBeenCalled();
    expect((repo.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1); // single error write
  });

  it("prefers the stored bundle when another writer rotated mid-flight", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn(async () => {
      // Simulate a second app instance rotating + writing while our network
      // call is in flight.
      repo.store = { tokens: freshTokens("rt-other"), error: null };
      return freshTokens("rt-mine");
    });
    const c = makeController(repo, refresh);

    const at = await c.getAccessToken();
    expect(at).toBe("at-2");
    // CAS must have refused the write; the other writer's bundle stands.
    expect(repo.store.tokens?.refresh_token).toBe("rt-other");
  });

  it("uses a fresh stored bundle instead of refreshing when one appeared pre-flight", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn();
    const c = makeController(repo, refresh);
    // Between the outer read and performRefresh's re-read, another writer
    // stores a fresh bundle.
    (repo.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ tokens: tokens() }) // outer getAccessToken read
      .mockResolvedValueOnce({ tokens: freshTokens("rt-other") }); // pre-flight read
    await expect(c.getAccessToken()).resolves.toBe("at-2");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("seeds reconnect_required from a persisted provider error", async () => {
    const repo = makeRepo({ tokens: tokens(), error: "Session expired — please sign in again." });
    const refresh = vi.fn();
    const c = makeController(repo, refresh);
    await expect(c.getAccessToken()).rejects.toMatchObject({ reason: "reconnect_required" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("treats invalid_grant on a stale token as transient when stored RT differs", async () => {
    const repo = makeRepo({ tokens: tokens() });
    const refresh = vi.fn(async () => {
      // Another writer rotates while our call is out; ours comes back invalid_grant.
      repo.store = { tokens: freshTokens("rt-other"), error: null };
      throw new ReconnectRequiredError("invalid_grant");
    });
    const c = makeController(repo, refresh);
    await expect(c.getAccessToken()).rejects.toBeInstanceOf(TransientRefreshError);
    expect(c.getState().state).toBe("backoff");
    expect(repo.store.error).toBeNull(); // session NOT flagged for reconnect
  });
});
