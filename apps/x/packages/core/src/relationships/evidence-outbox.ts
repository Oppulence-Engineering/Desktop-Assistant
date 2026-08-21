import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type {
  RelationshipObservationIngestResult,
  RelationshipObservationInput,
} from "@x/shared/relationships";
import { RelationshipObservationInputSchema } from "@x/shared/relationships";
import { WorkDir } from "../config/config.js";
import { RelationshipApiError, ingestRelationshipObservations } from "./client.js";

/**
 * Durable bridge between local meeting evidence and shared relationship state.
 *
 * A completed transcript or confirmed commitment is first appended here, then sent.
 * Network or authentication failures therefore never roll back the local transcript or
 * ledger and are retried at the next launch/config refresh. The API's
 * source/externalId/sourceVersion key makes replays idempotent.
 */

/**
 * Attempts after which an entry is held rather than retried forever. A transient
 * outage recovers well inside this; anything that does not is a payload the server
 * will keep refusing.
 */
const MAX_ATTEMPTS = 5;

/** The API accepts at most 100 observations atomically. */
const MAX_BATCH = 100;

const OutboxEntry = z.object({
  key: z.string(),
  observation: RelationshipObservationInputSchema,
  queuedAt: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().optional(),
  lastError: z.string().optional(),
  /**
   * Held: never sent again, and never deleted. Evidence the server refuses is
   * still evidence the user produced, so it stays inspectable rather than
   * vanishing or blocking the queue behind it.
   */
  quarantinedAt: z.string().optional(),
  quarantineReason: z.string().optional(),
});
type OutboxEntry = z.infer<typeof OutboxEntry>;

// Every added field is optional, and `schema` deliberately stays at 1: read()
// throws on a parse failure by design, so a version bump would turn every
// existing outbox file into a hard error at launch.
const OutboxFile = z.object({
  schema: z.literal(1).default(1),
  entries: z.array(OutboxEntry).default([]),
});

export interface RelationshipEvidenceFlushResult {
  sent: number;
  /** Entries still eligible to send. Excludes quarantined. */
  pending: number;
  /** Entries held permanently. Never retried, never dropped. */
  quarantined: number;
  /** First error seen this flush, across all sources. */
  error?: string;
  /** Per-source outcome, so one blocked source is visibly attributable. */
  bySource: Record<string, { sent: number; pending: number; error?: string }>;
  confirmations?: Array<{
    key: string;
    relationshipId: string;
    stateVersion: number;
    stateHash?: string;
  }>;
}

type SendBatch = (
  observations: RelationshipObservationInput[],
) => Promise<{ results: RelationshipObservationIngestResult[] } | void>;

export function relationshipObservationKey(observation: RelationshipObservationInput): string {
  return `${observation.source}:${observation.externalId}:${observation.sourceVersion}`;
}

