import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  RelationshipObservationIngestResult,
  RelationshipObservationInput,
} from "@x/shared/dist/relationships.js";
import { RelationshipEvidenceOutbox } from "./evidence-outbox.js";
import { RelationshipApiError } from "./client.js";

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relationship-evidence-outbox-"));
  dirs.push(dir);
  return path.join(dir, "outbox.json");
}

function observation(id: string): RelationshipObservationInput {
  return {
    displayName: "Acme",
    primaryEmail: "avery@acme.example",
    accountDomain: "acme.example",
    source: "meeting",
    externalId: id,
    sourceVersion: "1",
    eventType: "meeting_transcribed",
    occurredAt: "2026-07-31T12:00:00.000Z",
    normalizedFacts: { session_id: id },
  };
}

/** Same shape, different source — gmail maps to a different workspace capability. */
function gmailObservation(id: string): RelationshipObservationInput {
  return {
    ...observation(id),
    source: "gmail",
    eventType: "email_exchanged",
    normalizedFacts: { thread_id: id },
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RelationshipEvidenceOutbox", () => {
  it("deduplicates stable evidence identities and removes accepted batches", async () => {
    const batches: RelationshipObservationInput[][] = [];
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async (items) => {
      batches.push(items);
    });

    await outbox.enqueue(observation("meeting-1"));
    await outbox.enqueue(observation("meeting-1"));
    await outbox.enqueue(observation("meeting-2"));
    expect(await outbox.flush()).toMatchObject({ sent: 2, pending: 0, quarantined: 0 });
    expect(batches).toHaveLength(1);
    expect(batches[0].map((item) => item.externalId)).toEqual(["meeting-1", "meeting-2"]);
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 0, quarantined: 0 });
  });

  it("keeps evidence for a later retry when the cloud is unavailable", async () => {
    let available = false;
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async () => {
      if (!available) throw new Error("offline");
    });

    await outbox.enqueue(observation("meeting-1"));
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 1, error: "offline" });
    available = true;
    expect(await outbox.flush()).toMatchObject({ sent: 1, pending: 0, quarantined: 0 });
  });

  it("stores queued transcript evidence with owner-only permissions", async () => {
    const file = await tempFile();
    const outbox = new RelationshipEvidenceOutbox(file, async () => {});
    await outbox.enqueue(observation("meeting-private"));

    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("returns the accepted shared relationship version to the publishing client", async () => {
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async (items) => ({
      results: items.map((item): RelationshipObservationIngestResult => ({
        observation: {
          id: "observation-1",
          source: item.source,
          sourceAccountId: item.sourceAccountId,
          externalId: item.externalId,
          sourceVersion: item.sourceVersion,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
          receivedAt: item.receivedAt || item.occurredAt,
          summary: item.summary,
          normalizedFacts: item.normalizedFacts,
          contentHash: "sha256:accepted",
        },
        relationship: {
          id: "relationship-1",
          kind: "company",
          displayName: "Acme",
          status: "active",
          lifecycle: "evaluation",
          engagement: "unknown",
          sentiment: "unknown",
          health: "unknown",
          stateVersion: 7,
          stateHash: "sha256:state-v7",
          projectorVersion: 2,
          risks: [],
          milestones: [],
        },
        duplicate: false,
      })),
    }));

    await outbox.enqueue(observation("meeting-confirmed"));
    const result = await outbox.flush();
    expect(result).toMatchObject({
      sent: 1,
      pending: 0,
      confirmations: [
        {
          relationshipId: "relationship-1",
          stateVersion: 7,
          stateHash: "sha256:state-v7",
        },
      ],
    });
  });

  it("drains more than the API batch limit without dropping ordering", async () => {
    const sizes: number[] = [];
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async (items) => {
      sizes.push(items.length);
    });
    for (let index = 0; index < 205; index++) {
      await outbox.enqueue(observation(`meeting-${String(index).padStart(3, "0")}`));
    }

    expect(await outbox.flush()).toMatchObject({ sent: 205, pending: 0, quarantined: 0 });
    expect(sizes).toEqual([100, 100, 5]);
  });

  it("does not overwrite pending evidence when the outbox is malformed", async () => {
    const file = await tempFile();
    const malformed = '{"schema":1,"entries":[';
    await fs.writeFile(file, malformed, "utf8");
    const outbox = new RelationshipEvidenceOutbox(file, async () => {});

    await expect(outbox.enqueue(observation("meeting-1"))).rejects.toThrow(
      /relationship evidence outbox|JSON/,
    );
    expect(await fs.readFile(file, "utf8")).toBe(malformed);
  });

  /**
   * The API rejects an entire batch when any one observation's source lacks a
   * workspace capability, and gmail and meeting sit on different capabilities.
   * Before per-source partitioning, one un-entitled email observation blocked
   * every meeting transcript behind it — forever, and silently.
   */
  it("does not let a rejected source block a healthy one", async () => {
    const seen: string[][] = [];
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async (items) => {
      seen.push(items.map((item) => item.externalId));
      if (items.some((item) => item.source === "gmail")) {
        throw new RelationshipApiError(403, "source capability disabled: source_google");
      }
    });

    await outbox.enqueue(gmailObservation("thread-1"));
    await outbox.enqueue(observation("meeting-1"));
    await outbox.enqueue(gmailObservation("thread-2"));
    await outbox.enqueue(observation("meeting-2"));

    const result = await outbox.flush();

    expect(result.sent).toBe(2);
    expect(result.bySource.meeting).toEqual({ sent: 2, pending: 0 });
    expect(result.bySource.gmail.sent).toBe(0);
    expect(result.bySource.gmail.error).toMatch(/source_google/);
    // 403 is permanent: held immediately rather than retried five times.
    expect(result.quarantined).toBe(2);
    expect(result.pending).toBe(0);

    // No batch ever mixed the two sources.
    for (const batch of seen) {
      const sources = new Set(batch.map((id) => (id.startsWith("thread") ? "gmail" : "meeting")));
      expect(sources.size).toBe(1);
    }

    // A later flush neither retries the held entries nor loses them.
    seen.length = 0;
    const second = await outbox.flush();
    expect(seen).toEqual([]);
    expect(second).toMatchObject({ sent: 0, pending: 0, quarantined: 2 });
  });

  it("quarantines after repeated transient failures instead of retrying forever", async () => {
    let attempts = 0;
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async () => {
      attempts += 1;
      throw new Error("offline");
    });
    await outbox.enqueue(observation("meeting-1"));

    for (let flushes = 0; flushes < 4; flushes++) {
      const result = await outbox.flush();
      expect(result).toMatchObject({ sent: 0, pending: 1, quarantined: 0 });
    }
    // The fifth attempt trips the limit.
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 0, quarantined: 1 });
    expect(attempts).toBe(5);

    // Held, not retried, not dropped.
    expect(await outbox.flush()).toMatchObject({ quarantined: 1 });
    expect(attempts).toBe(5);
  });

  it("reads an outbox written before quarantine fields existed", async () => {
    const file = await tempFile();
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            key: "meeting:legacy-1:1",
            observation: observation("legacy-1"),
            queuedAt: "2026-07-31T12:00:00.000Z",
            attempts: 2,
          },
        ],
      }),
      "utf8",
    );

    const sent: string[] = [];
    const outbox = new RelationshipEvidenceOutbox(file, async (items) => {
      sent.push(...items.map((item) => item.externalId));
    });

    expect(await outbox.flush()).toMatchObject({ sent: 1, pending: 0, quarantined: 0 });
    expect(sent).toEqual(["legacy-1"]);
  });
});
