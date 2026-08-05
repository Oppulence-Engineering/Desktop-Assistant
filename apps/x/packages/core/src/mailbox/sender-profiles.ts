import { emailDomain } from "@x/shared/dist/email-domain.js";
import type { MailboxStore } from "./store.js";
import type { MailboxSenderProfile } from "./store.js";
import type { MailboxThread } from "./types.js";
import { parseEmailSignature, corroboratedConfidence } from "./signature.js";

/**
 * The local, per-sender record.
 *
 * `MailboxSenderProfile` has existed with full CRUD and persistence and no producer
 * at all. It earns its place now for three reasons:
 *
 *   1. It is the only place a *local* interaction count can live. Answering "have we
 *      talked before?" by re-walking every cached thread on a 30-second tick is not
 *      viable, and that question gates whether a thread is publishable at all.
 *   2. It is the right home for what must NOT be published — phone numbers,
 *      unsubscribe URLs, per-sender counters. Having a local home is what makes it
 *      easy to say no to putting them in an observation.
 *   3. Newsletter and cold-email classification belongs beside the counts that
 *      inform it.
 *
 * Nothing here leaves the device.
 */

/** Local parts that are systems rather than people. */
const MACHINE_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notifications?|alerts?|automated|system)\b/i;

export interface SenderProfileUpdate {
  store: MailboxStore;
  accountId: string;
  selfEmails: Set<string>;
  thread: MailboxThread;
  /** Known organization per domain, from the knowledge index. Main process only. */
  knownOrganizations?: Map<string, string>;
  now?: () => number;
}

function normalize(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

export function isMachineSender(email: string): boolean {
  const at = email.indexOf("@");
  return MACHINE_LOCAL_PART.test(at > 0 ? email.slice(0, at) : email);
}

/**
 * Fold one synced thread into the per-sender profiles it touches.
 *
 * `hasPriorContact` is the load-bearing field: it becomes true the moment the user
 * sends anything to that address. "You replied to them, or you had talked before" is
 * the honest definition of a relationship, and it is what keeps a mailbox full of
 * newsletters from becoming a graph full of contacts.
 */
export async function updateSenderProfiles(
  input: SenderProfileUpdate,
): Promise<MailboxSenderProfile[]> {
  const now = input.now?.() ?? Date.now();
  const touched = new Map<string, MailboxSenderProfile>();

  // Did the user ever participate? One outbound message makes every counterparty
  // on this thread a prior contact.
  const userSent = input.thread.messages.some((message) =>
    input.selfEmails.has(normalize(message.from.email) ?? ""),
  );

  for (const message of input.thread.messages) {
    const email = normalize(message.from.email);
    if (!email || input.selfEmails.has(email)) continue;

    const existing = touched.get(email) ?? (await input.store.getSenderProfile(input.accountId, email));
    const profile: MailboxSenderProfile = existing
      ? { ...existing }
      : {
          accountId: input.accountId,
          email,
          domain: emailDomain(email) ?? "",
          messageCount: 0,
          firstSeenAt: message.sentAt || now,
          lastSeenAt: message.sentAt || now,
          hasPriorContact: false,
          isNewsletter: false,
          isColdEmail: true,
        };

    profile.messageCount += 1;
    profile.firstSeenAt = Math.min(profile.firstSeenAt, message.sentAt || now);
    profile.lastSeenAt = Math.max(profile.lastSeenAt, message.sentAt || now);
    if (message.from.name?.trim()) profile.displayName = message.from.name.trim();
    if (userSent) profile.hasPriorContact = true;
    // Cold means "never engaged". Engagement is the only thing that clears it.
    profile.isColdEmail = !profile.hasPriorContact;
    if (isMachineSender(email)) profile.isNewsletter = true;

    const signature = message.textBody
      ? parseEmailSignature({
          body: message.textBody,
          from: message.from,
          ...(input.knownOrganizations?.get(profile.domain)
            ? { knownOrganization: input.knownOrganizations.get(profile.domain)! }
            : {}),
        })
      : null;
    if (signature) {
      const seenInThreads = (profile.signature?.seenInThreads ?? 0) + 1;
      profile.signature = {
        ...(signature.title ? { title: signature.title } : {}),
        ...(signature.organization ? { organization: signature.organization } : {}),
        // Local only. Never published.
        ...(signature.phone ? { phone: signature.phone } : {}),
        confidence: corroboratedConfidence(seenInThreads),
        seenInThreads,
        updatedAt: now,
      };
    }

    touched.set(email, profile);
  }

  const profiles = [...touched.values()];
  for (const profile of profiles) {
    await input.store.upsertSenderProfile(profile);
  }
  return profiles;
}

/**
 * Answers "have we ever engaged with this person" without re-reading the mailbox.
 * The gate on whether an inbound-only thread is publishable at all.
 */
export async function hasPriorContact(
  store: MailboxStore,
  accountId: string,
  email: string,
): Promise<boolean> {
  const normalized = normalize(email);
  if (!normalized) return false;
  const profile = await store.getSenderProfile(accountId, normalized);
  return profile?.hasPriorContact === true;
}

/** The signature-derived title for a sender, when one has been observed. */
export async function senderSignatureTitle(
  store: MailboxStore,
  accountId: string,
  email: string,
): Promise<{ title: string; confidence: number } | null> {
  const normalized = normalize(email);
  if (!normalized) return null;
  const profile = await store.getSenderProfile(accountId, normalized);
  const title = profile?.signature?.title;
  if (!title) return null;
  return { title, confidence: profile!.signature!.confidence };
}
