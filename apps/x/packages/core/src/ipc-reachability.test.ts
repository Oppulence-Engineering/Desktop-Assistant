import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every IPC channel with a handler must have a caller.
 *
 * An audit found seven channels that were fully built — schema, handler, core
 * implementation — and unreachable from the UI. Semantic search over the whole
 * vault, the MCP tool list, dictation paste, plan revision: all shipped, none
 * usable. Nothing failed, so nothing surfaced it; the capability just was not
 * there as far as anyone using the app could tell.
 *
 * A handler with no caller is either unfinished work or a leftover, and both
 * are worth noticing at the moment they appear rather than in an audit months
 * later.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(appRoot, rel), "utf8");
}

/** Channel names as they appear in a `"name:thing"` string literal. */
const CHANNEL_LITERAL = /["'][a-z][a-zA-Z]*:[a-zA-Z]+["']/g;

function literalsIn(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of read(file).matchAll(CHANNEL_LITERAL)) {
      found.add(match[0].slice(1, -1));
    }
  }
  return found;
}

/** Every .ts/.tsx under a directory, so a new caller file counts automatically. */
function sourcesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(appRoot, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(next);
    }
  };
  walk(rel);
  return out;
}

describe("IPC channels are reachable", () => {
  const schema = read("packages/shared/src/ipc.ts");
  const declared = [...schema.matchAll(/^\s*"([a-z][a-zA-Z]*:[a-zA-Z]+)":\s*\{/gm)].map(
    (m) => m[1],
  );
  const handlers = literalsIn(["apps/main/src/ipc.ts"]);
  const callers = literalsIn([
    ...sourcesUnder("apps/renderer/src"),
    ...sourcesUnder("packages/core/src"),
  ]);

  it("finds the channel table", () => {
    // Guard the guard: a refactor that changes the schema shape would otherwise
    // make every assertion below vacuously true.
    expect(declared.length).toBeGreaterThan(100);
    expect(handlers.size).toBeGreaterThan(100);
  });

  it("has no handler without a caller", () => {
    const orphans = declared.filter((c) => handlers.has(c) && !callers.has(c));
    expect(
      orphans,
      `built but unreachable from the UI — surface them or remove them: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});
