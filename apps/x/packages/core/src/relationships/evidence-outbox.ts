import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type {
  RelationshipObservationIngestResult,
  RelationshipObservationInput,
} from "@x/shared/dist/relationships.js";
import { RelationshipObservationInputSchema } from "@x/shared/dist/relationships.js";
import { WorkDir } from "../config/config.js";
import { ingestRelationshipObservations } from "./client.js";

/**
 * Durable bridge between local meeting evidence and shared relationship state.
 *
 * A completed transcript or confirmed commitment is first appended here, then sent.
 * Network or authentication failures therefore never roll back the local transcript or
 * ledger and are retried at the next launch/config refresh. The API's
 * source/externalId/sourceVersion key makes replays idempotent.
 */

const OutboxEntry = z.object({
  key: z.string(),
  observation: RelationshipObservationInputSchema,
  queuedAt: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().optional(),
  lastError: z.string().optional(),
});
type OutboxEntry = z.infer<typeof OutboxEntry>;

const OutboxFile = z.object({
  schema: z.literal(1).default(1),
  entries: z.array(OutboxEntry).default([]),
});

export interface RelationshipEvidenceFlushResult {
  sent: number;
  pending: number;
  error?: string;
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

  flush(): Promise<RelationshipEvidenceFlushResult> {
    return this.serialized(async () => {
      let entries = await this.read();
      if (entries.length === 0) return { sent: 0, pending: 0 };

      let sent = 0;
      const confirmations: NonNullable<RelationshipEvidenceFlushResult["confirmations"]> = [];
      while (entries.length > 0) {
        // The API accepts at most 100 atomically. Persist after every accepted batch:
        // a process exit midway may replay the current batch, but never loses it.
        const batch = entries.slice(0, 100);
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
          sent += batch.length;
          await this.write(entries);
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          const attempted = new Set(batch.map((entry) => entry.key));
          const now = new Date().toISOString();
          entries = entries.map((entry) =>
            attempted.has(entry.key)
              ? {
                  ...entry,
                  attempts: entry.attempts + 1,
                  lastAttemptAt: now,
                  lastError: error,
                }
              : entry,
          );
          await this.write(entries);
          return {
            sent,
            pending: entries.length,
            error,
            ...(confirmations.length > 0 ? { confirmations } : {}),
          };
        }
      }
      return {
        sent,
        pending: 0,
        ...(confirmations.length > 0 ? { confirmations } : {}),
      };
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
