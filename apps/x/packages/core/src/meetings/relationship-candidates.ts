import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { MeetingRoster } from "./roster.js";

/**
 * The unanswered question a multi-organization meeting leaves behind.
 *
 * When an invite spans two organizations there is no honest way to infer which
 * account the meeting belongs to — a partner call, a customer-plus-integrator call
 * and a candidate-plus-recruiter call are identical on the invite. Rather than guess
 * and bind a durable anchor to the wrong account, the candidates are recorded beside
 * the recording and the user is asked.
 *
 * Nothing here leaves the device. It exists so the question survives a restart.
 */

export const RELATIONSHIP_CANDIDATES_FILE = "relationship-candidates.json";

export const RelationshipCandidate = z.object({
  accountDomain: z.string(),
  displayName: z.string(),
  participantCount: z.number().int().positive(),
  participants: z.array(
    z.object({ displayName: z.string(), email: z.string().optional() }),
  ),
});
export type RelationshipCandidate = z.infer<typeof RelationshipCandidate>;

export const RelationshipCandidates = z.object({
  schema: z.literal(1).default(1),
  recordedAt: z.string(),
  /** Set once the user picks an account, so the prompt stops reappearing. */
  resolvedAt: z.string().optional(),
  candidates: z.array(RelationshipCandidate).default([]),
});
export type RelationshipCandidates = z.infer<typeof RelationshipCandidates>;

/**
 * Record the accounts a meeting could belong to. Never overwrites an answer the
 * user already gave.
 */
export async function writeRelationshipCandidates(
  sessionDir: string,
  domains: { domain: string; count: number }[],
  roster: MeetingRoster,
  now: () => Date = () => new Date(),
): Promise<void> {
  const existing = await readRelationshipCandidates(sessionDir);
  if (existing?.resolvedAt) return;

  const payload: RelationshipCandidates = {
    schema: 1,
    recordedAt: now().toISOString(),
    candidates: domains.map(({ domain, count }) => ({
      accountDomain: domain,
      displayName: domain,
      participantCount: count,
      participants: roster.external
        .filter((participant) => participant.organizationDomain === domain)
        .map((participant) => ({
          displayName: participant.displayName,
          ...(participant.email ? { email: participant.email } : {}),
        })),
    })),
  };

  const target = path.join(sessionDir, RELATIONSHIP_CANDIDATES_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

export async function readRelationshipCandidates(
  sessionDir: string,
): Promise<RelationshipCandidates | null> {
  try {
    const raw = await fs.readFile(
      path.join(sessionDir, RELATIONSHIP_CANDIDATES_FILE),
      "utf8",
    );
    const parsed = RelationshipCandidates.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Mark the question answered so the prompt does not come back. */
export async function resolveRelationshipCandidates(
  sessionDir: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const existing = await readRelationshipCandidates(sessionDir);
  if (!existing || existing.resolvedAt) return;
  const target = path.join(sessionDir, RELATIONSHIP_CANDIDATES_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify({ ...existing, resolvedAt: now().toISOString() }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.rename(tmp, target);
}
