// Memory index configuration (RFC 021). Read from WorkDir/config/index.json with
// env overrides; embeddings inherit the chat provider unless overridden.
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from '../config/config.js';

/**
 * User-tunable memory index settings. Each field is self-healing: a missing key
 * falls back via `.default(...)` and a present-but-invalid value falls back via
 * `.catch(...)`, so {@link loadMemoryConfig} can never throw on a bad config file
 * and always returns a fully-populated, valid config.
 */
export const MemoryConfig = z.object({
    /** Kill switch → retrieval falls back to lexical only. */
    enabled: z.boolean().default(true).catch(true),
    /** Embedding model identity; mismatch vs the manifest triggers a rebuild. */
    model: z.string().min(1).default('text-embedding-3-small').catch('text-embedding-3-small'),
    /** Vector dimensionality (0 = infer from the first embedding). */
    dims: z.number().int().nonnegative().default(0).catch(0),
    /** Chunks per embed request. */
    batchSize: z.number().int().positive().default(64).catch(64),
    /** Cost guard; 0 = no cap. Indexing pauses when the monthly token budget is hit. */
    maxMonthlyEmbedTokens: z.number().int().nonnegative().default(0).catch(0),
    /** Max chunks returned per source note (result diversity); 0 = no cap. */
    maxPerNote: z.number().int().nonnegative().default(2).catch(2),
    /** Recency tiebreaker weight in [0,1] applied to fused scores by note mtime;
     *  0 = off (default). Small values nudge recently-edited notes up at equal relevance. */
    recencyWeight: z.number().min(0).max(1).default(0).catch(0),
    /** Max characters in a result snippet (query-aware window). */
    snippetChars: z.number().int().positive().default(600).catch(600),
    /** Requested embedding dimensionality (Matryoshka); 0 = the provider's native size.
     *  Changing this triggers a rebuild (dims mismatch vs the manifest). */
    embedDimensions: z.number().int().nonnegative().default(0).catch(0),
    /** LLM query expansion / HyDE before retrieval; off by default (adds an LLM call). */
    queryExpansion: z.boolean().default(false).catch(false),
});
export type MemoryConfig = z.infer<typeof MemoryConfig>;

/** indexDir is the on-device store location, `WorkDir/index`. */
export function indexDir(): string {
    return path.join(WorkDir, 'index');
}

/** Path to the user config file (`WorkDir/config/index.json`). */
function configPath(): string {
    return path.join(WorkDir, 'config', 'index.json');
}

/**
 * loadMemoryConfig resolves the effective config as: file (if present and an
 * object) → per-field validation/fallback → env overrides. A missing, unreadable,
 * or non-object config file yields all defaults.
 *
 * Env overrides (applied last):
 * - `SOLOMON_MEMORY_ENABLED=false|0` → force `enabled: false`.
 * - `SOLOMON_MEMORY_MODEL` → override the embedding model.
 * - `SOLOMON_MEMORY_QUERY_EXPANSION=1|true` → force `queryExpansion: true`.
 * - `SOLOMON_MEMORY_RECENCY_WEIGHT` → override `recencyWeight` (parsed as a number).
 *
 * @returns A fully-populated, validated {@link MemoryConfig}.
 */
export function loadMemoryConfig(): MemoryConfig {
    const onDisk = MemoryConfig.safeParse(readConfigFile());
    // safeParse fails only when the file is absent/unreadable or its top-level
    // value is not an object; per-field `.catch()` handles bad individual fields.
    const cfg: MemoryConfig = onDisk.success ? onDisk.data : MemoryConfig.parse({});

    if (process.env.SOLOMON_MEMORY_ENABLED === 'false' || process.env.SOLOMON_MEMORY_ENABLED === '0') {
        cfg.enabled = false;
    }
    if (process.env.SOLOMON_MEMORY_MODEL) cfg.model = process.env.SOLOMON_MEMORY_MODEL;
    if (process.env.SOLOMON_MEMORY_QUERY_EXPANSION === '1' || process.env.SOLOMON_MEMORY_QUERY_EXPANSION === 'true') {
        cfg.queryExpansion = true;
    }
    const rw = Number(process.env.SOLOMON_MEMORY_RECENCY_WEIGHT);
    if (Number.isFinite(rw) && rw >= 0 && rw <= 1) cfg.recencyWeight = rw;
    return cfg;
}

/** readConfigFile reads + JSON-parses the config file, returning `undefined` on
 *  any error (no file / unreadable / invalid JSON) so the caller falls back to defaults. */
function readConfigFile(): unknown {
    try {
        return JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    } catch {
        return undefined;
    }
}
