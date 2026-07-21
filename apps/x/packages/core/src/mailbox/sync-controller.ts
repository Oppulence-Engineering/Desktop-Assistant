/**
 * Incremental sync into the local store.
 *
 * Pulls recent threads through the provider, upserts lightweight summaries into
 * the store so queues and offline listing work, and maintains per-account sync
 * health with backoff. It never throws on a provider failure — it records the
 * failure as sync state so the debug console can explain it — which keeps the
 * desktop sync loop from crashing on a transient 429.
 */

import { MailboxProviderError, serializeMailboxError } from "./errors.js";
import type { MailboxProviderRegistry } from "./provider-registry.js";
import type { MailboxStore, MailboxSyncMode, MailboxSyncState } from "./store.js";
import { computeMailboxBackoff } from "./sync-jobs.js";
import type { MailboxQueue } from "./types.js";

export type MailboxSyncControllerDeps = {
  store: MailboxStore;
  providers: MailboxProviderRegistry;
  logger?: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
};

export type SyncAccountResult = {
  accountId: string;
  ok: boolean;
  threadsSynced: number;
  state: MailboxSyncState;
};

const SYNCED_QUEUES: MailboxQueue[] = ["important", "other"];

export class MailboxSyncController {
  constructor(private readonly deps: MailboxSyncControllerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Whether this account is currently within a backoff window. */
  async isBackedOff(accountId: string): Promise<boolean> {
    const state = await this.deps.store.getSyncState(accountId);
    if (!state?.nextAttemptAt) return false;
    return state.nextAttemptAt > this.now();
  }

  async syncAccount(accountId: string): Promise<SyncAccountResult> {
    const now = this.now();

    if (await this.isBackedOff(accountId)) {
      const state = await this.deps.store.getSyncState(accountId);
      return { accountId, ok: false, threadsSynced: 0, state: state! };
    }

    await this.deps.store.updateSyncState(accountId, {
      mode: "incremental",
      lastAttemptAt: now,
    });

    try {
      const provider = await this.deps.providers.get(accountId);
      let synced = 0;

      for (const queue of SYNCED_QUEUES) {
        const page = await provider.listThreads({ accountId, queue, limit: 50 });
        for (const summary of page.threads) {
          await this.deps.store.upsertThreadSummary(summary);
          synced += 1;
        }
      }

      const account = await this.deps.store.getAccount(accountId);
      if (account) {
        await this.deps.store.upsertAccount({
          ...account,
          status: "connected",
          lastSyncAt: now,
          lastError: undefined,
        });
      }

      const state = await this.deps.store.updateSyncState(accountId, {
        mode: "idle",
        cursorHealth: "healthy",
        lastSuccessfulSyncAt: now,
        nextAttemptAt: undefined,
        consecutiveFailures: 0,
        lastError: undefined,
      });

      return { accountId, ok: true, threadsSynced: synced, state };
    } catch (error) {
      return {
        accountId,
        ok: false,
        threadsSynced: 0,
        state: await this.recordFailure(accountId, error, now),
      };
    }
  }

  private async recordFailure(
    accountId: string,
    error: unknown,
    now: number,
  ): Promise<MailboxSyncState> {
    const providerError = error instanceof MailboxProviderError ? error : undefined;
    const prior = await this.deps.store.getSyncState(accountId);
    const attempt = (prior?.consecutiveFailures ?? 0) + 1;

    const retryAt = computeMailboxBackoff({
      attempt,
      retryAfterMs: providerError?.options.retryAfterMs,
      now,
    });

    const mode: MailboxSyncMode = providerError?.needsReconnect ? "needs_reconnect" : "backoff";

    this.deps.logger?.warn?.(
      `[mailbox] sync failed for ${accountId}: ${providerError?.code ?? "unknown"} (attempt ${attempt})`,
    );

    const account = await this.deps.store.getAccount(accountId);
    if (account) {
      await this.deps.store.upsertAccount({
        ...account,
        status: providerError?.needsReconnect
          ? "needs_reconnect"
          : providerError?.code === "provider_rate_limited"
            ? "rate_limited"
            : "sync_error",
        lastError: serializeMailboxError(error),
      });
    }

    return this.deps.store.updateSyncState(accountId, {
      mode,
      cursorHealth:
        providerError?.code === "cursor_invalid" ? "invalid" : (prior?.cursorHealth ?? "unknown"),
      nextAttemptAt: retryAt,
      consecutiveFailures: attempt,
      lastError: serializeMailboxError(error),
    });
  }
}
