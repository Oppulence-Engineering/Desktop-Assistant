import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-events-prune-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { pruneDoneEvents } from "./processor.js";

/**
 * events/done was write-only: every processed event is re-serialized there —
 * enriched, so larger than its pending copy — and nothing ever read or deleted
 * one. Gmail sync alone emits an event every 30 seconds carrying up to ten
 * full thread markdowns, which is how a real install reached 14MB of files no
 * code path can see. pending/ drains correctly; only done/ leaked.
 */

const DONE = path.join(TEST_WORKDIR, "events", "done");
const PENDING = path.join(TEST_WORKDIR, "events", "pending");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function doneEvent(name: string, ageDays: number, dir: string = DONE): string {
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(p, "{}");
  const t = (NOW - ageDays * DAY) / 1000;
  fs.utimesSync(p, t, t);
  return p;
}

beforeEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(DONE, { recursive: true });
  fs.mkdirSync(PENDING, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("pruneDoneEvents", () => {
  it("removes events older than a week and reports the count", () => {
    for (let i = 0; i < 6; i++) doneEvent(`old-${i}`, 8 + i);
    doneEvent("recent", 2);

    expect(pruneDoneEvents(NOW)).toBe(6);
    expect(fs.readdirSync(DONE)).toEqual(["recent.json"]);
  });

  it("keeps everything inside the window", () => {
    for (let i = 0; i < 5; i++) doneEvent(`fresh-${i}`, i);
    expect(pruneDoneEvents(NOW)).toBe(0);
    expect(fs.readdirSync(DONE)).toHaveLength(5);
  });

  // pending/ is the live queue — retention must never touch it, however stale
  // an entry looks (a wedged consumer is a bug to fix, not data to delete).
  it("never touches pending events", () => {
    const stale = doneEvent("stuck", 30, PENDING);
    doneEvent("old", 30);

    pruneDoneEvents(NOW);

    expect(fs.existsSync(stale)).toBe(true);
    expect(fs.readdirSync(DONE)).toEqual([]);
  });

  it("returns quietly when the directory does not exist", () => {
    fs.rmSync(path.join(TEST_WORKDIR, "events"), { recursive: true, force: true });
    expect(pruneDoneEvents(NOW)).toBe(0);
  });
});
