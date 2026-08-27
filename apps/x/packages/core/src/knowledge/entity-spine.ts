import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { splitFrontmatter } from "../application/lib/parse-frontmatter.js";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { readEntityConfig } from "./entity-config.js";
import { readJsonConfig } from "../config/json_config.js";
import type { LifecycleService } from "../services/lifecycle.js";
import {
  captureEntityIdentities,
  isEntityId,
  readEntityIdentity,
  updateEntityIdentity,
} from "./entity-identity.js";
import {
  formatResourceRef,
  normalizeEntityIdentifiers,
  parseResourceRef,
} from "./entity-reference.js";
import { readEntityRecords, reconcileEntityNote } from "./entity-resolver.js";

const ProjectionSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    displayName: z.string().max(200).optional(),
    resourceRefs: z.array(z.string()).optional(),
    identifiers: z.record(z.string(), z.array(z.string())).optional(),
    oneLineSummary: z.string().max(500).optional(),
  })
  .strict();
const EntityViewSchema = ProjectionSchema.extend({
  canonicalEntityId: z.string().optional(),
  status: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
}).passthrough();

export type EntityProjection = z.infer<typeof ProjectionSchema>;
interface OutboxItem {
  id: string;
  notePath: string;
  projection: EntityProjection;
  queuedAt: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
}
const OutboxSchema = z.object({
  schema: z.literal(1),
  items: z.array(
    z.object({
      id: z.string(),
      notePath: z.string(),
      projection: ProjectionSchema,
      queuedAt: z.string(),
      attempts: z.number().int().nonnegative(),
      nextAttemptAt: z.string().optional(),
      lastError: z.string().optional(),
    }),
  ),
});
const DeadLetterSchema = z.object({
  schema: z.literal(1),
  items: z.array(
    OutboxSchema.shape.items.element.extend({
      failedAt: z.string(),
      reason: z.string(),
      status: z.number().int().optional(),
    }),
  ),
});
const SpineHealthSchema = z.object({
  schema: z.literal(1),
  status: z.enum(["healthy", "degraded"]),
  remaining: z.number().int().nonnegative(),
  deadLetters: z.number().int().nonnegative(),
  lastAttemptAt: z.string(),
  lastError: z.string().optional(),
});
export type EntitySpineHealth = Omit<z.infer<typeof SpineHealthSchema>, "schema">;
const CanonicalConflictSchema = z.object({
  schema: z.literal(1),
  conflicts: z.array(
    z.object({
      localEntityId: z.string(),
      canonicalEntityId: z.string(),
      notePath: z.string(),
      existingNotePath: z.string(),
      detectedAt: z.string(),
    }),
  ),
});

