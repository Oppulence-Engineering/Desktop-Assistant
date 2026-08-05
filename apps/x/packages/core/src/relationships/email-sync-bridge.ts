import type { GmailThreadSnapshot } from "../knowledge/sync_gmail.js";
import { getAccountEmail, setSyncRunStartedHook, setThreadSyncedHook } from "../knowledge/sync_gmail.js";
import type { MailboxAccount } from "../mailbox/types.js";
import { normalizeGmailSnapshot } from "../mailbox/normalize.js";
import { normalizeMailboxAccountId } from "../mailbox/ids.js";
import { updateSenderProfiles, hasPriorContact, senderSignatureTitle } from "../mailbox/sender-profiles.js";
import { getMailboxStore } from "../mailbox/store-fs.js";
import { getTranscriptionConfig } from "../voice/voice.js";
import { enqueueRelationshipEvidence } from "./evidence-outbox.js";
import { emailThreadObservation } from "./email-evidence.js";
import { HybridContactExtractor } from "../mailbox/contact-extractor.js";

/**
 * The bridge from the live Gmail loop to relationship evidence.
 *
 * Deliberately hangs off `sync_gmail.ts`'s existing snapshot build rather than
 * reviving the dormant `MailboxService.onSyncTick`. That method would start a
 * *second* independent traversal of the same mailbox — two cursors, double the
 * quota, and two loops disagreeing about what is new — and it also runs the
 * scheduler, which reaches an LLM draft generator. Wiring it would turn on
 * background reply drafting as a side effect of "enrichment".
 *
 * Everything here is best-effort and never throws into the sync loop: a failure to
 * publish evidence must not stop the mailbox from syncing.
 */

/**
 * Bound on queued email observations.
 *
 * The first launch after this ships can enqueue a whole 7-day lookback at once.
 * Meeting entries are never dropped — they are rarer, larger and irreplaceable —
 * so the cap applies to email only and is enforced by simply declining to enqueue
 * past it, with the drop counted and logged.
 */
const MAX_PENDING_EMAIL = 500;

let pendingEmailEstimate = 0;
let droppedThisRun = 0;

/** Reset the per-run bound. Called at the start of every sync run. */
export function resetEmailEvidenceBudget(): void {
  pendingEmailEstimate = 0;
  if (droppedThisRun > 0) {
    console.warn(
      `[Gmail] skipped ${droppedThisRun} email observation(s) over the pending cap of ${MAX_PENDING_EMAIL}`,
    );
  }
  droppedThisRun = 0;
}

function accountFor(email: string): MailboxAccount {
  return {
    // The canonical id, not a hand-rolled one. Sender profiles and thread ids are
    // both keyed on it, so a fabricated id would file this data under a key the
    // mailbox layer never reads -- two stores of the same thing, and the shared
    // local sender record would be shared with nobody.
    id: normalizeMailboxAccountId({ provider: "gmail", providerAccountId: email }),
    provider: "gmail",
    providerAccountId: email,
    email,
    capabilities: [],
    status: "connected",
  };
}

/**
 * Fold one freshly synced thread into local sender profiles, then publish a
 * metadata-only observation if the user has consented and the thread qualifies.
 */
export async function publishEmailThreadEvidence(args: {
  snapshot: GmailThreadSnapshot;
  accountEmail: string;
}): Promise<void> {
  const config = await getTranscriptionConfig();
  const consent = config.relationships;
  // Sender profiles are local-only bookkeeping and the gate on publishing, so they
  // are maintained whenever any email-derived feature is on.
  if (!consent.emailMetadata && !consent.signatureEnrichment) return;

  const account = accountFor(args.accountEmail.toLowerCase());
  const thread = normalizeGmailSnapshot(account, args.snapshot);
  const selfEmails = new Set([account.email]);
  const store = getMailboxStore();

  await updateSenderProfiles({
    store,
    accountId: account.id,
    selfEmails,
    thread,
  });

  if (!consent.emailMetadata) return;
  if (pendingEmailEstimate >= MAX_PENDING_EMAIL) {
    droppedThisRun += 1;
    return;
  }

  const titles = new Map<string, { title: string; confidence: number }>();
  if (consent.signatureEnrichment) {
    for (const participant of thread.participants) {
      const email = participant.email?.trim().toLowerCase();
      if (!email || selfEmails.has(email)) continue;
      const found = await senderSignatureTitle(store, account.id, email);
      if (found) titles.set(email, found);
    }

    // Only for people the signature parser could not resolve, and only when the
    // user asked for it. An inference must never displace a parsed signature.
    if (consent.modelContactExtraction) {
      const unresolved = thread.participants.filter((participant) => {
        const email = participant.email?.trim().toLowerCase();
        return !!email && !selfEmails.has(email) && !titles.has(email);
      });
      if (unresolved.length > 0) {
        try {
          const extraction = await new HybridContactExtractor().extract({
            messages: thread.messages
              .filter((message) => message.textBody)
              .map((message) => ({
                from: message.from,
                sentAt: new Date(message.sentAt).toISOString(),
                body: message.textBody!,
              })),
            knownParticipants: unresolved,
            extractorVersion: "email-bridge-v1",
          });
          for (const contact of extraction.contacts) {
            if (!contact.title || titles.has(contact.email)) continue;
            titles.set(contact.email, {
              title: contact.title,
              confidence: contact.confidence,
            });
          }
        } catch (err) {
          // An enrichment miss is not a sync failure.
          console.warn("[Gmail] contact extraction failed:", err);
        }
      }
    }
  }

  const observation = emailThreadObservation({
    thread,
    selfEmails,
    sourceAccountId: account.email,
    hasPriorContact: await anyPriorContact(store, account.id, thread, selfEmails),
    titles,
  });
  if (!observation) return;

  pendingEmailEstimate += 1;
  await enqueueRelationshipEvidence(observation);
}

async function anyPriorContact(
  store: ReturnType<typeof getMailboxStore>,
  accountId: string,
  thread: ReturnType<typeof normalizeGmailSnapshot>,
  selfEmails: Set<string>,
): Promise<boolean> {
  for (const participant of thread.participants) {
    const email = participant.email?.trim().toLowerCase();
    if (!email || selfEmails.has(email)) continue;
    if (await hasPriorContact(store, accountId, email)) return true;
  }
  return false;
}

/**
 * Register the evidence observer on the live Gmail loop.
 *
 * Idempotent and safe to call before sign-in: the observer re-reads consent and the
 * connected address on every thread, so nothing is captured from a state the user
 * has not agreed to.
 */
export function initEmailRelationshipEvidence(): void {
  setSyncRunStartedHook(() => resetEmailEvidenceBudget());
  setThreadSyncedHook(async (snapshot) => {
    const accountEmail = await getAccountEmail();
    if (!accountEmail) return;
    await publishEmailThreadEvidence({ snapshot, accountEmail });
  });
}
