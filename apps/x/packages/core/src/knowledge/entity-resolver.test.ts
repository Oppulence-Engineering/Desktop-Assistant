import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  formatResourceRef,
  parseResourceRef,
  reconcileEntityNote,
  reviewEntityLinkSuggestion,
  type ProductEntityRecord,
} from "./entity-resolver.js";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; note: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "entity-resolver-"));
  roots.push(root);
  const note = path.join(root, "knowledge", "Organizations", "Acme.md");
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(note, "# Acme\n");
  return { root, note };
}

function noteFrontmatter(content: string): Record<string, unknown> {
  const end = content.indexOf("\n---\n", 4);
  return parseYaml(content.slice(4, end)) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("entity resolver", () => {
  it("parses the bounded product:type:externalId grammar", () => {
    expect(parseResourceRef("conduit:customer:cus_8fA2")).toEqual({
      product: "conduit",
      type: "customer",
      externalId: "cus_8fA2",
    });
    expect(formatResourceRef({ product: "CADENCE", type: "vendor", externalId: "ven:5512" })).toBe(
      "cadence:vendor:ven:5512",
    );
    expect(parseResourceRef("gmail:thread:1")).toEqual({
      product: "gmail",
      type: "thread",
      externalId: "1",
    });
    expect(() => parseResourceRef("gmail.com:thread:1")).toThrow(/product/);
  });

  it("links two products deterministically and idempotently", async () => {
    const { root, note } = await fixture();
    const records: ProductEntityRecord[] = [
      {
        product: "conduit",
        type: "customer",
        externalId: "cus_1",
        identifiers: { emailDomain: "ACME.com" },
      },
      {
        product: "cadence",
        type: "vendor",
        externalId: "ven_2",
        identifiers: { taxId: "US-94-123" },
      },
      {
        product: "eigen",
        type: "entity",
        externalId: "other",
        identifiers: { emailDomain: "other.example" },
      },
    ];
    const first = await reconcileEntityNote({
      filePath: note,
      workDir: root,
      records,
      identifiers: { emailDomains: ["acme.com"], taxId: "US94123" },
    });
    expect(first.linkedRefs).toEqual(["cadence:vendor:ven_2", "conduit:customer:cus_1"]);
    expect(first.unlinkedProducts).toEqual(["eigen"]);

    const second = await reconcileEntityNote({ filePath: note, workDir: root, records });
    expect(second.entity.resourceRefs).toEqual(first.entity.resourceRefs);
    const fm = noteFrontmatter(await fs.readFile(note, "utf8"));
    expect(fm.resourceRefs).toEqual(["cadence:vendor:ven_2", "conduit:customer:cus_1"]);
  });

  it("persists ambiguous deterministic matches for human review without linking", async () => {
    const { root, note } = await fixture();
    const records: ProductEntityRecord[] = [
      {
        product: "conduit",
        type: "customer",
        externalId: "cus_1",
        identifiers: { emailDomain: "acme.com" },
      },
      {
        product: "conduit",
        type: "customer",
        externalId: "cus_2",
        identifiers: { emailDomain: "acme.com" },
      },
    ];
    const result = await reconcileEntityNote({
      filePath: note,
      workDir: root,
      records,
      identifiers: { emailDomain: "acme.com" },
      now: new Date("2026-08-27T00:00:00Z"),
    });
    expect(result.entity.resourceRefs).toEqual([]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].candidateRefs).toEqual([
      "conduit:customer:cus_1",
      "conduit:customer:cus_2",
    ]);
    const queue = JSON.parse(
      await fs.readFile(path.join(root, "config", "entity-link-suggestions.json"), "utf8"),
    ) as { suggestions: unknown[] };
    expect(queue.suggestions).toHaveLength(1);

    const accepted = await reviewEntityLinkSuggestion({
      workDir: root,
      suggestionId: result.suggestions[0].id,
      decision: "accept",
      chosenRef: "conduit:customer:cus_2",
    });
    expect(accepted.status).toBe("accepted");
    expect(noteFrontmatter(await fs.readFile(note, "utf8")).resourceRefs).toEqual([
      "conduit:customer:cus_2",
    ]);
  });
});
