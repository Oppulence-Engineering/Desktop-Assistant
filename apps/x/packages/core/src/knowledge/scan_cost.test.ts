import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

// vi.hoisted runs before imports, so this has to be a literal.
const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-scan-cost-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));


/**
 * These scanners run on 10- and 15-second polls over every unprocessed email,
 * and both read each file in full to answer a question that needs far less.
 * Measured on a real workspace: 1,408 files and 41MB per pass for the labeling
 * scan alone — about 10GB an hour of disk traffic to check whether files start
 * with "---".
 *
 * The cost is invisible from the outside (nothing fails, the laptop just gets
 * warm), so it is pinned here.
 */

const GMAIL = path.join(TEST_WORKDIR, "gmail_sync");

function writeEmail(name: string, body: string, mtimeMs?: number): string {
  const p = path.join(GMAIL, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mtimeMs !== undefined) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

beforeEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(GMAIL, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("startsWithFrontmatter", () => {
  it("detects a frontmatter fence", async () => {
    const { hasFrontmatter: startsWithFrontmatter } = await import("./frontmatter.js");
    expect(startsWithFrontmatter(writeEmail("a.md", "---\nlabel: x\n---\nbody"))).toBe(true);
  });

  it("passes a file that has none", async () => {
    const { hasFrontmatter: startsWithFrontmatter } = await import("./frontmatter.js");
    expect(startsWithFrontmatter(writeEmail("b.md", "### From: a@b.com\nhi"))).toBe(false);
  });

  it("reads bytes, not the file", async () => {
    const { hasFrontmatter: startsWithFrontmatter } = await import("./frontmatter.js");
    const big = writeEmail("big.md", "x".repeat(2_000_000));
    const slurp = vi.spyOn(fs, "readFileSync");

    expect(startsWithFrontmatter(big)).toBe(false);

    expect(slurp, "the whole file was read to check three characters").not.toHaveBeenCalled();
  });

  it("treats an unreadable file as skippable rather than throwing", async () => {
    // Deliberately the labeler's wrapper, not the leaf: the two want opposite
    // fallbacks for an unreadable file, and this pins the labeler's ("skip").
    const { startsWithFrontmatter } = await import("./label_emails.js");
    expect(startsWithFrontmatter(path.join(GMAIL, "does-not-exist.md"))).toBe(true);
  });
});

describe("findUserSentEmails", () => {
  const state = { processedEmails: {}, processedRuns: {}, lastRunTime: "" };

  it("returns the newest matching emails, newest first", async () => {
    const { findUserSentEmails } = await import("./agent_notes.js");
    writeEmail("old.md", "### From: me@x.co\nold", 1_000_000_000_000);
    writeEmail("new.md", "### From: me@x.co\nnew", 2_000_000_000_000);
    writeEmail("other.md", "### From: someone@else.com\nno", 3_000_000_000_000);

    const found = await findUserSentEmails(structuredClone(state), "me@x.co", 5);
    expect(found.map((p) => path.basename(p))).toEqual(["new.md", "old.md"]);
  });

  // The point: it must stop reading once it has enough, rather than slurping
  // every unprocessed email on every 10-second tick to keep five of them.
  it("stops reading once it has enough matches", async () => {
    const { findUserSentEmails } = await import("./agent_notes.js");
    for (let i = 0; i < 20; i++) {
      writeEmail(`m${i}.md`, "### From: me@x.co\nhi", 1_000_000_000_000 + i * 1000);
    }
    const slurp = vi.spyOn(fs, "readFileSync");

    const found = await findUserSentEmails(structuredClone(state), "me@x.co", 3);

    expect(found).toHaveLength(3);
    expect(slurp.mock.calls.length, "read more files than it kept").toBeLessThanOrEqual(3);
  });

  it("skips files already processed without reading them", async () => {
    const { findUserSentEmails } = await import("./agent_notes.js");
    const done = writeEmail("done.md", "### From: me@x.co\nhi", 3_000_000_000_000);
    writeEmail("todo.md", "### From: me@x.co\nhi", 1_000_000_000_000);

    const found = await findUserSentEmails(
      { ...structuredClone(state), processedEmails: { [done]: { processedAt: "" } } },
      "me@x.co",
      5,
    );
    expect(found.map((p) => path.basename(p))).toEqual(["todo.md"]);
  });
});
