/**
 * External payload policy.
 *
 * Governs what leaves the device for webhook / channel actions. The default is a
 * metadata-only payload (no body, no attachments); including a body or
 * attachments is opt-in per destination and forces an approval gate upstream in
 * the policy engine. Webhook payloads are HMAC-signed with a timestamp so a
 * receiver can verify authenticity and reject replays.
 */

import { createHmac } from "node:crypto";

import type { MailboxMessage, MailboxThread } from "../types.js";
import type { ExternalPayloadPolicy, MailboxRuleRun } from "../rules/types.js";

export type ExternalMailPayload = {
  email: {
    accountId: string;
    threadId: string;
    messageId: string;
    subject: string;
    from: string;
    snippet?: string;
    body?: string;
    attachments?: Array<{ filename: string; mimeType: string }>;
  };
  executedRule?: {
    id: string;
    ruleId: string;
    reason?: string;
    createdAt: string;
  };
};

export function buildExternalMailPayload(input: {
  thread: MailboxThread;
  message: MailboxMessage;
  ruleRun?: MailboxRuleRun;
  policy: ExternalPayloadPolicy;
}): ExternalMailPayload {
  const { message, policy } = input;

  const payload: ExternalMailPayload = {
    email: {
      accountId: message.accountId,
      threadId: input.thread.id,
      messageId: message.id,
      subject: message.subject,
      from: message.from.email,
      snippet: message.snippet,
    },
  };

  if (policy.includeBody) {
    payload.email.body = message.textBody;
  }

  if (policy.includeAttachments) {
    payload.email.attachments = message.attachments.map((att) => ({
      filename: att.filename,
      mimeType: att.mimeType,
    }));
  }

  if (input.ruleRun) {
    payload.executedRule = {
      id: input.ruleRun.id,
      ruleId: input.ruleRun.ruleId,
      reason: input.ruleRun.reason,
      createdAt: new Date(input.ruleRun.createdAt).toISOString(),
    };
  }

  return payload;
}

export type SignedWebhookRequest = {
  headers: Record<string, string>;
  body: string;
};

/**
 * Signs a webhook body with HMAC-SHA256 over `${timestamp}.${body}`, the
 * standard construction that lets a receiver verify authenticity and reject
 * stale timestamps to prevent replay.
 */
export function signWebhookPayload(input: {
  webhookId: string;
  secret: string;
  payload: ExternalMailPayload;
  timestamp: number;
}): SignedWebhookRequest {
  const body = JSON.stringify(input.payload);
  const signature = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${body}`)
    .digest("hex");

  return {
    body,
    headers: {
      "content-type": "application/json",
      "X-Rowboat-Webhook-Id": input.webhookId,
      "X-Rowboat-Webhook-Timestamp": String(input.timestamp),
      "X-Rowboat-Webhook-Signature": `sha256=${signature}`,
    },
  };
}

/** Constant-time verification helper for receivers/tests. */
export function verifyWebhookSignature(input: {
  secret: string;
  body: string;
  timestamp: number;
  signature: string;
}): boolean {
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
  const provided = input.signature.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
