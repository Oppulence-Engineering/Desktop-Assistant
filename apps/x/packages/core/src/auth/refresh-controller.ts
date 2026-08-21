import * as oauthClient from "./oauth-client.js";
import {
  AuthUnavailableError,
  ReconnectRequiredError,
  TransientRefreshError,
} from "./refresh-errors.js";
import { IOAuthRepo, ProviderConnection } from "./repo.js";
import { OAuthTokens } from "./types.js";
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID } from "@x/shared/branding";

export type AuthStateName = "idle" | "refreshing" | "backoff" | "reconnect_required";

export interface AuthState {
  state: AuthStateName;
  /** Epoch ms when the next refresh attempt is allowed (backoff only). */
  retryAt?: number;
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RECONNECT_ERROR_MESSAGE = "Session expired — please sign in again.";

interface Deps {
  repo: () => IOAuthRepo;
  refresh: (refreshToken: string) => Promise<OAuthTokens>;
  now?: () => number;
  /** Jitter source in [0,1). Injectable for tests. */
  random?: () => number;
}

/**
 * Refresh state machine for the WorkOS-brokered product session.
 *
 *   idle ── token expired ──▶ refreshing
 *   refreshing ── success ──▶ idle (attempt reset)
 *   refreshing ── transient ──▶ backoff{until} — getAccessToken fails fast,
 *     zero network, until the window passes (kills the 15s-tick hammering
 *     that used to trip the broker rate limit and burn the rotating token)
 *   refreshing ── invalid_grant on the token we actually used ──▶
 *     reconnect_required — persisted via the provider `error` field, which
 *     drives the "Needs reconnect" UI; exits automatically when a different
 *     refresh token shows up in the repo (user re-signed in, or another
 *     writer rotated successfully).
 */
export class RefreshController {
  private state: AuthStateName = "idle";
  private backoffUntil = 0;
  private attempt = 0;
  private failedRt: string | null = null;
  private seededFromDisk = false;
  private refreshInFlight: Promise<OAuthTokens> | null = null;

