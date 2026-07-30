import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { WorkDir } from "../config/config.js";
import { CommitmentSpeaker, type ProposedCommitment } from "./commitments.js";

/**
 * The ledger of confirmed commitments.
 *
 * Two rules, both from RFC 035.
 *
 * **Nothing lands here without a human saying yes.** A proposal the user never confirmed
 * is not a commitment, it is a model's opinion, and the difference matters the moment
 * anything acts on it. `record()` is only reachable from a confirmation.
 *
 * **Every record keeps its evidence.** Session id, segment span and the verbatim quote,
 * so months later "where did this come from?" is answerable by playing the audio rather
 * than by trusting the row. A ledger you cannot audit is a list of assertions.
 *
 * Stored as JSON in the vault rather than pushed to `rowboat-api`: the `Commitment` ent
 * schema exists there with zero write paths or routes, so syncing is a later, opt-in
 * step — and the local record has to be the durable one either way.
 */

export const CommitmentStatus = z.enum(["open", "done", "dropped"]);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const LedgerCommitment = z.object({
  id: z.string(),
  owner: CommitmentSpeaker,
  /** Resolved display name for `them` when the meeting was a named 1:1. */
  owner_label: z.string().optional(),
  text: z.string(),
  due_phrase: z.string().optional(),
  status: CommitmentStatus.default("open"),
  confirmed_at: z.string(),
  /** Everything needed to get back to the words. */
  session_id: z.string(),
  note_path: z.string().optional(),
  meeting_title: z.string().optional(),
  meeting_started: z.string().optional(),
  evidence: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
});
export type LedgerCommitment = z.infer<typeof LedgerCommitment>;

const Ledger = z.object({
  schema: z.literal(1).default(1),
  commitments: z.array(LedgerCommitment).default([]),
});

function ledgerFile(): string {
  // Resolved per call, not at import — `WorkDir` can be reconfigured after load.
  return path.join(WorkDir, "commitments.json");
}

/**
 * Serializes read-modify-write on the ledger.
 *
 * Every mutation here reads the whole file, edits it, and writes it back. Two of those
 * interleaving loses one edit outright — and they interleave easily, because confirming
 * commitments is exactly the kind of thing a user does by clicking three "Keep" buttons
 * in a row. The UI disables the button it is working on, not the others.
 *
 * A promise chain rather than a lock: mutations are rare and fast, and this cannot
 * deadlock or be forgotten at an early return.
 */
let ledgerQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = ledgerQueue.then(operation, operation);
  // Keep the chain alive even when an operation rejects, or one failure would wedge
  // every later write.
  ledgerQueue = result.catch(() => undefined);
  return result;
}

export async function readLedger(): Promise<LedgerCommitment[]> {
  try {
    const parsed = Ledger.safeParse(JSON.parse(await fs.readFile(ledgerFile(), "utf8")));
    return parsed.success ? parsed.data.commitments : [];
  } catch {
    return [];
  }
}

async function writeLedger(commitments: LedgerCommitment[]): Promise<void> {
  const file = ledgerFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ schema: 1, commitments }, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/**
 * A stable id from the meeting and the span it came from.
 *
 * Content-addressed rather than random so confirming the same proposal twice — a retry,
 * a re-transcription, two windows open — is idempotent instead of producing duplicates.
 */
export function commitmentId(sessionId: string, startMs: number, endMs: number): string {
  return `${sessionId}:${startMs}-${endMs}`;
}

export interface ConfirmArgs {
  proposal: ProposedCommitment;
  sessionId: string;
  notePath?: string;
  meetingTitle?: string;
  meetingStarted?: string;
  /** Display name for `them`, when the counterparty was resolved. */
  counterpartyLabel?: string;
  /** Injected so tests can pass a fixed timestamp. */
  now?: Date;
}

/** Confirm one proposal into the ledger. Idempotent on the same span. */
export function confirmCommitment(args: ConfirmArgs): Promise<LedgerCommitment> {
  return serialized(() => confirmCommitmentUnsafe(args));
}

async function confirmCommitmentUnsafe(args: ConfirmArgs): Promise<LedgerCommitment> {
  const { proposal } = args;
  const entry: LedgerCommitment = {
    id: commitmentId(args.sessionId, proposal.start_ms, proposal.end_ms),
    owner: proposal.owner,
    ...(proposal.owner === "them" && args.counterpartyLabel
      ? { owner_label: args.counterpartyLabel }
      : {}),
    text: proposal.text,
    ...(proposal.due_phrase ? { due_phrase: proposal.due_phrase } : {}),
    status: "open",
    confirmed_at: (args.now ?? new Date()).toISOString(),
    session_id: args.sessionId,
    ...(args.notePath ? { note_path: args.notePath } : {}),
    ...(args.meetingTitle ? { meeting_title: args.meetingTitle } : {}),
    ...(args.meetingStarted ? { meeting_started: args.meetingStarted } : {}),
    evidence: proposal.evidence,
    start_ms: proposal.start_ms,
    end_ms: proposal.end_ms,
  };

  const existing = await readLedger();
  const index = existing.findIndex((row) => row.id === entry.id);
  if (index >= 0) {
    // Keep the original confirmation time: re-confirming is not a new commitment.
    existing[index] = { ...entry, confirmed_at: existing[index].confirmed_at };
  } else {
    existing.push(entry);
  }
  await writeLedger(existing);
  return entry;
}

/** Mark a commitment done or dropped. Returns false when it is not in the ledger. */
export function setCommitmentStatus(id: string, status: CommitmentStatus): Promise<boolean> {
  return serialized(() => setCommitmentStatusUnsafe(id, status));
}

async function setCommitmentStatusUnsafe(id: string, status: CommitmentStatus): Promise<boolean> {
  const existing = await readLedger();
  const row = existing.find((entry) => entry.id === id);
  if (!row) return false;
  row.status = status;
  await writeLedger(existing);
  return true;
}
