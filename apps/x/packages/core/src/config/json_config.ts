// Reading a JSON config file without letting a bad one take a feature down.
//
// Every config repo here was written the same way:
//
//     const raw = await fs.readFile(this.configPath, "utf8");
//     return Schema.parse(JSON.parse(raw));
//
// Both calls throw, and `ensureConfig()` only checks that the file *exists* —
// never that it parses. So a file that is corrupt, truncated by a crash mid-
// write, or hand-edited into the wrong shape makes every read throw, forever,
// with no path back.
//
// That is not hypothetical. models.json was found in a shape this app has never
// written, and because every background service resolves its model through one
// of these reads, it failed email labeling, the knowledge graph, agent notes
// and memory on every poll — thousands of identical errors an hour with nothing
// naming the cause. The same shape was still in three sibling repos.
//
// Defaults are better than an exception here because these files are all
// recreatable: a schedule, an MCP server list, per-agent timing state. Losing
// one costs a re-configuration. Throwing on every read costs the feature.
import fsp from "fs/promises";
import type { ZodType } from "zod";

export interface ParsedConfig<T> {
  config: T;
  /** Null when the file was valid as written; otherwise what was wrong with it. */
  problem: string | null;
}

/**
 * Parse config file contents against a schema, never throwing.
 *
 * @param raw - File contents.
 * @param schema - Zod schema for the config.
 * @param fallback - Value to use when the contents cannot be trusted.
 */
export function parseJsonConfig<T>(raw: string, schema: ZodType<T>, fallback: T): ParsedConfig<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { config: fallback, problem: `not valid JSON (${detail})` };
  }

  const result = schema.safeParse(parsed);
  if (result.success) return { config: result.data, problem: null };

  const problem = result.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  return { config: fallback, problem };
}

/**
 * Read a config file, falling back to defaults rather than throwing.
 *
 * A missing file is not a problem — it is the first run — so it reports no
 * `problem` and yields the defaults quietly.
 */
export async function readJsonConfig<T>(
  filePath: string,
  schema: ZodType<T>,
  fallback: () => T,
): Promise<ParsedConfig<T>> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    return { config: fallback(), problem: null };
  }
  return parseJsonConfig(raw, schema, fallback());
}

/**
 * Ensure a config file exists and is readable, repairing it if not.
 *
 * Startup is the one safe moment to rewrite one of these: doing it on every
 * read would race concurrent writers, and leaving it broken means each later
 * read re-derives the same fallback while any save lands on top of an unusable
 * base.
 *
 * The original is moved aside rather than overwritten — it is the only copy of
 * whatever the user meant to configure, and the path is logged so it can be
 * recovered by hand.
 *
 * @returns The quarantine path when a repair happened, else null.
 */
export async function ensureJsonConfig<T>(
  filePath: string,
  schema: ZodType<T>,
  fallback: () => T,
  label: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    await fsp.writeFile(filePath, JSON.stringify(fallback(), null, 2));
    return null;
  }

  const { config, problem } = parseJsonConfig(raw, schema, fallback());
  if (!problem) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${filePath}.invalid-${stamp}`;
  try {
    await fsp.rename(filePath, quarantinePath);
    await fsp.writeFile(filePath, JSON.stringify(config, null, 2));
    console.error(
      `[${label}] ${filePath} could not be read (${problem}). ` +
        `Moved it to ${quarantinePath} and rebuilt it from defaults.`,
    );
    return quarantinePath;
  } catch (error) {
    // Repair is best-effort; reads still fall back to defaults.
    console.error(`[${label}] Could not repair ${filePath}:`, error);
    return null;
  }
}
