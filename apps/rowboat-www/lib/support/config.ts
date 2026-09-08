import "server-only";

import { createHmac } from "node:crypto";

/**
 * Plain chat widget configuration.
 *
 * The app id is public (it ships in the browser bundle by design), but the
 * chat secret is not: it signs the email hash Plain treats as a bearer
 * credential for the customer's identity. It is read here, server-side only,
 * and never sent to the browser.
 *
 * Both values come from Plain: Settings -> Chat -> your chat app.
 */
export interface SupportChatConfig {
  appId: string;
  secret: string;
}

export function getSupportChatConfig(): SupportChatConfig {
  return {
    appId: process.env.ROWBOAT_WWW_PLAIN_CHAT_APP_ID?.trim() || "",
    secret: process.env.ROWBOAT_WWW_PLAIN_CHAT_SECRET?.trim() || "",
  };
}

/**
 * Computes the HMAC-SHA256 hash Plain uses to verify that we vouch for this
 * email address. Plain hashes the same email with the same secret and compares,
 * so the input must be byte-identical to the `email` passed to `Plain.init`.
 *
 * Returns null when no secret is configured — the widget then runs anonymous
 * rather than sending an unverifiable identity.
 */
export function emailHash(email: string): string | null {
  const { secret } = getSupportChatConfig();
  if (!secret || !email) return null;
  return createHmac("sha256", secret).update(email).digest("hex");
}
