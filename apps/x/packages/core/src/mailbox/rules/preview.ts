/**
 * Rule preview and conflict detection.
 *
 * A rule must be testable before it is enabled: run it against sample threads
 * and show exactly which matched and what would have happened, without executing
 * anything. Conflict detection warns about action sets that fight each other
 * (archive + move) or are outright invalid (two reply drafts).
 */

import type { MailboxStore } from "../store.js";
import { evaluateRuleConditions, ruleMatched, type MailAiMatcher } from "./conditions.js";
import { isHighImpactAction } from "./policy.js";
import type {
  MailboxAction,
  MailboxActionConflict,
  MailboxPlannedAction,
  MailboxRule,
  MailboxRulePreview,
  MailboxRulePreviewResult,
} from "./types.js";

export function describePlannedAction(action: MailboxAction): MailboxPlannedAction {
  const description = ((): string => {
    switch (action.type) {
      case "archive":
        return "Archive the thread";
      case "mark_read":
        return "Mark the thread read";
      case "star":
        return "Star the thread";
      case "label":
        return `Apply label ${action.labelId}`;
      case "move":
        return `Move to folder ${action.folderId}`;
      case "mark_spam":
        return "Mark as spam (requires confirmation)";
      case "trash":
        return "Move to trash (requires confirmation)";
      case "draft_reply":
        return "Draft a reply (not sent)";
      case "reply":
        return action.autoSend ? "Reply and send (requires approval)" : "Draft a reply";
      case "forward":
        return `Forward to ${action.to.join(", ")} (requires approval)`;
      case "send_email":
        return "Send an email (requires approval)";
      case "digest":
        return `Add to ${action.priority} digest`;
      case "delay":
        return `After ${action.delayMinutes} min: ${describePlannedAction(action.action).description}`;
      case "webhook":
        return `Call webhook ${action.destinationId}`;
      case "notify_channel":
        return `Notify channel ${action.channelId}`;
    }
  })();

  return {
    actionId: action.id,
    actionType: action.type,
    description,
    highImpact: isHighImpactAction(action.type),
  };
}

export async function previewRule(input: {
  ruleDraft: MailboxRule;
  sampleThreadIds: string[];
  store: MailboxStore;
  matcher: MailAiMatcher;
  now?: number;
  /** Resolve a full thread by store id; the store keeps summaries, this hydrates. */
  getThread: (threadId: string) => Promise<import("../types.js").MailboxThread | null>;
}): Promise<MailboxRulePreview> {
  const results: MailboxRulePreviewResult[] = [];

  for (const threadId of input.sampleThreadIds) {
    const thread = await input.getThread(threadId);
    if (!thread) continue;
    const latest = thread.messages.at(-1);
    if (!latest) continue;

    const conditionResults = await evaluateRuleConditions({
      rule: input.ruleDraft,
      thread,
      message: latest,
      aiMatcher: input.matcher,
      now: input.now,
    });

    const matched = ruleMatched(input.ruleDraft, conditionResults);

    results.push({
      threadId: thread.id,
      providerThreadId: thread.providerThreadId,
      subject: thread.subject,
      matched,
      conditionResults,
      plannedActions: matched ? input.ruleDraft.actions.map(describePlannedAction) : [],
    });
  }

  return {
    ruleName: input.ruleDraft.name,
    matchedCount: results.filter((r) => r.matched).length,
    totalCount: results.length,
    results,
  };
}

export function findActionConflicts(actions: MailboxAction[]): MailboxActionConflict[] {
  const conflicts: MailboxActionConflict[] = [];
  const hasArchive = actions.some((a) => a.type === "archive");
  const moveActions = actions.filter((a) => a.type === "move");
  const draftActions = actions.filter((a) => a.type === "draft_reply" || a.type === "reply");
  const hasTrash = actions.some((a) => a.type === "trash");

  if (hasArchive && moveActions.length > 0) {
    conflicts.push({
      severity: "warning",
      message:
        "Rule both archives and moves the thread. Move may already remove it from the inbox.",
      actionIds: moveActions.map((a) => a.id),
    });
  }

  if (hasTrash && (hasArchive || moveActions.length > 0)) {
    conflicts.push({
      severity: "warning",
      message: "Rule trashes the thread alongside archive/move; the other actions are redundant.",
      actionIds: actions.filter((a) => a.type === "archive" || a.type === "move").map((a) => a.id),
    });
  }

  if (draftActions.length > 1) {
    conflicts.push({
      severity: "error",
      message: "Rule creates more than one reply for the same message.",
      actionIds: draftActions.map((a) => a.id),
    });
  }

  return conflicts;
}
