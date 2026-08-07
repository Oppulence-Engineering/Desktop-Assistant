import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic, writeJsonAtomicSync } from "./atomic_write.js";

/**
 * A bare writeFileSync truncates the target first and fills it after, so a
 * crash in between leaves torn JSON — and every state loader here answers a
 * corrupt file with fresh state, turning that torn write into a silent full
 * re-sync or re-label. The helper writes a sibling tmp and renames, so readers
 * only ever see a complete file. Atomicity itself is rename(2)'s contract;
 * what these tests pin is the helper's observable behavior around it.
 */

const DIR = "/tmp/rowboat-atomic-write-test";
const FILE = path.join(DIR, "state.json");

beforeEach(async () => {
  await fsp.rm(DIR, { recursive: true, force: true });
  await fsp.mkdir(DIR, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe.each([
  // async wrapper so the sync variant's throws become rejections the shared
  // assertions can consume
  ["writeJsonAtomicSync", async (f: string, v: unknown, s?: number) =>
    s === undefined ? writeJsonAtomicSync(f, v) : writeJsonAtomicSync(f, v, s)],
  ["writeJsonAtomic", (f: string, v: unknown, s?: number) =>
    s === undefined ? writeJsonAtomic(f, v) : writeJsonAtomic(f, v, s)],
] as const)("%s", (_name, write) => {
  it("round-trips a value", async () => {
    await write(FILE, { agents: { a: 1 }, list: [1, 2, 3] });
    expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ agents: { a: 1 }, list: [1, 2, 3] });
  });

  it("replaces an existing file completely", async () => {
    fs.writeFileSync(FILE, JSON.stringify({ old: "x".repeat(10_000) }));
    await write(FILE, { fresh: true });
    expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ fresh: true });
  });

  // The whole point of the tmp: it must never be left behind, success or not —
  // a later glob or confused reader must not find a half-written sibling.
  it("leaves no tmp file after a successful write", async () => {
    await write(FILE, { ok: 1 });
    expect(fs.readdirSync(DIR)).toEqual(["state.json"]);
  });

  it("leaves no tmp file when the write fails, and does not touch the target", async () => {
    fs.writeFileSync(FILE, JSON.stringify({ precious: true }));
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws before anything hits disk

    await expect(write(FILE, circular)).rejects.toBeTruthy();

    expect(fs.readdirSync(DIR)).toEqual(["state.json"]);
    expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ precious: true });
  });

  it("fails loudly when the directory does not exist, rather than inventing it", async () => {
    await expect(write(path.join(DIR, "nope", "x.json"), {})).rejects.toBeTruthy();
  });

  it("honours compact spacing for the size-sensitive caches", async () => {
    await write(FILE, { a: 1 }, 0);
    expect(fs.readFileSync(FILE, "utf8")).toBe('{"a":1}');
  });
});

/**
 * Two writers to one path, in one process, is the case the pid-only tmp path
 * got wrong: both would open `${file}.${pid}.tmp`, interleave into it, and both
 * rename it into place — splicing two JSON documents into one file. Concurrent
 * writers are not hypothetical here (two permission grants approved in the same
 * tick, several scheduled agents updating state), which is why the helper needs
 * a per-call tmp rather than a per-process one.
 */
describe("concurrent writers to the same path", () => {
  it("leaves exactly one of the two documents, intact", async () => {
    const a = { writer: "a", filler: "a".repeat(20_000) };
    const b = { writer: "b", filler: "b".repeat(20_000) };

    await Promise.all([writeJsonAtomic(FILE, a), writeJsonAtomic(FILE, b)]);

    // Parses at all — a spliced file would throw here.
    const result = JSON.parse(fs.readFileSync(FILE, "utf8"));
    expect(["a", "b"]).toContain(result.writer);
    expect(result).toEqual(result.writer === "a" ? a : b);
  });

  it("leaves no tmp files behind after concurrent writes", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => writeJsonAtomic(FILE, { n: i, filler: "x".repeat(5_000) })),
    );
    expect(fs.readdirSync(DIR)).toEqual(["state.json"]);
  });

  it("gives each call its own tmp path", async () => {
    // Two writes to *different* targets must not collide either; a shared tmp
    // would show up as a leftover or a lost file.
    const other = path.join(DIR, "other.json");
    await Promise.all([writeJsonAtomic(FILE, { a: 1 }), writeJsonAtomic(other, { b: 2 })]);
    expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ a: 1 });
    expect(JSON.parse(fs.readFileSync(other, "utf8"))).toEqual({ b: 2 });
    expect(fs.readdirSync(DIR).sort()).toEqual(["other.json", "state.json"]);
  });
});
