import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RelationshipObservationInput } from "@x/shared/dist/relationships.js";
import { RelationshipEvidenceOutbox } from "./evidence-outbox.js";

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
    expect(await outbox.flush()).toEqual({ sent: 2, pending: 0 });
    expect(batches).toHaveLength(1);
    expect(batches[0].map((item) => item.externalId)).toEqual(["meeting-1", "meeting-2"]);
    expect(await outbox.flush()).toEqual({ sent: 0, pending: 0 });
  });

  it("keeps evidence for a later retry when the cloud is unavailable", async () => {
    let available = false;
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async () => {
      if (!available) throw new Error("offline");
    });

    await outbox.enqueue(observation("meeting-1"));
    expect(await outbox.flush()).toMatchObject({ sent: 0, pending: 1, error: "offline" });
    available = true;
    expect(await outbox.flush()).toEqual({ sent: 1, pending: 0 });
  });

  it("drains more than the API batch limit without dropping ordering", async () => {
    const sizes: number[] = [];
    const outbox = new RelationshipEvidenceOutbox(await tempFile(), async (items) => {
      sizes.push(items.length);
    });
    for (let index = 0; index < 205; index++) {
      await outbox.enqueue(observation(`meeting-${String(index).padStart(3, "0")}`));
    }

    expect(await outbox.flush()).toEqual({ sent: 205, pending: 0 });
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
});
