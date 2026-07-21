/**
 * Action runner.
 *
 * Executes a single action end to end: policy gate → schedule (if delayed) →
 * provider mutation or store write → audit. It is the only component allowed to
 * call a provider mutation, and it records an audit row for every outcome
 * (denied, needs-approval, scheduled, succeeded, failed). Assistant- and
 * rule-sourced actions flow through here identically, so the same safety policy
 * applies no matter who asked.
 */

import { localId } from "../ids.js";
import { serializeMailboxError } from "../errors.js";
import type { MailboxProviderRegistry } from "../provider-registry.js";
import type { MailboxStore } from "../store.js";
import type { MailboxAccount, MailboxMessage, MailboxThread, MailboxThreadRef } from "../types.js";
import { MailboxAuditLog } from "./audit.js";
import { decideActionPolicy } from "./policy.js";
import { MailboxScheduledActionScheduler, type ScheduledActionExecutor } from "./scheduler.js";
import type { MailboxAction, MailboxActionRun, MailboxScheduledAction } from "./types.js";

export type ActionExecutionContext = {
  account: MailboxAccount;
  thread: MailboxThread;
  message: MailboxMessage;
  action: MailboxAction;
};

/** Optional side-effect handlers the core does not implement directly. */
export type MailboxActionHooks = {
  /** Materialize a local draft suggestion for a draft_reply action. */
  draftReply?(ctx: ActionExecutionContext): Promise<{ draftId?: string } | void>;
  webhook?(ctx: ActionExecutionContext): Promise<void>;
  notifyChannel?(ctx: ActionExecutionContext): Promise<void>;
};

export type MailboxActionRunnerDeps = {
  store: MailboxStore;
  providers: MailboxProviderRegistry;
  audit: MailboxAuditLog;
  scheduler: MailboxScheduledActionScheduler;
  hooks?: MailboxActionHooks;
  autoSendEnabled?: boolean;
  forwardAllowlist?: string[];
};

export type RunActionInput = {
  accountId: string;
  ruleRunId?: string;
  actionIndex?: number;
  action: MailboxAction;
  thread: MailboxThread;
  message: MailboxMessage;
  source: "rule" | "assistant" | "manual";
  approvalToken?: string;
};

function toThreadRef(account: MailboxAccount, thread: MailboxThread): MailboxThreadRef {
  return {
    accountId: account.id,
    provider: account.provider,
    providerThreadId: thread.providerThreadId,
    rowboatThreadId: thread.id,
  };
}

export class MailboxActionRunner implements ScheduledActionExecutor {
  constructor(private readonly deps: MailboxActionRunnerDeps) {}

  async run(input: RunActionInput): Promise<MailboxActionRun> {
    const account = await this.deps.store.getAccount(input.accountId);
    if (!account) throw new Error(`Mailbox account not found: ${input.accountId}`);

    const actionIndex = input.actionIndex ?? 0;
    const policy = decideActionPolicy({
      action: input.action,
      account,
      source: input.source,
      autoSendEnabled: this.deps.autoSendEnabled,
      forwardAllowlist: this.deps.forwardAllowlist,
    });

    const auditInput = {
      accountId: input.accountId,
      ruleRunId: input.ruleRunId,
      action: input.action,
      actionIndex,
      source: input.source,
      policy,
    } as const;

    if (!policy.allowed) {
      return this.deps.audit.recordActionDenied(auditInput);
    }

    if (input.action.type === "delay") {
      const scheduled = await this.deps.scheduler.scheduleDelayedAction({
        accountId: input.accountId,
        ruleRunId: input.ruleRunId,
        action: input.action.action,
        delayMinutes: input.action.delayMinutes,
        threadId: input.thread.id,
        providerThreadId: input.thread.providerThreadId,
        messageId: input.message.id,
      });
      return this.deps.audit.recordActionScheduled(auditInput, scheduled.scheduledFor);
    }

    if (policy.requiresApproval && !input.approvalToken) {
      return this.deps.audit.recordActionNeedsApproval(auditInput);
    }

    const run = await this.deps.audit.recordActionStarted(auditInput);

    try {
      const result = await this.execute({
        account,
        thread: input.thread,
        message: input.message,
        action: input.action,
      });
      return this.deps.audit.recordActionSucceeded(run.id, result ?? {});
    } catch (error) {
      return this.deps.audit.recordActionFailed(
        run.id,
        serializeMailboxError(error) as Record<string, unknown>,
      );
    }
  }

