import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { splitFrontmatter, joinFrontmatter } from "../application/lib/parse-frontmatter.js";
import { writeJsonAtomic, writeTextAtomic } from "../filesystem/atomic_write.js";
import { readJsonConfig } from "../config/json_config.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ENTITY_FOLDERS = new Map<string, string>([
  ["People", "person"],
  ["Organizations", "company"],
  ["Companies", "company"],
  ["Projects", "project"],
  ["Topics", "topic"],
  ["Invoices", "invoice"],
  ["Vendors", "vendor"],
]);

const IdentifierValues = z.union([z.string(), z.array(z.string())]);
const EntityIdentitySchema = z.object({
  id: z.string().regex(ULID_PATTERN),
  kind: z.string().min(1).max(64),
  resourceRefs: z.array(z.string()).default([]),
  identifiers: z.record(z.string(), IdentifierValues).default({}),
});

export type EntityIdentity = z.infer<typeof EntityIdentitySchema>;

export interface EntityIdentitySnapshot {
  id: string;
  kind: string;
  resourceRefs: string[];
  identifiers: Record<string, string | string[]>;
}

export interface EntityBackfillResult {
  processed: number;
  minted: number;
  duplicateReminted: number;
  markerPath: string;
}

function encodeBase32(value: bigint, length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

/** Mint a standards-compatible, lexicographically sortable ULID. */
export function mintEntityId(now = Date.now(), entropy = randomBytes(10)): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error("entity ULID timestamp is outside the 48-bit range");
  }
  if (entropy.length !== 10) throw new Error("entity ULID entropy must be 10 bytes");
  let randomness = 0n;
  for (const byte of entropy) randomness = (randomness << 8n) | BigInt(byte);
  return encodeBase32(BigInt(now), 10) + encodeBase32(randomness, 16);
}

export function isEntityId(value: string): boolean {
  return ULID_PATTERN.test(value);
}

export function entityKindForPath(filePath: string, knowledgeDir: string): string | undefined {
  const relative = path.relative(knowledgeDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".md"))
    return undefined;
  const folder = relative.split(path.sep)[0];
  return ENTITY_FOLDERS.get(folder);
}

function normalizeIdentifierValues(
  values: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, raw] of Object.entries(values)) {
    const items = (Array.isArray(raw) ? raw : [raw]).map((value) => value.trim()).filter(Boolean);
    if (items.length === 0) continue;
    const unique = [...new Set(items)].sort();
    normalized[key] = Array.isArray(raw) ? unique : unique[0];
  }
  return normalized;
}

function snapshotFromFrontmatter(
  frontmatter: Record<string, unknown>,
  fallbackKind?: string,
): EntityIdentitySnapshot | undefined {
  const explicitKind = typeof frontmatter.kind === "string" ? frontmatter.kind.trim() : "";
  const kind = explicitKind || fallbackKind;
  if (!kind) return undefined;
  const parsed = EntityIdentitySchema.safeParse({
    id: frontmatter.id,
    kind,
    resourceRefs: frontmatter.resourceRefs,
    identifiers: frontmatter.identifiers,
  });
  if (!parsed.success) return undefined;
  return {
    id: parsed.data.id,
    kind: parsed.data.kind,
    resourceRefs: [
      ...new Set(parsed.data.resourceRefs.map((ref) => ref.trim()).filter(Boolean)),
    ].sort(),
    identifiers: normalizeIdentifierValues(parsed.data.identifiers),
  };
}

/** Read the protected identity block from an entity note. */
export async function readEntityIdentity(
  filePath: string,
  knowledgeDir: string,
): Promise<EntityIdentitySnapshot | undefined> {
  const content = await fs.readFile(filePath, "utf8");
  const { frontmatter } = splitFrontmatter(content);
  return snapshotFromFrontmatter(frontmatter, entityKindForPath(filePath, knowledgeDir));
}

/**
 * Ensure a note has an identity block. When a previous snapshot is supplied,
 * every protected field is restored after an agent edit; only the resolver may
 * change refs or identifiers.
 */