const queues = new Map<string, Promise<unknown>>();
function serialize<T>(workDir: string, operation: () => Promise<T>): Promise<T> {
  const prior = queues.get(workDir) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(operation);
  queues.set(workDir, next);
  void next.then(
    () => {
      if (queues.get(workDir) === next) queues.delete(workDir);
    },
    () => {
      if (queues.get(workDir) === next) queues.delete(workDir);
    },
  );
  return next;
}
function outboxPath(workDir: string): string {
  return path.join(workDir, "config", "entity-projection-outbox.json");
}
function deadLetterPath(workDir: string): string {
  return path.join(workDir, "config", "entity-projection-dead-letter.json");
}
function healthPath(workDir: string): string {
  return path.join(workDir, "config", "entity-spine-health.json");
}
function canonicalConflictPath(workDir: string): string {
  return path.join(workDir, "config", "entity-canonical-conflicts.json");
}
async function readOutbox(workDir: string): Promise<OutboxItem[]> {
  try {
    return (
      await readJsonConfig(outboxPath(workDir), OutboxSchema, () => ({
        schema: 1 as const,
        items: [],
      }))
    ).config.items;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
async function saveOutbox(workDir: string, items: OutboxItem[]): Promise<void> {
  await fs.mkdir(path.join(workDir, "config"), { recursive: true });
  await writeJsonAtomic(outboxPath(workDir), { schema: 1, items });
}
async function readDeadLetters(
  workDir: string,
): Promise<z.infer<typeof DeadLetterSchema>["items"]> {
  try {
    return (
      await readJsonConfig(deadLetterPath(workDir), DeadLetterSchema, () => ({
        schema: 1 as const,
        items: [],
      }))
    ).config.items;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
async function saveHealth(
  workDir: string,
  input: Omit<z.infer<typeof SpineHealthSchema>, "schema" | "lastAttemptAt">,
): Promise<void> {
  await fs.mkdir(path.join(workDir, "config"), { recursive: true });
  await writeJsonAtomic(healthPath(workDir), {
    schema: 1,
    lastAttemptAt: new Date().toISOString(),
    ...input,
  });
}

/** Read durable sync health for the user-facing remediation surface. */
export async function getEntitySpineHealth(workDir: string): Promise<EntitySpineHealth> {
  try {
    const { schema: _schema, ...health } = (
      await readJsonConfig(healthPath(workDir), SpineHealthSchema, () => ({
        schema: 1 as const,
        status: "healthy" as const,
        remaining: 0,
        deadLetters: 0,
        lastAttemptAt: new Date(0).toISOString(),
      }))
    ).config;
    return health;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "healthy",
        remaining: 0,
        deadLetters: 0,
        lastAttemptAt: new Date(0).toISOString(),
      };
    }
    throw cause;
  }
}
async function quarantine(
  workDir: string,
  item: OutboxItem,
  reason: string,
  status?: number,
): Promise<number> {
  await fs.mkdir(path.join(workDir, "config"), { recursive: true });
  const items = await readDeadLetters(workDir);
  const failed = {
    ...item,
    failedAt: new Date().toISOString(),
    reason,
    ...(status ? { status } : {}),
  };
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) items[index] = failed;
  else items.push(failed);
  await writeJsonAtomic(deadLetterPath(workDir), { schema: 1, items: items.slice(-10_000) });
  return items.length;
}
function hashIdentifier(value: string): string {
  const canonical = value.trim().normalize("NFKC").toLowerCase();
  return `sha256:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}
function privateIdentifiers(raw: Record<string, unknown>): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  const stringValues: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const values = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (values.length) stringValues[key] = values;
  }
  for (const [key, values] of Object.entries(normalizeEntityIdentifiers(stringValues))) {
    if (values.length) output[key] = [...new Set(values.map(hashIdentifier))].sort();
  }
  return output;
}

/** Build the only payload allowed to leave the device. Identifier values are one-way hashed. */
export async function buildEntityProjection(
  notePath: string,
  workDir: string,
): Promise<EntityProjection | undefined> {
  const config = await readEntityConfig(workDir);
  const fields = new Set(config.projectionFields);
  const content = await fs.readFile(notePath, "utf8");
  const { frontmatter } = splitFrontmatter(content);
  if (typeof frontmatter.id !== "string" || typeof frontmatter.kind !== "string") return undefined;
  const resourceRefs = Array.isArray(frontmatter.resourceRefs)
    ? [
        ...new Set(
          frontmatter.resourceRefs
            .filter((v): v is string => typeof v === "string")
            .map((v) => {
              return formatResourceRef(parseResourceRef(v));
            }),
        ),
      ].sort()
    : [];
  const display = [frontmatter.displayName, frontmatter.name, frontmatter.title].find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  const summary = [frontmatter.oneLineSummary, frontmatter.summary].find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  return ProjectionSchema.parse({
    id: frontmatter.id,
    kind: frontmatter.kind,
    ...(fields.has("displayName")
      ? {
          displayName: (display?.trim() || path.basename(notePath, path.extname(notePath))).slice(
            0,
            200,
          ),
        }
      : {}),
    ...(fields.has("resourceRefs") ? { resourceRefs } : {}),
    ...(fields.has("identifiers")
      ? {
          identifiers: privateIdentifiers(
            frontmatter.identifiers &&
              typeof frontmatter.identifiers === "object" &&
              !Array.isArray(frontmatter.identifiers)
              ? (frontmatter.identifiers as Record<string, unknown>)
              : {},
          ),
        }
      : {}),
    ...(fields.has("oneLineSummary") && summary
      ? { oneLineSummary: summary.trim().replace(/\s+/g, " ").slice(0, 500) }
      : {}),
  });
}

export async function enqueueEntityProjection(notePath: string, workDir: string): Promise<boolean> {
  const config = await readEntityConfig(workDir);
  if (!config.sharedSpine) return false;
  const projection = await buildEntityProjection(notePath, workDir);
  if (!projection) return false;
  await serialize(workDir, async () => {
    const items = await readOutbox(workDir);
    const item: OutboxItem = {
      id: projection.id,
      notePath: path.relative(workDir, notePath),
      projection,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) items[index] = item;
    else {
      if (items.length >= 10_000) {
        const deadLetters = (await readDeadLetters(workDir)).length;
        await saveHealth(workDir, {
          status: "degraded",
          remaining: items.length,
          deadLetters,
          lastError: "entity projection outbox is full",
        });
        throw new Error("entity projection outbox is full");
      }
      items.push(item);
    }
    await saveOutbox(workDir, items);
  });
  return true;
}

export interface EntitySpineClient {
  put(projection: EntityProjection): Promise<{ canonicalId?: string }>;
  get(id: string): Promise<EntityProjection | undefined>;
  resolve(ref: string): Promise<EntityProjection | undefined>;
}

class EntitySpineHTTPError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  get permanent(): boolean {
    return [400, 404, 409, 413, 415, 422].includes(this.status);
  }
}

class CanonicalEntityConflictError extends Error {}

let configuredClient: EntitySpineClient | undefined;

/** Configure the authenticated cloud client without coupling local graph code to the auth container. */
export function configureEntitySpineClient(client: EntitySpineClient): void {
  configuredClient = client;
}

export function createEntitySpineClient(deps: {
  fetch?: typeof fetch;
  accessToken: () => Promise<string>;
  apiURL: string;
}): EntitySpineClient {
  const request = deps.fetch ?? fetch;
  const token = deps.accessToken;
  const base = deps.apiURL;
  async function call(url: string, init?: RequestInit): Promise<Response> {
    const bearer = await token();
    return request(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(5_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
        ...init?.headers,
      },
    });
  }
  return {
    async put(projection) {
      const response = await call(`${base}/v1/entities/${encodeURIComponent(projection.id)}`, {
        method: "PUT",
        body: JSON.stringify(ProjectionSchema.parse(projection)),
      });
      if (!response.ok) {
        throw new EntitySpineHTTPError(
          `entity spine upsert failed: ${response.status}`,
          response.status,
        );
      }
      const body = (await response.json().catch(() => ({}))) as { canonicalEntityId?: string };
      return { canonicalId: body.canonicalEntityId };
    },
    async get(id) {
      const response = await call(`${base}/v1/entities/${encodeURIComponent(id)}`);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`entity spine get failed: ${response.status}`);
      return EntityViewSchema.parse(await response.json());
    },
    async resolve(ref) {
      parseResourceRef(ref);
      const response = await call(`${base}/v1/entities?ref=${encodeURIComponent(ref)}`);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`entity spine resolve failed: ${response.status}`);
      return EntityViewSchema.parse(await response.json());
    },
  };
}

export async function flushEntityProjectionOutbox(
  workDir: string,
  client = configuredClient,
): Promise<{ sent: number; remaining: number }> {
  return serialize(workDir, async () => {
    const items = await readOutbox(workDir);
    if (!client) return { sent: 0, remaining: items.length };
    let sent = 0;
    let deadLetters = (await readDeadLetters(workDir)).length;
    let lastError: string | undefined;
    const remaining: OutboxItem[] = [];
    const batch = items.slice(0, 100);
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) {
        remaining.push(item);
        continue;
      }
      try {
        const response = await client.put(item.projection);
        if (response.canonicalId && response.canonicalId !== item.projection.id) {
          if (!isEntityId(response.canonicalId))
            throw new Error("server returned invalid canonical entity id");
          const identities = await captureEntityIdentities(path.join(workDir, "knowledge"));
          const currentPath = path.resolve(workDir, item.notePath);
          const owner = [...identities.entries()].find(
            ([notePath, identity]) =>
              path.resolve(notePath) !== currentPath && identity.id === response.canonicalId,
          );
          if (owner) {
            const conflictFile = canonicalConflictPath(workDir);
            let conflicts: z.infer<typeof CanonicalConflictSchema>["conflicts"] = [];
            try {
              conflicts = (
                await readJsonConfig(conflictFile, CanonicalConflictSchema, () => ({
                  schema: 1 as const,
                  conflicts: [],
                }))
              ).config.conflicts;
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
            }
            const conflict = {
              localEntityId: item.projection.id,
              canonicalEntityId: response.canonicalId,
              notePath: item.notePath,
              existingNotePath: path.relative(workDir, owner[0]),
              detectedAt: new Date().toISOString(),
            };
            const conflictIndex = conflicts.findIndex(
              (entry) =>
                entry.localEntityId === conflict.localEntityId &&
                entry.canonicalEntityId === conflict.canonicalEntityId,
            );
            if (conflictIndex >= 0) conflicts[conflictIndex] = conflict;
            else conflicts.push(conflict);
            await writeJsonAtomic(conflictFile, { schema: 1, conflicts });
            throw new CanonicalEntityConflictError(
              "canonical entity id already belongs to another local note",
            );
          }
          await updateEntityIdentity(
            path.join(workDir, item.notePath),
            path.join(workDir, "knowledge"),
            { id: response.canonicalId },
          );
        }
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        if (
          (error instanceof EntitySpineHTTPError && error.permanent) ||
          error instanceof CanonicalEntityConflictError
        ) {
          deadLetters = await quarantine(
            workDir,
            item,
            message,
            error instanceof EntitySpineHTTPError ? error.status : undefined,
          );
          continue;
        }
        const attempts = item.attempts + 1;
        const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 6));
        remaining.push({
          ...item,
          attempts,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
        });
        if (!(error instanceof EntitySpineHTTPError) || !error.permanent) {
          remaining.push(...batch.slice(index + 1));
          break;
        }
      }
    }
    remaining.push(...items.slice(100));
    await saveOutbox(workDir, remaining);
    await saveHealth(workDir, {
      status: remaining.length > 0 || deadLetters > 0 ? "degraded" : "healthy",
      remaining: remaining.length,
      deadLetters,
      ...(lastError ? { lastError } : {}),
    });
    return { sent, remaining: remaining.length };
  });
}

/** Lifecycle-owned replay so reconnects recover during idle sessions and shutdown is deterministic. */
export function createEntitySpineReplayService(
  workDir: string,
  client?: EntitySpineClient,
  intervalMs = 30_000,
): LifecycleService {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  const delay = Math.max(1_000, intervalMs);
  const schedule = (signal: AbortSignal) => {
    if (stopped || signal.aborted) return;
    timer = setTimeout(() => {
      void flushEntityProjectionOutbox(workDir, client)
        .catch((error) => {
          console.error("[EntitySpine] Scheduled projection replay failed:", error);
        })
        .finally(() => schedule(signal));
    }, delay);
    timer.unref?.();
  };
  return {
    name: "entity-spine-replay",
    start(signal) {
      stopped = false;
      signal.addEventListener("abort", () => this.stop(), { once: true });
      schedule(signal);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export async function syncEntityNotes(
  notePaths: Iterable<string>,
  workDir: string,
  client?: EntitySpineClient,
): Promise<void> {
  try {
    const config = await readEntityConfig(workDir);
    for (const notePath of notePaths) {
      const filePath = path.isAbsolute(notePath) ? notePath : path.join(workDir, notePath);
      try {
        if (config.resolveOnSync) {
          const current = await readEntityIdentity(filePath, path.join(workDir, "knowledge"));
          if (current) {
            await reconcileEntityNote({
              filePath,
              workDir,
              records: await readEntityRecords(current.identifiers),
            });
          }
        }
        await enqueueEntityProjection(filePath, workDir);
      } catch (error) {
        console.error(`[EntitySpine] Could not reconcile or enqueue ${filePath}:`, error);
      }
    }
    await flushEntityProjectionOutbox(workDir, client);
  } catch (error) {
    // Local graph ingestion must not depend on cloud availability, but failed
    // durable sync remains observable and its queue is never discarded.
    console.error("[EntitySpine] Projection sync deferred:", error);
  }
}

/** Resume a durable offline queue and seed enabled shared-spine sync on startup. */
export async function resumeEntitySpineSync(
  workDir: string,
  client?: EntitySpineClient,
): Promise<{ sent: number; remaining: number }> {
  const config = await readEntityConfig(workDir);
  if (!config.sharedSpine) return { sent: 0, remaining: 0 };
  const identities = await captureEntityIdentities(path.join(workDir, "knowledge"));
  for (const notePath of identities.keys()) await enqueueEntityProjection(notePath, workDir);
  return flushEntityProjectionOutbox(workDir, client);
}
