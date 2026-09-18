import "server-only";

import { createHmac } from "node:crypto";

import { isDevelopment } from "@/lib/environment";

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
  labelTypeIds: string[];
}

/**
 * Label applied to every thread the web widget opens, so support can tell
 * Oppulence traffic apart from the other brands sharing this Plain workspace.
 * Defaults to the "Brand: Oppulence" label type; override per environment.
 */
const DEFAULT_LABEL_TYPE_ID = "lt_01M20XH6PFZ1F5EY4V19WWP7DG";

/**
 * Fly / GitHub secrets often arrive with a trailing newline or wrapping quotes.
 * Those extra bytes change the HMAC and Plain rejects the widget with
 * "The provided email hash is invalid".
 */
export function normalizeChatSecret(raw: string): string {
  return raw
    .trim()
    .replace(/\r?\n/g, "")
    .replace(/^['"]|['"]$/g, "");
}

/**
 * Workspace API keys and chat app ids cannot sign an email hash. Sending a
 * hash minted with the wrong kind of secret is what takes the widget down.
 */
export function isUsableChatSecret(secret: string): boolean {
  const value = normalizeChatSecret(secret);
  if (!value) return false;
  if (value.startsWith("plainApiKey_")) return false;
  if (value.startsWith("liveChatApp_")) return false;
  return true;
}

export function getSupportChatConfig(): SupportChatConfig {
  const labels = process.env.ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS?.trim();
  return {
    appId: process.env.ROWBOAT_WWW_PLAIN_CHAT_APP_ID?.trim() || "",
    secret: normalizeChatSecret(process.env.ROWBOAT_WWW_PLAIN_CHAT_SECRET || ""),
    labelTypeIds: (labels ? labels.split(",") : [DEFAULT_LABEL_TYPE_ID])
      .map((id) => id.trim())
      .filter(Boolean),
  };
}

/** Plain is off in local dev unless explicitly enabled — avoids invalid hash noise. */
export function isPlainChatEnabled(): boolean {
  const { appId } = getSupportChatConfig();
  if (!appId) return false;
  if (isDevelopment()) {
    return process.env.ROWBOAT_WWW_PLAIN_CHAT_ENABLED === "1";
  }
  return true;
}

/**
 * Email+hash identify is opt-in in every environment.
 *
 * A hash Plain cannot verify fails the widget launch for every signed-in user
 * (`ChatAPIError: The provided email hash is invalid`). Keep it off until the
 * Chat settings secret is confirmed against this app id.
 */
export function shouldIdentifySupportChatCustomer(): boolean {
  if (!isUsableChatSecret(getSupportChatConfig().secret)) return false;
  return process.env.ROWBOAT_WWW_PLAIN_CHAT_IDENTIFY === "1";
}

/**
 * Computes the HMAC-SHA256 hash Plain uses to verify that we vouch for this
 * email address. Plain hashes the same email with the same secret and compares,
 * so the input must be byte-identical to the `email` passed to `Plain.init`.
 *
 * Returns null when no usable secret is configured — the widget then still
 * receives the email as an unverified hint rather than a signed identity.
 */
export function emailHash(email: string): string | null {
  const { secret } = getSupportChatConfig();
  if (!isUsableChatSecret(secret) || !email) return null;
  return createHmac("sha256", secret).update(email).digest("hex");
}
