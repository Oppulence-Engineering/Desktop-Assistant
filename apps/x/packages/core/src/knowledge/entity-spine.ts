import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { splitFrontmatter } from "../application/lib/parse-frontmatter.js";
import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { readEntityConfig } from "./entity-config.js";
import { readJsonConfig } from "../config/json_config.js";
import { isEntityId, updateEntityIdentity } from "./entity-identity.js";
import { parseResourceRef } from "./entity-resolver.js";

const ProjectionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  displayName: z.string().max(200),
  resourceRefs: z.array(z.string()),
  identifiers: z.record(z.string(), z.array(z.string())),
  oneLineSummary: z.string().max(500).optional(),
}).strict();
const EntityViewSchema = ProjectionSchema.extend({
  canonicalEntityId: z.string().optional(),
  status: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
}).passthrough();

export type EntityProjection = z.infer<typeof ProjectionSchema>;
interface OutboxItem { id: string; notePath: string; projection: EntityProjection; queuedAt: string; attempts: number }
const OutboxSchema = z.object({ schema: z.literal(1), items: z.array(z.object({
  id: z.string(), notePath: z.string(), projection: ProjectionSchema, queuedAt: z.string(), attempts: z.number().int().nonnegative(),
})) });

const queues = new Map<string, Promise<unknown>>();
function serialize<T>(workDir: string, operation: () => Promise<T>): Promise<T> {
  const prior = queues.get(workDir) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(operation);
  queues.set(workDir, next);
  void next.finally(() => { if (queues.get(workDir) === next) queues.delete(workDir); });
  return next;
}
function outboxPath(workDir: string): string { return path.join(workDir, "config", "entity-projection-outbox.json"); }
async function readOutbox(workDir: string): Promise<OutboxItem[]> {
  try { return (await readJsonConfig(outboxPath(workDir), OutboxSchema, () => ({ schema: 1 as const, items: [] }))).config.items; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []; throw cause; }
}
async function saveOutbox(workDir: string, items: OutboxItem[]): Promise<void> {
  await fs.mkdir(path.join(workDir, "config"), { recursive: true });
  await writeJsonAtomic(outboxPath(workDir), { schema: 1, items });
}
function hashIdentifier(value: string): string {
  const canonical = value.trim().normalize("NFKC").toLowerCase();
  return `sha256:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}
function privateIdentifiers(raw: Record<string, unknown>): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const values = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (values.length) output[key] = [...new Set(values.map(hashIdentifier))].sort();
  }
  return output;
}

/** Build the only payload allowed to leave the device. Identifier values are one-way hashed. */
export async function buildEntityProjection(notePath: string, _workDir: string): Promise<EntityProjection | undefined> {
  const content = await fs.readFile(notePath, "utf8");
  const { frontmatter } = splitFrontmatter(content);
  if (typeof frontmatter.id !== "string" || typeof frontmatter.kind !== "string") return undefined;
  const resourceRefs = Array.isArray(frontmatter.resourceRefs)
    ? [...new Set(frontmatter.resourceRefs.filter((v): v is string => typeof v === "string").map((v) => {
        parseResourceRef(v); return v;
      }))].sort()
    : [];
  const display = [frontmatter.displayName, frontmatter.name, frontmatter.title]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const summary = [frontmatter.oneLineSummary, frontmatter.summary]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  return ProjectionSchema.parse({
    id: frontmatter.id,
    kind: frontmatter.kind,
    displayName: (display?.trim() || path.basename(notePath, path.extname(notePath))).slice(0, 200),
    resourceRefs,
    identifiers: privateIdentifiers(
      frontmatter.identifiers && typeof frontmatter.identifiers === "object" && !Array.isArray(frontmatter.identifiers)
        ? frontmatter.identifiers as Record<string, unknown> : {},
    ),
    ...(summary ? { oneLineSummary: summary.trim().replace(/\s+/g, " ").slice(0, 500) } : {}),
  });
}

export async function enqueueEntityProjection(notePath: string, workDir: string): Promise<boolean> {
  const config = await readEntityConfig(workDir);
  if (!config.sharedSpine) return false;
  const projection = await buildEntityProjection(notePath, workDir);
  if (!projection) return false;
  await serialize(workDir, async () => {
    const items = await readOutbox(workDir);
    const item: OutboxItem = { id: projection.id, notePath: path.relative(workDir, notePath), projection, queuedAt: new Date().toISOString(), attempts: 0 };
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) items[index] = item; else items.push(item);
    if (items.length > 10_000) items.splice(0, items.length - 10_000);
    await saveOutbox(workDir, items);
  });
  return true;
}

export interface EntitySpineClient {
  put(projection: EntityProjection): Promise<{ canonicalId?: string }>;
  get(id: string): Promise<EntityProjection | undefined>;
  resolve(ref: string): Promise<EntityProjection | undefined>;
}

export function createEntitySpineClient(deps: { fetch?: typeof fetch; accessToken?: () => Promise<string>; apiURL?: string } = {}): EntitySpineClient {
  const request = deps.fetch ?? fetch;
  const token = deps.accessToken ?? getAccessToken;
  const base = deps.apiURL ?? API_URL;
  async function call(url: string, init?: RequestInit): Promise<Response> {
    const bearer = await token();
    return request(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(5_000), headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, ...init?.headers } });
  }
  return {
    async put(projection) {
      const response = await call(`${base}/v1/entities/${encodeURIComponent(projection.id)}`, { method: "PUT", body: JSON.stringify(ProjectionSchema.parse(projection)) });
      if (!response.ok) throw new Error(`entity spine upsert failed: ${response.status}`);
      const body = await response.json().catch(() => ({})) as { canonicalEntityId?: string };
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

export async function flushEntityProjectionOutbox(workDir: string, client = createEntitySpineClient()): Promise<{ sent: number; remaining: number }> {
  return serialize(workDir, async () => {
    const items = await readOutbox(workDir);
    let sent = 0;
    const remaining: OutboxItem[] = [];
    for (const item of items.slice(0, 100)) {
      try {
        const response = await client.put(item.projection);
        if (response.canonicalId && response.canonicalId !== item.projection.id) {
          if (!isEntityId(response.canonicalId)) throw new Error("server returned invalid canonical entity id");
          await updateEntityIdentity(path.join(workDir, item.notePath), path.join(workDir, "knowledge"), { id: response.canonicalId });
        }
        sent += 1;
      } catch {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    remaining.push(...items.slice(100));
    await saveOutbox(workDir, remaining);
    return { sent, remaining: remaining.length };
  });
}

export async function syncEntityNotes(notePaths: Iterable<string>, workDir: string, client?: EntitySpineClient): Promise<void> {
  try {
    for (const notePath of notePaths) await enqueueEntityProjection(path.isAbsolute(notePath) ? notePath : path.join(workDir, notePath), workDir);
    await flushEntityProjectionOutbox(workDir, client);
  } catch { /* local graph ingestion must not depend on cloud availability */ }
}
