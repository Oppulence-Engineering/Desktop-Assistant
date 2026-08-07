import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-livenote-traversal-test");
vi.mock("../../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  deleteLiveNote,
  fetchLiveNote,
  listLiveNotes,
  patchLiveNote,
  setLiveNote,
} from "./fileops.js";

/**
 * `absPath` joined a caller-supplied path onto the knowledge directory with no
 * check, and every operation here reads or rewrites the target's frontmatter.
 * The path arrives from the `live-note:*` IPC channels and from the
 * `run-live-note-agent` builtin tool, neither of which constrains it.
 *
 * The guard cannot be a basename or single-segment rule: nested notes with
 * spaces are the norm in a real vault ("Organizations/Healthie.md",
 * "Projects/Super Life v3.md"), and the scheduler, the event consumer and the
 * note list all address them that way. The legitimate cases below are what pin
 * the guard as not-too-strict.
 */

const KNOWLEDGE = path.join(TEST_WORKDIR, "knowledge");
const LIVE = { objective: "track the thing" } as never;

function noteWithLiveBlock(relPath: string): string {
  const abs = path.join(KNOWLEDGE, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "---\nlive:\n  objective: seed\n---\n\nbody\n");
  return abs;
}

beforeEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(KNOWLEDGE, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("absPath traversal", () => {
  it("refuses to write outside the knowledge directory", async () => {
    const outside = path.join(TEST_WORKDIR, "escape.md");
    await expect(setLiveNote("../escape.md", LIVE)).rejects.toThrow();
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("refuses to rewrite a file that exists outside, leaving it untouched", async () => {
    const victim = path.join(TEST_WORKDIR, "victim.md");
    fs.writeFileSync(victim, "---\nlive:\n  objective: theirs\n---\n\nkeep\n");

    await expect(patchLiveNote("../victim.md", { objective: "mine" } as never)).rejects.toThrow();

    expect(fs.readFileSync(victim, "utf8")).toContain("objective: theirs");
  });

  it("refuses an absolute path", async () => {
    await expect(setLiveNote("/tmp/rowboat-absolute.md", LIVE)).rejects.toThrow();
    expect(fs.existsSync("/tmp/rowboat-absolute.md")).toBe(false);
  });

  it("refuses to delete outside, and the file survives", async () => {
    const victim = path.join(TEST_WORKDIR, "deleteme.md");
    fs.writeFileSync(victim, "content");
    await expect(deleteLiveNote("../deleteme.md")).rejects.toThrow();
    expect(fs.existsSync(victim)).toBe(true);
  });

  it("refuses a traversal that only appears after normalization", async () => {
    const victim = path.join(TEST_WORKDIR, "sneaky.md");
    fs.writeFileSync(victim, "content");
    // fetchLiveNote swallows into null, so assert the file was never opened for
    // rewrite rather than on the return value.
    expect(await fetchLiveNote("a/../../sneaky.md")).toBeNull();
    expect(fs.readFileSync(victim, "utf8")).toBe("content");
  });
});

describe("absPath keeps every legitimate note reachable", () => {
  it("reads a note at the knowledge root", async () => {
    noteWithLiveBlock("Inbox.md");
    expect(await fetchLiveNote("Inbox.md")).not.toBeNull();
  });

  // The case a basename guard would have broken.
  it("reads and rewrites a nested note whose name contains spaces", async () => {
    const rel = "Projects/Super Life v3.md";
    noteWithLiveBlock(rel);

    expect(await fetchLiveNote(rel)).not.toBeNull();
    await patchLiveNote(rel, { objective: "updated" } as never);

    expect(fs.readFileSync(path.join(KNOWLEDGE, rel), "utf8")).toContain("updated");
  });

  it("every path listLiveNotes returns can be fetched back", async () => {
    noteWithLiveBlock("Organizations/Healthie.md");
    noteWithLiveBlock("Inbox.md");

    const listed = await listLiveNotes();
    expect(listed.length).toBeGreaterThanOrEqual(2);
    for (const note of listed) {
      const rel = note.path.replace(/^knowledge\//, "");
      expect(await fetchLiveNote(rel), `${rel} listed but not fetchable`).not.toBeNull();
    }
  });
});
