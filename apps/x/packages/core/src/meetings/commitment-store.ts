import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { ProposedCommitment } from "./commitments.js";
import { COMMITMENTS_JSON } from "./session.js";

/**
 * Unconfirmed proposals, stored beside the transcript they came from.
 *
 * On disk rather than in memory so they survive a quit — the whole point is that you
 * look at them after the meeting, which may be after you closed the app. In the session
 * directory rather than a global list so deleting a recording takes its proposals with
 * it, without a second cleanup path to forget.
 */

const StoredProposals = z.object({
  schema: z.literal(1).default(1),
  proposals: z.array(ProposedCommitment).default([]),
  /** Display name for `them`, when the meeting was a named 1:1. */
  counterparty: z.string().optional(),
  notePath: z.string().optional(),
  meetingTitle: z.string().optional(),
  meetingStarted: z.string().optional(),
});
export type StoredProposals = z.infer<typeof StoredProposals>;

export async function readCommitmentProposals(dir: string): Promise<StoredProposals | null> {
  try {
    const raw = await fs.readFile(path.join(dir, COMMITMENTS_JSON), "utf8");
    const parsed = StoredProposals.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Absent means extraction has not run — which is different from "none found", and
    // the caller can tell the two apart because that case writes an empty list.
    return null;
  }
}

export async function writeCommitmentProposals(
  dir: string,
  value: Omit<StoredProposals, "schema">,
): Promise<void> {
  const file = path.join(dir, COMMITMENTS_JSON);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ schema: 1, ...value }, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/**
 * Serializes read-modify-write per session directory, for the same reason the ledger
 * does: dismissing three proposals in a row is one click each, and two overlapping
 * rewrites would resurrect a dismissed one.
 */
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(dir: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(dir) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(
    dir,
    result.catch(() => undefined),
  );
  return result;
}

/** Drop one proposal, by the span that identifies it. */
export function removeCommitmentProposal(
  dir: string,
  startMs: number,
  endMs: number,
): Promise<boolean> {
  return serialized(dir, () => removeCommitmentProposalUnsafe(dir, startMs, endMs));
}

async function removeCommitmentProposalUnsafe(
  dir: string,
  startMs: number,
  endMs: number,
): Promise<boolean> {
  const stored = await readCommitmentProposals(dir);
  if (!stored) return false;
  const remaining = stored.proposals.filter(
    (item) => !(item.start_ms === startMs && item.end_ms === endMs),
  );
  if (remaining.length === stored.proposals.length) return false;
  await writeCommitmentProposals(dir, { ...stored, proposals: remaining });
  return true;
}
