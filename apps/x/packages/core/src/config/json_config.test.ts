import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { ensureJsonConfig, parseJsonConfig, readJsonConfig } from "./json_config.js";

/**
 * Every config repo was written as `Schema.parse(JSON.parse(raw))`, with an
 * `ensureConfig()` that only checked the file *existed*. A file corrupt,
 * truncated by a crash mid-write, or hand-edited into the wrong shape therefore
 * made every read throw, forever, with no path back.
 *
 * models.json did exactly that: every background service resolves its model
 * through one of these reads, so one bad file failed email labeling, the
 * knowledge graph, agent notes and memory on every poll. Three sibling repos
 * still had the same shape.
 */

const DIR = "/tmp/rowboat-json-config-test";
const Schema = z.object({ agents: z.record(z.string(), z.number()) });
const defaults = () => ({ agents: {} });
const file = path.join(DIR, "conf.json");

beforeEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
  await fs.mkdir(DIR, { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe("parseJsonConfig", () => {
  it("returns the parsed value when the file is valid", () => {
    const { config, problem } = parseJsonConfig('{"agents":{"a":1}}', Schema, defaults());
    expect(config).toEqual({ agents: { a: 1 } });
    expect(problem).toBeNull();
  });

  it("falls back rather than throwing on malformed JSON", () => {
    const { config, problem } = parseJsonConfig("{ not json", Schema, defaults());
    expect(config).toEqual({ agents: {} });
    expect(problem).toMatch(/not valid JSON/);
  });

  it("falls back rather than throwing on the wrong shape", () => {
    const { config, problem } = parseJsonConfig('{"agents":"nope"}', Schema, defaults());
    expect(config).toEqual({ agents: {} });
    expect(problem).toContain("agents");
  });
});

describe("readJsonConfig", () => {
  it("treats a missing file as first run, not a problem", async () => {
    const { config, problem } = await readJsonConfig(file, Schema, defaults);
    expect(config).toEqual({ agents: {} });
    expect(problem).toBeNull();
  });

  it("never throws on an unusable file", async () => {
    await fs.writeFile(file, "{{{");
    const { config, problem } = await readJsonConfig(file, Schema, defaults);
    expect(config).toEqual({ agents: {} });
    expect(problem).toBeTruthy();
  });
});

describe("ensureJsonConfig", () => {
  it("creates the file when absent", async () => {
    expect(await ensureJsonConfig(file, Schema, defaults, "Test")).toBeNull();
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ agents: {} });
  });

  it("leaves a valid file untouched", async () => {
    await fs.writeFile(file, '{"agents":{"a":1}}');
    expect(await ensureJsonConfig(file, Schema, defaults, "Test")).toBeNull();
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ agents: { a: 1 } });
  });

  // The original is the only copy of whatever the user meant to configure.
  it("quarantines an unusable file instead of overwriting it", async () => {
    await fs.writeFile(file, '{"agents":"wrong"}');

    const quarantined = await ensureJsonConfig(file, Schema, defaults, "Test");

    expect(quarantined).toBeTruthy();
    expect(await fs.readFile(quarantined!, "utf8")).toBe('{"agents":"wrong"}');
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ agents: {} });
  });
});
