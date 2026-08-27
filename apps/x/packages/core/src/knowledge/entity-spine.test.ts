import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { DEFAULT_ENTITY_CONFIG, ensureEntityConfig } from "./entity-config.js";
import { ensureEntityIdentity, mintEntityId, readEntityIdentity } from "./entity-identity.js";
import { lookupEntities } from "./entity-lookup.js";
import { registerEntityReadAdapter, registerEntityRefReadAdapter } from "./entity-resolver.js";
import {
  buildEntityProjection,
  createEntitySpineClient,
  enqueueEntityProjection,
  flushEntityProjectionOutbox,
  getEntitySpineHealth,
  resumeEntitySpineSync,
  syncEntityNotes,
} from "./entity-spine.js";

const roots: string[] = [];
async function fixture(): Promise<{ root: string; note: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "entity-spine-"));
  roots.push(root);
  const note = path.join(root, "knowledge", "Organizations", "Acme.md");
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  await fs.writeFile(note, "# Acme\n\nPRIVATE NOTE BODY secret@example.com\n");
  await ensureEntityIdentity(note, path.join(root, "knowledge"));
  return { root, note };
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))),
);

describe("entity spine desktop integration", () => {
  it("creates privacy-safe disabled-by-default config", async () => {
    const { root } = await fixture();
    expect(await ensureEntityConfig(root)).toEqual(DEFAULT_ENTITY_CONFIG);
  });

  it("durably keeps an offline projection and adopts the server canonical id over real HTTP", async () => {
    const { root, note } = await fixture();
    const local = await readEntityIdentity(note, path.join(root, "knowledge"));
    await fs.writeFile(
      path.join(root, "config", "entity.json"),
      JSON.stringify({
        sharedSpine: true,
        projectionFields: [
          "id",
          "kind",
          "displayName",
          "resourceRefs",
          "identifiers",
          "oneLineSummary",
        ],
        resolveOnSync: true,
      }),
    );
    await fs.writeFile(
      note,
      `---\nid: ${local?.id}\nkind: company\nresourceRefs:\n  - conduit:customer:cus_1\nidentifiers:\n  taxId: US-94-123\n  email: secret@example.com\nsummary: Safe summary\nsecret: must-not-leave\n---\nPRIVATE NOTE BODY\n`,
    );

    expect(await enqueueEntityProjection(note, root)).toBe(true);
    const offline = await flushEntityProjectionOutbox(root, {
      put: async () => {
        throw new Error("offline");
      },
      get: async () => undefined,
      resolve: async () => undefined,
    });
    expect(offline).toEqual({ sent: 0, remaining: 1 });
    const outboxFile = path.join(root, "config", "entity-projection-outbox.json");
    const queued = JSON.parse(await fs.readFile(outboxFile, "utf8")) as {
      schema: 1;
      items: Array<Record<string, unknown>>;
    };
    queued.items[0].nextAttemptAt = new Date(0).toISOString();
    await writeJsonAtomic(outboxFile, queued);

    const canonicalEntityId = mintEntityId(Date.now() + 1, Buffer.alloc(10, 9));
    let wire: Record<string, unknown> | undefined;
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      wire = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ canonicalEntityId, status: "active", version: 2 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    try {
      const client = createEntitySpineClient({
        apiURL: `http://127.0.0.1:${address.port}`,
        accessToken: async () => "token",
      });
      expect(await flushEntityProjectionOutbox(root, client)).toEqual({ sent: 1, remaining: 0 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }

    expect(Object.keys(wire ?? {}).sort()).toEqual([
      "displayName",
      "id",
      "identifiers",
      "kind",
      "oneLineSummary",
      "resourceRefs",
    ]);
    expect(JSON.stringify(wire)).not.toContain("PRIVATE NOTE BODY");
    expect(JSON.stringify(wire)).not.toContain("secret@example.com");
    expect(JSON.stringify(wire)).not.toContain("US-94-123");
    expect(JSON.stringify(wire)).not.toContain("must-not-leave");
    expect(JSON.stringify(wire)).toContain("sha256:v1:");
    expect((await readEntityIdentity(note, path.join(root, "knowledge")))?.id).toBe(
      canonicalEntityId,
    );
  });

  it("returns two-product resource citations to Copilot without note content", async () => {
    const { root, note } = await fixture();
    const identity = await readEntityIdentity(note, path.join(root, "knowledge"));
    await fs.writeFile(
      note,
      `---\nid: ${identity?.id}\nkind: company\nresourceRefs:\n  - conduit:customer:cus_1\n  - cadence:vendor:ven_2\nidentifiers: {}\n---\nPRIVATE BODY\n`,
    );
    const unregisterConduit = registerEntityRefReadAdapter("conduit", async (ref) =>
      ref === "conduit:customer:cus_1" ? { overdueDays: 22, balanceBand: "high" } : undefined,
    );
    const unregisterCadence = registerEntityRefReadAdapter("cadence", async (ref) =>
      ref === "cadence:vendor:ven_2" ? { openPurchaseOrder: "PO-88" } : undefined,
    );
    const results = await (async () => {
      try {
        return await lookupEntities("Acme", root);
      } finally {
        unregisterConduit();
        unregisterCadence();
      }
    })();
    expect(results[0].resourceRefs).toEqual(["cadence:vendor:ven_2", "conduit:customer:cus_1"]);
    expect(
      results[0].citations
        .filter((citation) => citation.type === "resource")
        .map((citation) => citation.product),
    ).toEqual(["cadence", "conduit"]);
    expect(results[0].sourceFacts).toEqual([
      {
        ref: "cadence:vendor:ven_2",
        product: "cadence",
        recordType: "vendor",
        facts: { openPurchaseOrder: "PO-88" },
      },
      {
        ref: "conduit:customer:cus_1",
        product: "conduit",
        recordType: "customer",
        facts: { overdueDays: 22, balanceBand: "high" },
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("PRIVATE BODY");
  });

  it("deduplicates queued projections by entity id", async () => {
    const { root, note } = await fixture();
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    await enqueueEntityProjection(note, root);
    await enqueueEntityProjection(note, root);
    const outbox = JSON.parse(
      await fs.readFile(path.join(root, "config", "entity-projection-outbox.json"), "utf8"),
    ) as { items: unknown[] };
    expect(outbox.items).toHaveLength(1);
  });

  it("persists degraded health when outbox capacity rejects a new entity", async () => {
    const { root, note } = await fixture();
    const identity = await readEntityIdentity(note, path.join(root, "knowledge"));
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    const projection = await buildEntityProjection(note, root);
    if (!identity || !projection) throw new Error("missing fixture identity projection");
    await writeJsonAtomic(path.join(root, "config", "entity-projection-outbox.json"), {
      schema: 1,
      items: Array.from({ length: 10_000 }, (_, index) => ({
        id: `${identity.id}-${index}`,
        notePath: `knowledge/Organizations/Queued-${index}.md`,
        projection: { ...projection, id: `${identity.id}-${index}` },
        queuedAt: new Date(0).toISOString(),
        attempts: 0,
      })),
    });

    await expect(enqueueEntityProjection(note, root)).rejects.toThrow(
      "entity projection outbox is full",
    );
    expect(await getEntitySpineHealth(root)).toMatchObject({
      status: "degraded",
      remaining: 10_000,
      deadLetters: 0,
      lastError: "entity projection outbox is full",
    });
  });

  it("honors the configured outbound allowlist while retaining protocol identity", async () => {
    const { root, note } = await fixture();
    const identity = await readEntityIdentity(note, path.join(root, "knowledge"));
    await fs.writeFile(
      note,
      `---\nid: ${identity?.id}\nkind: company\nresourceRefs: [conduit:customer:cus_1]\nidentifiers:\n  emailDomain: acme.com\nsummary: private optional summary\n---\nPRIVATE BODY\n`,
    );
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
      projectionFields: ["id", "kind", "displayName"],
    });
    expect(await buildEntityProjection(note, root)).toEqual({
      id: identity?.id,
      kind: "company",
      displayName: "Acme",
    });
  });

  it("replays the durable startup queue and stops after the first offline failure", async () => {
    const { root, note } = await fixture();
    const second = path.join(root, "knowledge", "Organizations", "Beta.md");
    await fs.writeFile(second, "# Beta\n");
    await ensureEntityIdentity(second, path.join(root, "knowledge"));
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    let attempts = 0;
    const result = await resumeEntitySpineSync(root, {
      put: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      get: async () => undefined,
      resolve: async () => undefined,
    });
    expect(attempts).toBe(1);
    expect(result).toEqual({ sent: 0, remaining: 2 });
    const outbox = JSON.parse(
      await fs.readFile(path.join(root, "config", "entity-projection-outbox.json"), "utf8"),
    ) as { items: unknown[] };
    expect(outbox.items).toHaveLength(2);
    expect(await fs.readFile(note, "utf8")).toContain("PRIVATE NOTE BODY");
  });

  it("runs registered product read seams before projection sync", async () => {
    const { root, note } = await fixture();
    const content = await fs.readFile(note, "utf8");
    await fs.writeFile(
      note,
      content.replace("identifiers: {}", "identifiers:\n  emailDomain: acme.com"),
    );
    const unregisterConduit = registerEntityReadAdapter("conduit", async () => [
      {
        product: "conduit",
        type: "customer",
        externalId: "cus_1",
        identifiers: { emailDomain: "acme.com" },
      },
    ]);
    const unregisterCadence = registerEntityReadAdapter("cadence", async () => [
      {
        product: "cadence",
        type: "vendor",
        externalId: "ven_2",
        identifiers: { emailDomain: "acme.com" },
      },
    ]);
    try {
      await syncEntityNotes([note], root);
    } finally {
      unregisterConduit();
      unregisterCadence();
    }
    expect((await readEntityIdentity(note, path.join(root, "knowledge")))?.resourceRefs).toEqual([
      "cadence:vendor:ven_2",
      "conduit:customer:cus_1",
    ]);
  });

  it("quarantines a rejected projection without blocking later valid queue items", async () => {
    const { root, note } = await fixture();
    const second = path.join(root, "knowledge", "Organizations", "Beta.md");
    await fs.writeFile(second, "# Beta\n");
    await ensureEntityIdentity(second, path.join(root, "knowledge"));
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    await enqueueEntityProjection(note, root);
    await enqueueEntityProjection(second, root);

    let calls = 0;
    const server = http.createServer((_request, response) => {
      calls += 1;
      response.writeHead(calls === 1 ? 400 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "active", version: 1 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    try {
      const client = createEntitySpineClient({
        apiURL: `http://127.0.0.1:${address.port}`,
        accessToken: async () => "token",
      });
      expect(await flushEntityProjectionOutbox(root, client)).toEqual({ sent: 1, remaining: 0 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(calls).toBe(2);
    const deadLetters = JSON.parse(
      await fs.readFile(path.join(root, "config", "entity-projection-dead-letter.json"), "utf8"),
    ) as { items: Array<{ status?: number }> };
    expect(deadLetters.items).toHaveLength(1);
    expect(deadLetters.items[0].status).toBe(400);
  });

  it.each([409, 415])("quarantines HTTP %s and continues the queue", async (status) => {
    const { root, note } = await fixture();
    const second = path.join(root, "knowledge", "Organizations", `Beta-${status}.md`);
    await fs.writeFile(second, "# Beta\n");
    await ensureEntityIdentity(second, path.join(root, "knowledge"));
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    await enqueueEntityProjection(note, root);
    await enqueueEntityProjection(second, root);
    let calls = 0;
    const server = http.createServer((_request, response) => {
      calls += 1;
      response.writeHead(calls === 1 ? status : 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "active", version: 1 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    try {
      const client = createEntitySpineClient({
        apiURL: `http://127.0.0.1:${address.port}`,
        accessToken: async () => "token",
      });
      expect(await flushEntityProjectionOutbox(root, client)).toEqual({ sent: 1, remaining: 0 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(calls).toBe(2);
  });

  it("records canonical collisions instead of duplicating a local entity id", async () => {
    const { root, note } = await fixture();
    const second = path.join(root, "knowledge", "Organizations", "Canonical.md");
    await fs.writeFile(second, "# Canonical\n");
    const canonical = await ensureEntityIdentity(second, path.join(root, "knowledge"));
    const local = await readEntityIdentity(note, path.join(root, "knowledge"));
    await writeJsonAtomic(path.join(root, "config", "entity.json"), {
      ...DEFAULT_ENTITY_CONFIG,
      sharedSpine: true,
    });
    await enqueueEntityProjection(note, root);
    expect(
      await flushEntityProjectionOutbox(root, {
        put: async () => ({ canonicalId: canonical.identity?.id }),
        get: async () => undefined,
        resolve: async () => undefined,
      }),
    ).toEqual({ sent: 0, remaining: 0 });
    expect((await readEntityIdentity(note, path.join(root, "knowledge")))?.id).toBe(local?.id);
    const conflicts = JSON.parse(
      await fs.readFile(path.join(root, "config", "entity-canonical-conflicts.json"), "utf8"),
    ) as { conflicts: Array<{ canonicalEntityId: string }> };
    expect(conflicts.conflicts[0].canonicalEntityId).toBe(canonical.identity?.id);
  });
});
