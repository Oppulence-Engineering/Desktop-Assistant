import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { readJsonConfig } from "../config/json_config.js";

export const ENTITY_PROJECTION_FIELDS = [
  "id",
  "kind",
  "displayName",
  "resourceRefs",
  "identifiers",
  "oneLineSummary",
] as const;

const EntityConfigSchema = z.object({
  sharedSpine: z.boolean().default(false),
  projectionFields: z.array(z.enum(ENTITY_PROJECTION_FIELDS)).default([...ENTITY_PROJECTION_FIELDS]),
  resolveOnSync: z.boolean().default(true),
});

export type EntityConfig = z.infer<typeof EntityConfigSchema>;
export const DEFAULT_ENTITY_CONFIG: EntityConfig = {
  sharedSpine: false,
  projectionFields: [...ENTITY_PROJECTION_FIELDS],
  resolveOnSync: true,
};

export function entityConfigPath(workDir: string): string {
  return path.join(workDir, "config", "entity.json");
}

export async function ensureEntityConfig(workDir: string): Promise<EntityConfig> {
  const filePath = entityConfigPath(workDir);
  try {
    const { config } = await readJsonConfig(filePath, EntityConfigSchema, () => DEFAULT_ENTITY_CONFIG);
    return config;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeJsonAtomic(filePath, DEFAULT_ENTITY_CONFIG);
    return { ...DEFAULT_ENTITY_CONFIG, projectionFields: [...ENTITY_PROJECTION_FIELDS] };
  }
}

export async function readEntityConfig(workDir: string): Promise<EntityConfig> {
  return ensureEntityConfig(workDir);
}
