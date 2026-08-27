import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  backfillEntityIds,
  captureEntityIdentities,
  ensureEntityIdentity,
  isEntityId,
  mintEntityId,
  stabilizeEntityNotes,
} from "./entity-identity.js";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "entity-identity-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "knowledge", "Organizations"), { recursive: true });
  return root;
}

function frontmatter(content: string): Record<string, unknown> {
  const end = content.indexOf("\n---\n", 4);
  return parseYaml(content.slice(4, end)) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("entity identity", () => {
  it("mints standards-compatible sortable ULIDs", () => {
    const early = mintEntityId(1_700_000_000_000, Buffer.alloc(10, 1));
    const late = mintEntityId(1_700_000_000_001, Buffer.alloc(10, 0));
    expect(isEntityId(early)).toBe(true);
    expect(early).toHaveLength(26);
    expect(early < late).toBe(true);
  });

  it("backfills entity notes restart-safely and preserves body bytes", async () => {
    const root = await workspace();
    const note = path.join(root, "knowledge", "Organizations", "Acme.md");
    const body = "# Acme\n\nPrivate body.\n";
    await fs.writeFile(note, body);

    const first = await backfillEntityIds(root);
    expect(first).toMatchObject({ processed: 1, minted: 1 });
    const content = await fs.readFile(note, "utf8");
    const fm = frontmatter(content);
    expect(isEntityId(String(fm.id))).toBe(true);
    expect(fm.kind).toBe("company");
    expect(content.endsWith(body)).toBe(true);

    const second = await backfillEntityIds(root);
    expect(second).toMatchObject({ processed: 1, minted: 0, duplicateReminted: 0 });
    expect(await fs.readFile(note, "utf8")).toBe(content);
  });

  it("restores the protected identity block after an agent edit", async () => {
    const root = await workspace();
    const knowledge = path.join(root, "knowledge");
    const note = path.join(knowledge, "Organizations", "Acme.md");
    await fs.writeFile(note, "# Acme\n");
    await ensureEntityIdentity(note, knowledge);
    const before = await captureEntityIdentities(knowledge);
    const original = before.get(path.resolve(note));
    expect(original).toBeDefined();

    await fs.writeFile(
      note,
      `---\nid: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nkind: invoice\nresourceRefs:\n  - conduit:customer:wrong\nidentifiers:\n  taxId: wrong\n---\n# Acme changed\n`,
    );
    await stabilizeEntityNotes([note], root, before);
    const content = await fs.readFile(note, "utf8");
    const fm = frontmatter(content);
    expect(fm.id).toBe(original?.id);
    expect(fm.kind).toBe("company");
    expect(fm.resourceRefs).toEqual([]);
    expect(fm.identifiers).toEqual({});
    expect(content).toContain("# Acme changed");
  });

  it("survives a filesystem rename because identity is inside the note", async () => {
    const root = await workspace();
    const knowledge = path.join(root, "knowledge");
    const first = path.join(knowledge, "Organizations", "Acme.md");
    const renamed = path.join(knowledge, "Organizations", "Acme Corp.md");
    await fs.writeFile(first, "# Acme\n");
    const initial = await ensureEntityIdentity(first, knowledge);
    await fs.rename(first, renamed);
    const after = await ensureEntityIdentity(renamed, knowledge);
    expect(after.identity?.id).toBe(initial.identity?.id);
    expect(after.minted).toBe(false);
  });

  it("deterministically remints later duplicate ids during backfill", async () => {
    const root = await workspace();
    const organizations = path.join(root, "knowledge", "Organizations");
    const first = path.join(organizations, "A.md");
    const second = path.join(organizations, "B.md");
    const duplicate = mintEntityId(1_700_000_000_000, Buffer.alloc(10, 4));
    const content = `---\nid: ${duplicate}\nkind: company\nresourceRefs: []\nidentifiers: {}\n---\nBody\n`;
    await fs.writeFile(first, content);
    await fs.writeFile(second, content);

    const result = await backfillEntityIds(root);
    expect(result.duplicateReminted).toBe(1);
    expect((await ensureEntityIdentity(first, path.join(root, "knowledge"))).identity?.id).toBe(
      duplicate,
    );
    expect(
      (await ensureEntityIdentity(second, path.join(root, "knowledge"))).identity?.id,
    ).not.toBe(duplicate);
  });

  it("repairs duplicates introduced after the completion marker", async () => {
    const root = await workspace();
    const organizations = path.join(root, "knowledge", "Organizations");
    const first = path.join(organizations, "A.md");
    await fs.writeFile(first, "# A\n");
    await backfillEntityIds(root);
    const identity = await ensureEntityIdentity(first, path.join(root, "knowledge"));
    const second = path.join(organizations, "B.md");
    await fs.copyFile(first, second);

    const result = await backfillEntityIds(root);
    expect(result.duplicateReminted).toBe(1);
    expect(
      (await ensureEntityIdentity(second, path.join(root, "knowledge"))).identity?.id,
    ).not.toBe(identity.identity?.id);
  });
});
