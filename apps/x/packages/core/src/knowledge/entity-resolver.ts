import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { readEntityConfig } from "./entity-config.js";
import { readJsonConfig } from "../config/json_config.js";
import {
  ensureEntityIdentity,
  updateEntityIdentity,
  type EntityIdentitySnapshot,
} from "./entity-identity.js";

const REF_PART = /^[a-z][a-z0-9_-]{0,63}$/;

export type EntityReadAdapter = (identifiers: Record<string, string[]>) => Promise<ProductEntityRecord[]>;
const readAdapters = new Map<string, EntityReadAdapter>();

export function registerEntityReadAdapter(product: string, adapter: EntityReadAdapter): () => void {
  const normalized = product.trim().toLowerCase();
  if (!REF_PART.test(normalized)) throw new Error(`invalid entity adapter product ${product}`);
  readAdapters.set(normalized, adapter);
  return () => readAdapters.delete(normalized);
}

export async function readEntityRecords(identifiers: Record<string, string | string[]>): Promise<ProductEntityRecord[]> {
  const normalized = normalizeEntityIdentifiers(identifiers);
  const results = await Promise.allSettled([...readAdapters.values()].map((adapter) => adapter(normalized)));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export interface ProductEntityRecord {
  product: string;
  type: string;
  externalId: string;
  displayName?: string;
  identifiers: Record<string, string | string[]>;
}

export interface EntityLinkSuggestion {
  id: string;
  entityId: string;
  notePath: string;
  product: string;
  recordType: string;
  candidateRefs: string[];
  matchedIdentifiers: string[];
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface EntityResolutionResult {
  entity: EntityIdentitySnapshot;
  linkedRefs: string[];
  unlinkedProducts: string[];
  suggestions: EntityLinkSuggestion[];
}

const SuggestionFile = z.object({
  schema: z.literal(1),
  suggestions: z.array(z.object({
    id: z.string(),
    entityId: z.string(),
    notePath: z.string(),
    product: z.string(),
    recordType: z.string(),
    candidateRefs: z.array(z.string()),
    matchedIdentifiers: z.array(z.string()),
    status: z.enum(["pending", "accepted", "rejected"]),
    createdAt: z.string(),
  })),
});

export function parseResourceRef(value: string): {
  product: string;
  type: string;
  externalId: string;
} {
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first <= 0 || second <= first + 1 || second === value.length - 1) {
    throw new Error(`invalid resourceRef ${JSON.stringify(value)}`);
  }
  const product = value.slice(0, first).toLowerCase();
  const type = value.slice(first + 1, second).toLowerCase();
  const externalId = value.slice(second + 1).trim();
  if (!REF_PART.test(product)) throw new Error(`invalid resourceRef product ${product}`);
  if (!REF_PART.test(type)) throw new Error(`invalid resourceRef type ${type}`);
  if (externalId.length > 256 || [...externalId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("invalid resourceRef external id");
  }
  return { product, type, externalId };
}

export function formatResourceRef(record: Pick<ProductEntityRecord, "product" | "type" | "externalId">): string {
  const value = `${record.product.toLowerCase()}:${record.type.toLowerCase()}:${record.externalId.trim()}`;
  parseResourceRef(value);
  return value;
}

function canonicalIdentifierKey(key: string): string {
  const compact = key.trim().replace(/[_\s-]/g, "").toLowerCase();
  if (compact === "emaildomain" || compact === "emaildomains" || compact === "domain") return "emailDomains";
  if (compact === "taxid" || compact === "taxids") return "taxIds";
  return key.trim();
}

function canonicalIdentifierValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (key === "emailDomains") return trimmed.toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (key === "taxIds") return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return trimmed;
}

export function normalizeEntityIdentifiers(
  identifiers: Record<string, string | string[]>,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [rawKey, rawValues] of Object.entries(identifiers)) {
    const key = canonicalIdentifierKey(rawKey);
    if (!key || key.length > 64) continue;
    const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((value) => canonicalIdentifierValue(key, value))
      .filter((value) => value.length > 0 && value.length <= 256);
    if (values.length === 0) continue;
    normalized[key] = [...new Set([...(normalized[key] ?? []), ...values])].sort();
  }
  return normalized;
}

function identifierMatches(
  entity: Record<string, string[]>,
  record: Record<string, string[]>,
): string[] {
  const matches: string[] = [];
  for (const [key, values] of Object.entries(record)) {
    const existing = new Set(entity[key] ?? []);
    for (const value of values) {
      if (existing.has(value)) matches.push(`${key}:${value}`);
    }
  }
  return [...new Set(matches)].sort();
}

function suggestionID(entityId: string, product: string, type: string, refs: string[]): string {
  return createHash("sha256")
    .update([entityId, product, type, ...refs].join("\0"))
    .digest("hex")
    .slice(0, 24);
}

