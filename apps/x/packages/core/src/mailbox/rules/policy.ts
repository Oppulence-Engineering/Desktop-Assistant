/**
 * Action policy.
 *
 * The single gate every mailbox mutation passes through. It answers three
 * things: is the account capable of this action, does it require explicit
 * approval, and is it outright denied by default. High-impact actions (send,
 * forward, spam, trash, external payload with a body) are never allowed to run
 * silently — they are denied or approval-gated regardless of who requested them.
 */

import { ACTION_REQUIRED_CAPABILITIES } from "../capabilities.js";
import type { MailboxAccount, MailboxCapability } from "../types.js";
import type { ExternalPayloadPolicy, MailboxAction, MailboxActionType } from "./types.js";

export type ActionApprovalKind = "send" | "external_payload" | "destructive" | "spam";

export type ActionPolicyDecision =
  | { allowed: true; requiresApproval: false; reason: string }
  | {
      allowed: true;
      requiresApproval: true;
      reason: string;
      approvalKind: ActionApprovalKind;
    }
  | { allowed: false; reason: string };

/** Actions that can have irreversible or outward-facing effects. */
export const HIGH_IMPACT_ACTIONS: ReadonlySet<MailboxActionType> = new Set([
  "send_email",
  "reply",
  "forward",
  "mark_spam",
  "trash",
  "webhook",
  "notify_channel",
]);

export function isHighImpactAction(type: MailboxActionType): boolean {
  return HIGH_IMPACT_ACTIONS.has(type);
}

function hasCapability(account: MailboxAccount, capability: MailboxCapability): boolean {
  return account.capabilities.includes(capability);
}

function requireCapabilityFor(
  action: MailboxAction,
  account: MailboxAccount,
): ActionPolicyDecision | null {
  const required = ACTION_REQUIRED_CAPABILITIES[action.type];
  if (required && !hasCapability(account, required)) {
    return { allowed: false, reason: `Mailbox account is missing the ${required} capability` };
  }
  return null;
}

export function decideActionPolicy(input: {
  action: MailboxAction;
  account: MailboxAccount;
  source: "rule" | "assistant" | "manual";
  /** Whether this specific rule opted into auto-send for reply/send actions. */
  autoSendEnabled?: boolean;
  /** Recipients pre-approved for forward without confirmation. */
  forwardAllowlist?: string[];
}): ActionPolicyDecision {
  const capabilityDenial = requireCapabilityFor(input.action, input.account);
  if (capabilityDenial) return capabilityDenial;

  switch (input.action.type) {
    case "archive":
    case "mark_read":
    case "star":
    case "label":
    case "move":
      return {
        allowed: true,
        requiresApproval: false,
        reason: "Low-risk reversible mailbox action",
      };

    case "draft_reply":
      return {
        allowed: true,
        requiresApproval: false,
        reason: "Creates a draft only; does not send",
      };

    case "digest":
      return { allowed: true, requiresApproval: false, reason: "Queues a digest item" };

    case "delay":
      // The wrapped action is policy-checked when the timer fires.
      return { allowed: true, requiresApproval: false, reason: "Schedules a future action" };

    case "reply":
    case "send_email":
      if (input.action.type === "reply" && input.action.autoSend && input.autoSendEnabled) {
        return {
          allowed: true,
          requiresApproval: true,
          approvalKind: "send",
          reason: "Auto-send is enabled for this rule but every send is still recorded for review",
        };
      }
      return {
        allowed: true,
        requiresApproval: true,
        approvalKind: "send",
        reason: "Sending mail requires explicit approval",
      };

    case "forward": {
      const allowlisted =
        input.forwardAllowlist &&
        input.action.to.every((addr) => input.forwardAllowlist!.includes(addr.toLowerCase()));
      if (allowlisted) {
        return {
          allowed: true,
          requiresApproval: false,
          reason: "Forward recipients are allowlisted",
        };
      }
      return {
        allowed: true,
        requiresApproval: true,
        approvalKind: "send",
        reason: "Forwarding to a non-allowlisted recipient requires approval",
      };
    }

    case "mark_spam":
      return {
        allowed: true,
        requiresApproval: true,
        approvalKind: "spam",
        reason: "Marking spam requires confirmation by default",
      };

    case "trash":
      return {
        allowed: true,
        requiresApproval: true,
        approvalKind: "destructive",
        reason: "Trashing a thread requires confirmation by default",
      };

    case "webhook":
      return decideExternalPayloadPolicy(input.action.payloadPolicy, "webhook");

    case "notify_channel":
      return decideExternalPayloadPolicy(input.action.payloadPolicy, "channel notification");
  }
}

function decideExternalPayloadPolicy(
  payloadPolicy: ExternalPayloadPolicy,
  label: string,
): ActionPolicyDecision {
  if (payloadPolicy.includeBody || payloadPolicy.includeAttachments) {
    return {
      allowed: true,
      requiresApproval: true,
      approvalKind: "external_payload",
      reason: `External ${label} includes sensitive email payload`,
    };
  }
  return {
    allowed: true,
    requiresApproval: false,
    reason: `External ${label} sends a metadata-only payload`,
  };
}