export async function ensureEntityIdentity(
  filePath: string,
  knowledgeDir: string,
  previous?: EntityIdentitySnapshot,
): Promise<{ identity?: EntityIdentitySnapshot; minted: boolean; changed: boolean }> {
  const content = await fs.readFile(filePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(content);
  const fallbackKind = entityKindForPath(filePath, knowledgeDir);
  const explicitKind = typeof frontmatter.kind === "string" ? frontmatter.kind.trim() : "";
  const kind = previous?.kind || explicitKind || fallbackKind;
  if (!kind) return { identity: undefined, minted: false, changed: false };

  const rawID = typeof frontmatter.id === "string" ? frontmatter.id.trim().toUpperCase() : "";
  if (rawID && !isEntityId(rawID) && !previous) {
    throw new Error(`entity note has an invalid id: ${filePath}`);
  }
  const id = previous?.id || rawID || mintEntityId();
  const resourceRefs =
    previous?.resourceRefs ??
    (Array.isArray(frontmatter.resourceRefs)
      ? [
          ...new Set(
            frontmatter.resourceRefs
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ].sort()
      : []);
  const rawIdentifiers =
    previous?.identifiers ??
    (frontmatter.identifiers &&
    typeof frontmatter.identifiers === "object" &&
    !Array.isArray(frontmatter.identifiers)
      ? (frontmatter.identifiers as Record<string, string | string[]>)
      : {});
  const identity: EntityIdentitySnapshot = {
    id,
    kind,
    resourceRefs,
    identifiers: normalizeIdentifierValues(rawIdentifiers),
  };
  const nextFrontmatter = {
    ...frontmatter,
    id: identity.id,
    kind: identity.kind,
    resourceRefs: identity.resourceRefs,
    identifiers: identity.identifiers,
  };
  const nextContent = joinFrontmatter(nextFrontmatter, body);
  const changed = nextContent !== content;
  if (changed) await writeTextAtomic(filePath, nextContent);
  return { identity, minted: !previous && !rawID, changed };
}

/** Resolver-only mutation path for refs and deterministic identifiers. */
export async function updateEntityIdentity(
  filePath: string,
  knowledgeDir: string,
  update: {
    resourceRefs?: string[];
    identifiers?: Record<string, string | string[]>;
    id?: string;
  },
): Promise<EntityIdentitySnapshot> {
  const ensured = await ensureEntityIdentity(filePath, knowledgeDir);
  if (!ensured.identity) throw new Error(`not an entity note: ${filePath}`);
  if (update.id && !isEntityId(update.id)) throw new Error("canonical entity id must be a ULID");
  const content = await fs.readFile(filePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(content);
  const identity: EntityIdentitySnapshot = {
    ...ensured.identity,
    ...(update.id ? { id: update.id } : {}),
    ...(update.resourceRefs
      ? {
          resourceRefs: [
            ...new Set(update.resourceRefs.map((ref) => ref.trim()).filter(Boolean)),
          ].sort(),
        }
      : {}),
    ...(update.identifiers
      ? { identifiers: normalizeIdentifierValues(update.identifiers) }
      : {}),
  };
  const nextContent = joinFrontmatter(
    {
      ...frontmatter,
      id: identity.id,
      kind: identity.kind,
      resourceRefs: identity.resourceRefs,
      identifiers: identity.identifiers,
    },
    body,
  );
  if (nextContent !== content) await writeTextAtomic(filePath, nextContent);
  return identity;
}

async function scanMarkdown(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await scanMarkdown(fullPath)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files.sort();
}

export async function captureEntityIdentities(
  knowledgeDir: string,
): Promise<Map<string, EntityIdentitySnapshot>> {
  const identities = new Map<string, EntityIdentitySnapshot>();
  for (const filePath of await scanMarkdown(knowledgeDir)) {
    const identity = await readEntityIdentity(filePath, knowledgeDir);
    if (identity) identities.set(path.resolve(filePath), identity);
  }
  return identities;
}

export async function stabilizeEntityNotes(
  notePaths: Iterable<string>,
  workDir: string,
  previous: Map<string, EntityIdentitySnapshot>,
): Promise<EntityIdentitySnapshot[]> {
  const knowledgeDir = path.join(workDir, "knowledge");
  const stabilized: EntityIdentitySnapshot[] = [];
  for (const notePath of notePaths) {
    const filePath = path.isAbsolute(notePath) ? notePath : path.join(workDir, notePath);
    if (!filePath.endsWith(".md")) continue;
    try {
      const result = await ensureEntityIdentity(
        filePath,
        knowledgeDir,
        previous.get(path.resolve(filePath)),
      );
      if (result.identity) stabilized.push(result.identity);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  return stabilized;
}

/** Common write-boundary guard. Existing notes restore their protected snapshot; copied notes get a fresh id. */
export async function stabilizeEntityNoteMutation(
  filePath: string,
  workDir: string,
  previous?: EntityIdentitySnapshot,
): Promise<EntityIdentitySnapshot | undefined> {
  const knowledgeDir = path.join(workDir, "knowledge");
  const ensured = await ensureEntityIdentity(filePath, knowledgeDir, previous);
  if (!ensured.identity) return undefined;
  for (const candidate of await scanMarkdown(knowledgeDir)) {
    if (path.resolve(candidate) === path.resolve(filePath)) continue;
    const identity = await readEntityIdentity(candidate, knowledgeDir);
    if (identity?.id !== ensured.identity.id) continue;
    if (previous) throw new Error(`duplicate entity id ${identity.id} in ${filePath} and ${candidate}`);
    return updateEntityIdentity(filePath, knowledgeDir, { id: mintEntityId() });
  }
  return ensured.identity;
}

/** One-time, restart-safe backfill for all recognized entity notes. */
export async function backfillEntityIds(workDir: string): Promise<EntityBackfillResult> {
  const markerPath = path.join(workDir, "config", "entity-ids-backfilled.json");
  try {
    const Marker = z.object({ completedAt: z.string().optional(), processed: z.number().optional(), minted: z.number().optional(), duplicateReminted: z.number().optional() }).passthrough();
    const { config: marker } = await readJsonConfig(markerPath, Marker, (): z.infer<typeof Marker> => ({}));
    if (marker.completedAt) {
      return { processed: marker.processed ?? 0, minted: marker.minted ?? 0, duplicateReminted: marker.duplicateReminted ?? 0, markerPath };
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }

  const knowledgeDir = path.join(workDir, "knowledge");
  let processed = 0;
  let minted = 0;
  let duplicateReminted = 0;
  const owners = new Set<string>();
  for (const filePath of await scanMarkdown(knowledgeDir)) {
    let result = await ensureEntityIdentity(filePath, knowledgeDir);
    if (!result.identity) continue;
    let identity = result.identity;
    if (owners.has(identity.id)) {
      const updatedIdentity = await updateEntityIdentity(filePath, knowledgeDir, { id: mintEntityId() });
      result = { identity: updatedIdentity, minted: false, changed: true };
      identity = updatedIdentity;
      duplicateReminted += 1;
    }
    owners.add(identity.id);
    processed += 1;
    if (result.minted) minted += 1;
  }
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await writeJsonAtomic(markerPath, { schema: 1, completedAt: new Date().toISOString(), processed, minted, duplicateReminted });
  return { processed, minted, duplicateReminted, markerPath };
}
