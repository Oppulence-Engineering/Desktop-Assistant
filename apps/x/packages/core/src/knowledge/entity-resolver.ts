import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { readJsonConfig } from "../config/json_config.js";
import {
  ensureEntityIdentity,
  updateEntityIdentity,
  type EntityIdentitySnapshot,
} from "./entity-identity.js";
import {
  formatResourceRef,
  normalizeEntityIdentifiers,
  parseResourceRef,
} from "./entity-reference.js";

const REF_PART = /^[a-z][a-z0-9_-]{0,63}$/;

export type EntityReadAdapter = (
  identifiers: Record<string, string[]>,
) => Promise<ProductEntityRecord[]>;
const readAdapters = new Map<string, EntityReadAdapter>();
export type EntitySourceFact = string | number | boolean | null;
export type EntityRefReadAdapter = (
  ref: string,
) => Promise<Record<string, EntitySourceFact> | undefined>;
const refReadAdapters = new Map<string, EntityRefReadAdapter>();

export function registerEntityReadAdapter(product: string, adapter: EntityReadAdapter): () => void {
  const normalized = product.trim().toLowerCase();
  if (!REF_PART.test(normalized)) throw new Error(`invalid entity adapter product ${product}`);
  readAdapters.set(normalized, adapter);
  return () => readAdapters.delete(normalized);
}

/** Register a bounded Read-seam lookup used by Copilot after identity resolution. */
export function registerEntityRefReadAdapter(
  product: string,
  adapter: EntityRefReadAdapter,
): () => void {
  const normalized = product.trim().toLowerCase();
  if (!REF_PART.test(normalized)) throw new Error(`invalid entity adapter product ${product}`);
  refReadAdapters.set(normalized, adapter);
  return () => refReadAdapters.delete(normalized);
}

export async function readEntitySourceFacts(
  ref: string,
): Promise<Record<string, EntitySourceFact> | undefined> {
  const parsed = parseResourceRef(ref);
  const adapter = refReadAdapters.get(parsed.product);
  if (!adapter) return undefined;
  const raw = await adapter(formatResourceRef(parsed));
  if (!raw) return undefined;
  const facts: Record<string, EntitySourceFact> = {};
  for (const [key, value] of Object.entries(raw).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) continue;
    if (typeof value === "string") facts[key] = value.replace(/\s+/g, " ").trim().slice(0, 500);
    else if (typeof value === "number" && Number.isFinite(value)) facts[key] = value;
    else if (typeof value === "boolean" || value === null) facts[key] = value;
  }
  return Object.keys(facts).length > 0 ? facts : undefined;
}

export async function readEntityRecords(
  identifiers: Record<string, string | string[]>,
): Promise<ProductEntityRecord[]> {
  const normalized = normalizeEntityIdentifiers(identifiers);
  const results = await Promise.allSettled(
    [...readAdapters.values()].map((adapter) => adapter(normalized)),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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
  suggestions: z.array(
    z.object({
      id: z.string(),
      entityId: z.string(),
      notePath: z.string(),
      product: z.string(),
      recordType: z.string(),
      candidateRefs: z.array(z.string()),
      matchedIdentifiers: z.array(z.string()),
      status: z.enum(["pending", "accepted", "rejected"]),
      createdAt: z.string(),
    }),
  ),
});

const suggestionQueues = new Map<string, Promise<unknown>>();
function serializeSuggestionFile<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const prior = suggestionQueues.get(filePath) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(operation);
  suggestionQueues.set(filePath, next);
  void next.then(
    () => {
      if (suggestionQueues.get(filePath) === next) suggestionQueues.delete(filePath);
    },
    () => {
      if (suggestionQueues.get(filePath) === next) suggestionQueues.delete(filePath);
    },
  );
  return next;
}

export { formatResourceRef, normalizeEntityIdentifiers, parseResourceRef };

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

async function persistSuggestions(
  filePath: string,
  incoming: EntityLinkSuggestion[],
): Promise<void> {
  if (incoming.length === 0) return;
  await serializeSuggestionFile(filePath, async () => {
    let existing: EntityLinkSuggestion[] = [];
    try {
      existing = (
        await readJsonConfig(filePath, SuggestionFile, () => ({
          schema: 1 as const,
          suggestions: [],
        }))
      ).config.suggestions;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    const byID = new Map(existing.map((suggestion) => [suggestion.id, suggestion]));
    for (const suggestion of incoming) {
      if (!byID.has(suggestion.id)) byID.set(suggestion.id, suggestion);
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeJsonAtomic(filePath, { schema: 1, suggestions: [...byID.values()] });
  });
}

export async function listEntityLinkSuggestions(workDir: string): Promise<EntityLinkSuggestion[]> {
  const filePath = path.join(workDir, "config", "entity-link-suggestions.json");
  try {
    return (
      await readJsonConfig(filePath, SuggestionFile, () => ({
        schema: 1 as const,
        suggestions: [],
      }))
    ).config.suggestions;
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
  return serializeSuggestionFile(filePath, async () => {
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

    suggestions[index] = {
      ...current,
      status: input.decision === "accept" ? "accepted" : "rejected",
    };
    await writeJsonAtomic(filePath, { schema: 1, suggestions });
    return suggestions[index];
  });
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
  const grouped = new Map<
    string,
    Array<{ record: ProductEntityRecord; ref: string; matches: string[] }>
  >();
  for (const record of input.records) {
    const ref = formatResourceRef(record);
    const matches = identifierMatches(
      entityIdentifiers,
      normalizeEntityIdentifiers(record.identifiers),
    );
    if (matches.length === 0) continue;
    const key = `${record.product.toLowerCase()}:${record.type.toLowerCase()}`;
    const group = grouped.get(key) ?? [];
    group.push({ record, ref, matches });
    grouped.set(key, group);
  }

  const refs = new Set(
    ensured.identity.resourceRefs.map((ref) => formatResourceRef(parseResourceRef(ref))),
  );
  const linkedRefs: string[] = [];
  const suggestions: EntityLinkSuggestion[] = [];
  const matchedProducts = new Set<string>();
  for (const [key, candidates] of grouped) {
    const [product, recordType] = key.split(":", 2);
    matchedProducts.add(product);
    const uniqueCandidates = [
      ...new Map(candidates.map((candidate) => [candidate.ref, candidate])).values(),
    ];
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
      matchedIdentifiers: [
        ...new Set(uniqueCandidates.flatMap((candidate) => candidate.matches)),
      ].sort(),
      status: "pending",
      createdAt: (input.now ?? new Date()).toISOString(),
    });
  }

  const entity = await updateEntityIdentity(input.filePath, knowledgeDir, {
    resourceRefs: [...refs],
    identifiers: entityIdentifiers,
  });
  await persistSuggestions(
    path.join(input.workDir, "config", "entity-link-suggestions.json"),
    suggestions,
  );
  const allProducts = new Set(input.records.map((record) => record.product.toLowerCase()));
  return {
    entity,
    linkedRefs: [...new Set(linkedRefs)].sort(),
    unlinkedProducts: [...allProducts].filter((product) => !matchedProducts.has(product)).sort(),
    suggestions,
  };
}
