import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitFrontmatter } from "../application/lib/parse-frontmatter.js";
import { entityKindForPath } from "./entity-identity.js";
import { parseResourceRef } from "./entity-reference.js";
import { readEntitySourceFacts, type EntitySourceFact } from "./entity-resolver.js";

export interface EntityLookupResult {
  id: string;
  kind: string;
  displayName: string;
  notePath: string;
  resourceRefs: string[];
  sourceFacts: Array<{
    ref: string;
    product: string;
    recordType: string;
    facts: Record<string, EntitySourceFact>;
  }>;
  citations: Array<{
    type: "note" | "resource";
    ref: string;
    product?: string;
    recordType?: string;
  }>;
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(child)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
  }
  return files;
}

/** Local-first Copilot lookup. Returns explicit cross-product refs as citations, never note bodies. */
export async function lookupEntities(
  query: string,
  workDir: string,
  limit = 10,
): Promise<EntityLookupResult[]> {
  const knowledgeDir = path.join(workDir, "knowledge");
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: EntityLookupResult[] = [];
  for (const filePath of await markdownFiles(knowledgeDir)) {
    if (!entityKindForPath(filePath, knowledgeDir)) continue;
    const { frontmatter } = splitFrontmatter(await fs.readFile(filePath, "utf8"));
    if (typeof frontmatter.id !== "string" || typeof frontmatter.kind !== "string") continue;
    const displayName = [frontmatter.displayName, frontmatter.name, frontmatter.title].find(
      (value) => typeof value === "string" && value.trim(),
    ) as string | undefined;
    const name = displayName?.trim() || path.basename(filePath, ".md");
    const refs = Array.isArray(frontmatter.resourceRefs)
      ? frontmatter.resourceRefs.filter((value): value is string => typeof value === "string")
      : [];
    if (![frontmatter.id, name, ...refs].some((value) => value.toLowerCase().includes(needle)))
      continue;
    const notePath = path.relative(workDir, filePath);
    const normalizedRefs = [...new Set(refs)].sort();
    const sourceFacts = (
      await Promise.all(
        normalizedRefs.map(async (ref) => {
          try {
            const parsed = parseResourceRef(ref);
            const facts = await readEntitySourceFacts(ref);
            return facts
              ? { ref, product: parsed.product, recordType: parsed.type, facts }
              : undefined;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((value): value is NonNullable<typeof value> => Boolean(value));
    matches.push({
      id: frontmatter.id,
      kind: frontmatter.kind,
      displayName: name,
      notePath,
      resourceRefs: normalizedRefs,
      sourceFacts,
      citations: [
        { type: "note", ref: notePath },
        ...normalizedRefs.flatMap((ref) => {
          try {
            const parsed = parseResourceRef(ref);
            return [
              { type: "resource" as const, ref, product: parsed.product, recordType: parsed.type },
            ];
          } catch {
            return [];
          }
        }),
      ],
    });
  }
  return matches
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}
