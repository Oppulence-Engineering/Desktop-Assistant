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

export function getSupportChatConfig(): SupportChatConfig {
  const labels = process.env.ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS?.trim();
  return {
    appId: process.env.ROWBOAT_WWW_PLAIN_CHAT_APP_ID?.trim() || "",
    secret: process.env.ROWBOAT_WWW_PLAIN_CHAT_SECRET?.trim() || "",
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

/** Signed-in identity is production-only unless both dev opt-ins are set. */
export function shouldIdentifySupportChatCustomer(): boolean {
  if (isDevelopment()) {
    return (
      process.env.ROWBOAT_WWW_PLAIN_CHAT_ENABLED === "1" &&
      process.env.ROWBOAT_WWW_PLAIN_CHAT_IDENTIFY === "1"
    );
  }
  return true;
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