export class RelationshipEvidenceOutbox {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly send: SendBatch,
  ) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<OutboxEntry[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = OutboxFile.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(`invalid relationship evidence outbox: ${parsed.error.message}`);
      }
      return parsed.data.entries;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      // Never turn corruption or a transient read error into an empty queue. The next
      // enqueue would overwrite pending transcript evidence and make the failure look
      // like a successful drain.
      throw cause;
    }
  }

  private async write(entries: OutboxEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ schema: 1, entries }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, this.file);
  }

  enqueue(observation: RelationshipObservationInput): Promise<void> {
    return this.serialized(async () => {
      const valid = RelationshipObservationInputSchema.parse(observation);
      const entries = await this.read();
      const key = relationshipObservationKey(valid);
      if (entries.some((entry) => entry.key === key)) return;
      entries.push({
        key,
        observation: valid,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      });
      await this.write(entries);
    });
  }

  /**
   * Send everything queued, one source at a time.
   *
   * Batches are partitioned by `observation.source` because the API rejects an
   * *entire* batch when any single observation's source lacks a workspace
   * capability, and the sources do not share one: gmail/calendar map to the Google
   * source capability while meeting/voice_note/desktop_note map to the desktop
   * publish capability. A mixed batch therefore lets one un-entitled email
   * observation permanently block every meeting transcript queued behind it —
   * retried at every launch, silently, forever.
   */
  flush(): Promise<RelationshipEvidenceFlushResult> {
    return this.serialized(async () => {
      let entries = await this.read();

      const sendable = (list: OutboxEntry[], source?: string) =>
        list.filter(
          (entry) =>
            !entry.quarantinedAt &&
            (source === undefined || entry.observation.source === source),
        );

      const summarize = (
        sent: number,
        bySource: RelationshipEvidenceFlushResult["bySource"],
        error: string | undefined,
        confirmations: NonNullable<RelationshipEvidenceFlushResult["confirmations"]>,
      ): RelationshipEvidenceFlushResult => ({
        sent,
        pending: sendable(entries).length,
        quarantined: entries.length - sendable(entries).length,
        bySource,
        ...(error ? { error } : {}),
        ...(confirmations.length > 0 ? { confirmations } : {}),
      });

      if (sendable(entries).length === 0) return summarize(0, {}, undefined, []);

      const sources = [...new Set(sendable(entries).map((e) => e.observation.source))].sort();
      const confirmations: NonNullable<RelationshipEvidenceFlushResult["confirmations"]> = [];
      const bySource: RelationshipEvidenceFlushResult["bySource"] = {};
      let sent = 0;
      let firstError: string | undefined;

      for (const source of sources) {
        let groupSent = 0;
        let groupError: string | undefined;

        for (;;) {
          // Persist after every accepted batch: a process exit midway may replay
          // the current batch, but never loses it.
          const batch = sendable(entries, source).slice(0, MAX_BATCH);
          if (batch.length === 0) break;
          try {
            const response = await this.send(batch.map((entry) => entry.observation));
            for (const accepted of response?.results ?? []) {
              confirmations.push({
                key: relationshipObservationKey(accepted.observation),
                relationshipId: accepted.relationship.id,
                stateVersion: accepted.relationship.stateVersion,
                ...(accepted.relationship.stateHash
                  ? { stateHash: accepted.relationship.stateHash }
                  : {}),
              });
            }
            const sentKeys = new Set(batch.map((entry) => entry.key));
            entries = entries.filter((entry) => !sentKeys.has(entry.key));
            groupSent += batch.length;
            await this.write(entries);
          } catch (cause) {
            const error = cause instanceof Error ? cause.message : String(cause);
            const apiError = cause instanceof RelationshipApiError ? cause : undefined;
            const permanent = apiError?.permanent ?? false;
            const attempted = new Set(batch.map((entry) => entry.key));
            const now = new Date().toISOString();
            entries = entries.map((entry) => {
              if (!attempted.has(entry.key)) return entry;
              const attempts = entry.attempts + 1;
              const next: OutboxEntry = {
                ...entry,
                attempts,
                lastAttemptAt: now,
                lastError: error,
              };
              if (!permanent && attempts < MAX_ATTEMPTS) return next;
              return {
                ...next,
                quarantinedAt: now,
                quarantineReason: permanent
                  ? `rejected (${apiError?.status}): ${error}`
                  : `${attempts} failed attempts: ${error}`,
              };
            });
            await this.write(entries);
            groupError = error;
            firstError ??= error;
            // Stop this source, then carry on with the next one. This is the
            // whole point of partitioning.
            break;
          }
        }

        sent += groupSent;
        bySource[source] = {
          sent: groupSent,
          pending: sendable(entries, source).length,
          ...(groupError ? { error: groupError } : {}),
        };
      }

      return summarize(sent, bySource, firstError, confirmations);
    });
  }
}

const relationshipEvidenceOutbox = new RelationshipEvidenceOutbox(
  path.join(WorkDir, "relationship-evidence-outbox.json"),
  ingestRelationshipObservations,
);

export const enqueueRelationshipEvidence = (observation: RelationshipObservationInput) =>
  relationshipEvidenceOutbox.enqueue(observation);

export const flushRelationshipEvidence = () => relationshipEvidenceOutbox.flush();
