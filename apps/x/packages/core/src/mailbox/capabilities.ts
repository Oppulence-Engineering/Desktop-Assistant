/**
 * Capability model.
 *
 * Capabilities describe what an account is allowed to do, independent of which
 * provider backs it. Features check capabilities, never provider type or raw
 * OAuth scopes. Adapters translate their native scope set into this vocabulary.
 */

import type { MailboxCapability, MailboxProviderKind } from "./types.js";

/** Gmail OAuth scopes mapped to the capabilities they grant. */
const GMAIL_SCOPE_CAPABILITIES: Record<string, MailboxCapability[]> = {
  "https://www.googleapis.com/auth/gmail.readonly": ["mail.read", "mail.attachments"],
  "https://www.googleapis.com/auth/gmail.modify": [
    "mail.read",
    "mail.modify",
    "mail.send",
    "mail.draft",
    "mail.watch",
    "mail.attachments",
  ],
  "https://www.googleapis.com/auth/gmail.send": ["mail.send"],
  "https://www.googleapis.com/auth/gmail.compose": ["mail.draft", "mail.send"],
  "https://www.googleapis.com/auth/gmail.labels": ["mail.modify"],
  "https://www.googleapis.com/auth/calendar.readonly": ["calendar.read"],
  "https://www.googleapis.com/auth/calendar.events.readonly": ["calendar.read"],
  "https://www.googleapis.com/auth/drive.file": ["drive.write"],
};

/** Microsoft Graph scopes mapped to capabilities, for the future Outlook adapter. */
const OUTLOOK_SCOPE_CAPABILITIES: Record<string, MailboxCapability[]> = {
  "Mail.Read": ["mail.read", "mail.attachments"],
  "Mail.ReadWrite": ["mail.read", "mail.modify", "mail.draft", "mail.attachments"],
  "Mail.Send": ["mail.send"],
  "Calendars.Read": ["calendar.read"],
  "Files.ReadWrite": ["drive.write"],
};

/**
 * Derives the capability set from a provider's granted scopes. Unknown scopes
 * are ignored rather than rejected, so a provider adding a new scope never
 * breaks capability derivation.
 */
export function capabilitiesFromScopes(
  provider: MailboxProviderKind,
  scopes: string[],
): MailboxCapability[] {
  const table = provider === "gmail" ? GMAIL_SCOPE_CAPABILITIES : OUTLOOK_SCOPE_CAPABILITIES;
  const set = new Set<MailboxCapability>();
  for (const scope of scopes) {
    for (const capability of table[scope] ?? []) {
      set.add(capability);
    }
  }
  return [...set];
}

export function hasCapability(
  capabilities: MailboxCapability[],
  capability: MailboxCapability,
): boolean {
  return capabilities.includes(capability);
}

export function requireCapability(
  capabilities: MailboxCapability[],
  capability: MailboxCapability,
): void {
  if (!hasCapability(capabilities, capability)) {
    throw new Error(`Mailbox account is missing required capability: ${capability}`);
  }
}

/** The capabilities each action type needs before it can run. */
export const ACTION_REQUIRED_CAPABILITIES: Record<string, MailboxCapability | null> = {
  archive: "mail.modify",
  mark_read: "mail.modify",
  star: "mail.modify",
  label: "mail.modify",
  move: "mail.modify",
  mark_spam: "mail.modify",
  trash: "mail.modify",
  draft_reply: "mail.draft",
  reply: "mail.send",
  send_email: "mail.send",
  forward: "mail.send",
  digest: null,
  delay: null,
  webhook: null,
  notify_channel: "channels.notify",
};