async function persistSuggestions(filePath: string, incoming: EntityLinkSuggestion[]): Promise<void> {
  if (incoming.length === 0) return;
  let existing: EntityLinkSuggestion[] = [];
  try {
    existing = (await readJsonConfig(filePath, SuggestionFile, () => ({ schema: 1 as const, suggestions: [] }))).config.suggestions;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const byID = new Map(existing.map((suggestion) => [suggestion.id, suggestion]));
  for (const suggestion of incoming) {
    if (!byID.has(suggestion.id)) byID.set(suggestion.id, suggestion);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, { schema: 1, suggestions: [...byID.values()] });
}

export async function listEntityLinkSuggestions(workDir: string): Promise<EntityLinkSuggestion[]> {
  const filePath = path.join(workDir, "config", "entity-link-suggestions.json");
  try {
    return (await readJsonConfig(filePath, SuggestionFile, () => ({ schema: 1 as const, suggestions: [] }))).config.suggestions;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

/** Human-review mutation path. Accepting links exactly one chosen candidate; rejecting never mutates the note. */
export async function reviewEntityLinkSuggestion(input: {
  workDir: string;
  suggestionId: string;
  decision: "accept" | "reject";
  chosenRef?: string;
}): Promise<EntityLinkSuggestion> {
  const filePath = path.join(input.workDir, "config", "entity-link-suggestions.json");
  const suggestions = await listEntityLinkSuggestions(input.workDir);
  const index = suggestions.findIndex((suggestion) => suggestion.id === input.suggestionId);
  if (index < 0) throw new Error(`entity link suggestion not found: ${input.suggestionId}`);
  const current = suggestions[index];
  if (current.status !== "pending") return current;

  if (input.decision === "accept") {
    if (!input.chosenRef || !current.candidateRefs.includes(input.chosenRef)) {
      throw new Error("accepted entity link must choose one candidateRef");
    }
    const notePath = path.join(input.workDir, current.notePath);
    const knowledgeDir = path.join(input.workDir, "knowledge");
    const ensured = await ensureEntityIdentity(notePath, knowledgeDir);
    if (!ensured.identity || ensured.identity.id !== current.entityId) {
      throw new Error("suggestion entity no longer matches its note");
    }
    await updateEntityIdentity(notePath, knowledgeDir, {
      resourceRefs: [...ensured.identity.resourceRefs, input.chosenRef],
    });
  }

  suggestions[index] = { ...current, status: input.decision === "accept" ? "accepted" : "rejected" };
  await writeJsonAtomic(filePath, { schema: 1, suggestions });
  return suggestions[index];
}

/**
 * Deterministically link one local entity note to provider records. Multiple
 * exact matches inside one product/type group are review items, never merges.
 */
export async function reconcileEntityNote(input: {
  filePath: string;
  workDir: string;
  records: ProductEntityRecord[];
  identifiers?: Record<string, string | string[]>;
  now?: Date;
}): Promise<EntityResolutionResult> {
  const knowledgeDir = path.join(input.workDir, "knowledge");
  const ensured = await ensureEntityIdentity(input.filePath, knowledgeDir);
  if (!ensured.identity) throw new Error(`not an entity note: ${input.filePath}`);
  const entityIdentifiers = normalizeEntityIdentifiers(ensured.identity.identifiers);
  for (const [key, values] of Object.entries(normalizeEntityIdentifiers(input.identifiers ?? {}))) {
    entityIdentifiers[key] = [...new Set([...(entityIdentifiers[key] ?? []), ...values])].sort();
  }
  const grouped = new Map<string, Array<{ record: ProductEntityRecord; ref: string; matches: string[] }>>();
  for (const record of input.records) {
    const ref = formatResourceRef(record);
    const matches = identifierMatches(entityIdentifiers, normalizeEntityIdentifiers(record.identifiers));
    if (matches.length === 0) continue;
    const key = `${record.product.toLowerCase()}:${record.type.toLowerCase()}`;
    const group = grouped.get(key) ?? [];
    group.push({ record, ref, matches });
    grouped.set(key, group);
  }

  const refs = new Set(ensured.identity.resourceRefs.map((ref) => formatResourceRef(parseResourceRef(ref))));
  const linkedRefs: string[] = [];
  const suggestions: EntityLinkSuggestion[] = [];
  const matchedProducts = new Set<string>();
  for (const [key, candidates] of grouped) {
    const [product, recordType] = key.split(":", 2);
    matchedProducts.add(product);
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.ref, candidate])).values()];
    if (uniqueCandidates.length === 1) {
      refs.add(uniqueCandidates[0].ref);
      linkedRefs.push(uniqueCandidates[0].ref);
      continue;
    }
    const candidateRefs = uniqueCandidates.map((candidate) => candidate.ref).sort();
    suggestions.push({
      id: suggestionID(ensured.identity.id, product, recordType, candidateRefs),
      entityId: ensured.identity.id,
      notePath: path.relative(input.workDir, input.filePath),
      product,
      recordType,
      candidateRefs,
      matchedIdentifiers: [...new Set(uniqueCandidates.flatMap((candidate) => candidate.matches))].sort(),
      status: "pending",
      createdAt: (input.now ?? new Date()).toISOString(),
    });
  }

  const entity = await updateEntityIdentity(input.filePath, knowledgeDir, {
    resourceRefs: [...refs],
    identifiers: entityIdentifiers,
  });
  await persistSuggestions(path.join(input.workDir, "config", "entity-link-suggestions.json"), suggestions);
  const allProducts = new Set(input.records.map((record) => record.product.toLowerCase()));
  return {
    entity,
    linkedRefs: [...new Set(linkedRefs)].sort(),
    unlinkedProducts: [...allProducts].filter((product) => !matchedProducts.has(product)).sort(),
    suggestions,
  };
}

/** Mirror-sync seam: provider packages call this after writing their local note. */
export async function reconcileMirroredEntity(
  filePath: string,
  workDir: string,
  records: ProductEntityRecord[],
  identifiers?: Record<string, string | string[]>,
): Promise<EntityResolutionResult> {
  const config = await readEntityConfig(workDir);
  const adapterRecords = config.resolveOnSync ? await readEntityRecords(identifiers ?? {}) : [];
  const result = config.resolveOnSync
    ? await reconcileEntityNote({ filePath, workDir, records: [...records, ...adapterRecords], identifiers })
    : await reconcileEntityNote({ filePath, workDir, records: [], identifiers });
  const { syncEntityNotes } = await import("./entity-spine.js");
  await syncEntityNotes([filePath], workDir);
  return result;
}