  constructor(private readonly deps: Deps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  getState(): AuthState {
    if (this.state === "backoff" && this.now() >= this.backoffUntil) {
      return { state: "idle" };
    }
    return {
      state: this.state,
      ...(this.state === "backoff" ? { retryAt: this.backoffUntil } : {}),
    };
  }

  async getAccessToken(): Promise<string> {
    const repo = this.deps.repo();
    const conn = await repo.read(PRODUCT_PROVIDER_ID);

    // Seed reconnect-required from the persisted provider error once per
    // process, so a session bricked before a restart stays visibly bricked
    // instead of retrying into the same invalid_grant.
    if (!this.seededFromDisk) {
      this.seededFromDisk = true;
      if (conn.error && this.state === "idle") {
        this.state = "reconnect_required";
        this.failedRt = conn.tokens?.refresh_token ?? null;
      }
    }

    const tokens = conn.tokens;
    if (!tokens) {
      throw new AuthUnavailableError("not_signed_in", `Not signed into ${PRODUCT_NAME}`);
    }

    // A still-valid access token is usable regardless of refresh state.
    if (!oauthClient.isTokenExpired(tokens)) {
      return tokens.access_token;
    }

    if (this.state === "reconnect_required") {
      const storedRt = tokens.refresh_token ?? null;
      if (
        storedRt !== this.failedRt ||
        (storedRt === null && this.failedRt === null && !conn.error)
      ) {
        // A different token appeared (re-login or another writer rotated) —
        // self-heal without any event wiring.
        this.toIdle();
      } else {
        throw new AuthUnavailableError(
          "reconnect_required",
          `${PRODUCT_NAME} session expired; sign in again.`,
        );
      }
    }

    if (!tokens.refresh_token) {
      // Expired bundle with no refresh token (e.g. devstack-minted): terminal.
      // Write the provider error once so the UI shows "Needs reconnect"
      // instead of every background tick throwing a fresh error.
      if (!conn.error) {
        await repo.upsert(PRODUCT_PROVIDER_ID, { error: RECONNECT_ERROR_MESSAGE });
      }
      this.state = "reconnect_required";
      this.failedRt = null;
      throw new AuthUnavailableError(
        "reconnect_required",
        `${PRODUCT_NAME} token expired and no refresh token available. Please sign in again.`,
      );
    }

    if (this.state === "backoff") {
      const now = this.now();
      if (now < this.backoffUntil) {
        throw new AuthUnavailableError(
          "refresh_backoff",
          `${PRODUCT_NAME} token refresh backing off (retry in ${Math.ceil((this.backoffUntil - now) / 1000)}s)`,
          this.backoffUntil,
        );
      }
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.performRefresh(tokens.refresh_token).finally(() => {
        this.refreshInFlight = null;
      });
    }
    const refreshed = await this.refreshInFlight;
    return refreshed.access_token;
  }

  private async performRefresh(usedRt: string): Promise<OAuthTokens> {
    this.state = "refreshing";
    const repo = this.deps.repo();

    // Last-moment re-read: if another writer already rotated and stored a
    // fresh bundle, use it — no network call, no token burn.
    const pre = await repo.read(PRODUCT_PROVIDER_ID);
    const preRt = pre.tokens?.refresh_token ?? null;
    if (pre.tokens && preRt !== usedRt && !oauthClient.isTokenExpired(pre.tokens)) {
      this.toIdle();
      return pre.tokens;
    }
    if (preRt) usedRt = preRt;

    try {
      const refreshed = await this.deps.refresh(usedRt);
      const result = await this.casOrUpsert(repo, usedRt, { tokens: refreshed, error: null });
      this.toIdle();
      if (result && !result.written && result.current.tokens) {
        // Someone rotated mid-flight; prefer what's stored — with the broker's
        // dedup cache both writers received the same bundle within the TTL.
        return result.current.tokens;
      }
      return refreshed;
    } catch (err) {
      if (err instanceof ReconnectRequiredError) {
        const result = await this.casOrUpsert(repo, usedRt, { error: RECONNECT_ERROR_MESSAGE });
        const storedRt = result?.current.tokens?.refresh_token ?? usedRt;
        if (storedRt !== usedRt) {
          // invalid_grant on a token someone else already rotated — we lost a
          // race, not the session. Back off and let the next attempt pick up
          // the stored token.
          this.armBackoff(undefined);
          throw new TransientRefreshError(
            "refresh raced a concurrent rotation; will retry with the stored token",
            409,
          );
        }
        this.state = "reconnect_required";
        this.failedRt = usedRt;
        throw new AuthUnavailableError("reconnect_required", err.message);
      }
      const retryAfterMs = err instanceof TransientRefreshError ? err.retryAfterMs : undefined;
      this.armBackoff(retryAfterMs);
      throw err;
    }
  }

  /** CAS when the repo supports it; plain upsert otherwise (legacy mocks). */
  private async casOrUpsert(
    repo: IOAuthRepo,
    expectedRt: string,
    connection: Partial<ProviderConnection>,
  ): Promise<{ written: boolean; current: ProviderConnection } | null> {
    if (typeof repo.compareAndSwapTokens === "function") {
      return repo.compareAndSwapTokens(PRODUCT_PROVIDER_ID, expectedRt, connection);
    }
    await repo.upsert(PRODUCT_PROVIDER_ID, connection);
    return null;
  }

  private toIdle(): void {
    this.state = "idle";
    this.attempt = 0;
    this.failedRt = null;
    this.backoffUntil = 0;
  }

  private armBackoff(retryAfterMs: number | undefined): void {
    this.attempt += 1;
    const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    const base = Math.max(retryAfterMs ?? 0, exponential);
    const jitter = base * 0.1 * (this.deps.random?.() ?? Math.random());
    this.backoffUntil = this.now() + base + jitter;
    this.state = "backoff";
  }
}