  private async execute(ctx: ActionExecutionContext): Promise<Record<string, unknown> | void> {
    const { account, thread, action } = ctx;
    const ref = toThreadRef(account, thread);
    const provider = await this.deps.providers.get(account.id);

    switch (action.type) {
      case "archive":
        await provider.archiveThread(ref);
        return { archived: true };

      case "mark_read":
        await provider.markThreadRead(ref);
        return { markedRead: true };

      case "trash":
        await provider.trashThread(ref);
        return { trashed: true };

      case "star":
        await provider.applyLabel(ref, "STARRED");
        return { starred: true };

      case "label":
        await provider.applyLabel(ref, action.labelId);
        return { labelId: action.labelId };

      case "move":
        await provider.moveThread(ref, action.folderId);
        return { folderId: action.folderId };

      case "mark_spam":
        await provider.applyLabel(ref, "SPAM");
        return { markedSpam: true };

      case "digest":
        await this.deps.store.enqueueDigestItem({
          id: localId("digest"),
          accountId: account.id,
          threadId: thread.id,
          messageId: ctx.message.id,
          priority: action.priority,
          createdAt: Date.now(),
        });
        return { queuedForDigest: true };

      case "draft_reply": {
        const result = await this.deps.hooks?.draftReply?.(ctx);
        return { draftId: result?.draftId, deferred: !this.deps.hooks?.draftReply };
      }

      case "reply": {
        const sent = await provider.reply({
          accountId: account.id,
          providerThreadId: thread.providerThreadId,
          inReplyToHeaderMessageId: ctx.message.headerMessageId,
          to: [ctx.message.from],
          subject: thread.subject,
          bodyText: action.prompt ?? "",
        });
        return { sentMessageId: sent.providerMessageId };
      }

      case "send_email": {
        if (action.to.length === 0) throw new Error("send_email requires at least one recipient");
        const sent = await provider.sendEmail({
          accountId: account.id,
          to: action.to.map((email) => ({ email })),
          subject: action.subject ?? thread.subject,
          bodyText: action.body ?? "",
        });
        return { sentMessageId: sent.providerMessageId };
      }

      case "forward":
        await provider.forward({
          accountId: account.id,
          providerThreadId: thread.providerThreadId,
          providerMessageId: ctx.message.providerMessageId,
          to: action.to.map((email) => ({ email })),
          note: action.note,
        });
        return { forwardedTo: action.to };

      case "webhook":
        await this.deps.hooks?.webhook?.(ctx);
        return { webhookDispatched: Boolean(this.deps.hooks?.webhook) };

      case "notify_channel":
        await this.deps.hooks?.notifyChannel?.(ctx);
        return { notified: Boolean(this.deps.hooks?.notifyChannel) };

      case "delay":
        throw new Error("delay actions must be scheduled, not executed directly");
    }
  }

  async executeScheduled(scheduled: MailboxScheduledAction): Promise<void> {
    const thread = await this.hydrateThread(scheduled.accountId, scheduled.providerThreadId);
    if (!thread) throw new Error(`Thread no longer available: ${scheduled.providerThreadId}`);
    const message = thread.messages.at(-1);
    if (!message) throw new Error("Scheduled action target thread has no messages");

    await this.run({
      accountId: scheduled.accountId,
      ruleRunId: scheduled.ruleRunId,
      action: scheduled.action,
      thread,
      message,
      source: "rule",
    });
  }

  private async hydrateThread(
    accountId: string,
    providerThreadId: string,
  ): Promise<MailboxThread | null> {
    const provider = await this.deps.providers.tryGet(accountId);
    if (!provider) return null;
    const account = provider.account;
    return provider.getThread({
      accountId,
      provider: account.provider,
      providerThreadId,
    });
  }
}
