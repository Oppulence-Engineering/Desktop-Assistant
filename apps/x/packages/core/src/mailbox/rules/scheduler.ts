/**
 * Delayed action scheduler.
 *
 * Schedules a concrete action to run after a delay and executes due ones. The
 * dedupe key keeps a delayed action from being scheduled twice for the same
 * message/rule, and cancellation lets reply tracking call off a pending nudge
 * when the thread state changes.
 *
 * The scheduler depends only on the store and an injected executor, breaking the
 * cycle with the action runner (runner schedules delays; scheduler asks the
 * runner to execute due actions).
 */

import { localId, stableHash } from "../ids.js";
import { serializeMailboxError } from "../errors.js";
import type { MailboxStore } from "../store.js";
import type { MailboxConcreteAction, MailboxScheduledAction } from "./types.js";

export interface ScheduledActionExecutor {
  executeScheduled(scheduled: MailboxScheduledAction): Promise<void>;
}

export type ScheduleDelayedActionInput = {
  accountId: string;
  ruleRunId?: string;
  action: MailboxConcreteAction;
  delayMinutes: number;
  threadId: string;
  providerThreadId: string;
  messageId?: string;
};

export class MailboxScheduledActionScheduler {
  constructor(private readonly deps: { store: MailboxStore; now?: () => number }) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async scheduleDelayedAction(input: ScheduleDelayedActionInput): Promise<MailboxScheduledAction> {
    const dedupeKey = stableHash([
      "scheduled_action_v1",
      input.accountId,
      input.providerThreadId,
      input.messageId ?? "",
      input.action.id,
    ]);

    const existing = await this.deps.store.getScheduledActionByDedupeKey(dedupeKey);
    if (existing && existing.status === "scheduled") return existing;

    const now = this.now();
    return this.deps.store.createScheduledAction({
      id: localId("sched", dedupeKey),
      accountId: input.accountId,
      ruleRunId: input.ruleRunId,
      actionId: input.action.id,
      action: input.action,
      threadId: input.threadId,
      providerThreadId: input.providerThreadId,
      messageId: input.messageId,
      scheduledFor: now + input.delayMinutes * 60_000,
      status: "scheduled",
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  async cancelForThread(
    accountId: string,
    providerThreadId: string,
    reason: string,
  ): Promise<number> {
    return this.deps.store.cancelScheduledActionsForThread(accountId, providerThreadId, reason);
  }

  /**
   * Executes every scheduled action whose time has come. Each execution is
   * isolated: one failure is recorded on that action and does not stop the rest.
   */
  async runDue(
    executor: ScheduledActionExecutor,
    now = this.now(),
  ): Promise<MailboxScheduledAction[]> {
    const due = await this.deps.store.listDueScheduledActions(now);
    const processed: MailboxScheduledAction[] = [];

    for (const scheduled of due) {
      await this.deps.store.updateScheduledAction(scheduled.id, { status: "executing" });
      try {
        await executor.executeScheduled(scheduled);
        processed.push(
          await this.deps.store.updateScheduledAction(scheduled.id, { status: "executed" }),
        );
      } catch (error) {
        processed.push(
          await this.deps.store.updateScheduledAction(scheduled.id, {
            status: "failed",
            cancelReason: serializeMailboxError(error).message,
          }),
        );
      }
    }

    return processed;
  }
}
