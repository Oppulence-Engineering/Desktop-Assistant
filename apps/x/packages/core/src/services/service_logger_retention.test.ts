import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-log-retention-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { pruneRotatedLogs } from "./service_logger.js";

/**
 * The logger rotated at 10MB and never deleted anything. A real install had
 * 52 files and 516MB sitting in this directory, and during an incident — when
 * every poll writes errors — it rotates about every half hour, so the folder
 * grew roughly half a gigabyte a day for as long as the fault lasted.
 *
 * A log directory that grows without bound is a second failure stacked on the
 * first, and it outlives the one that caused it.
 */

const DIR = path.join(TEST_WORKDIR, "logs");

async function rotatedFile(name: string, mtimeMs: number): Promise<string> {
  const p = path.join(DIR, name);
  await fs.writeFile(p, "{}\n");
  await fs.utimes(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

beforeEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true });
  await fs.mkdir(DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("pruneRotatedLogs", () => {
  it("keeps the ten newest rotated logs and removes the rest", async () => {
    for (let i = 0; i < 25; i++) {
      await rotatedFile(`services.2026-08-0${(i % 9) + 1}T0${i % 10}-00-00-000Z.jsonl`, 1e12 + i * 1000);
    }
    const removed = await pruneRotatedLogs(DIR);

    const left = (await fs.readdir(DIR)).filter((f) => f !== "services.jsonl");
    expect(left).toHaveLength(10);
    expect(removed).toHaveLength(15);
  });

  it("removes the oldest, not an arbitrary ten", async () => {
    const oldest = await rotatedFile("services.old.jsonl", 1_000);
    const newest: string[] = [];
    for (let i = 0; i < 12; i++) {
      newest.push(await rotatedFile(`services.n${i}.jsonl`, 9_000_000_000_000 + i));
    }
    await pruneRotatedLogs(DIR);

    await expect(fs.access(oldest)).rejects.toBeTruthy();
    // The two newest of the twelve survive alongside the rest of the window.
    await expect(fs.access(newest[11])).resolves.toBeUndefined();
  });

  // Deleting the file currently being written to would lose the live log and
  // leave the stream writing into an unlinked inode.
  it("never touches the active log file", async () => {
    const active = path.join(DIR, "services.jsonl");
    await fs.writeFile(active, "live\n");
    for (let i = 0; i < 20; i++) await rotatedFile(`services.r${i}.jsonl`, 1e12 + i);

    await pruneRotatedLogs(DIR);

    expect(await fs.readFile(active, "utf8")).toBe("live\n");
  });

  it("does nothing when the directory is under the limit", async () => {
    for (let i = 0; i < 4; i++) await rotatedFile(`services.k${i}.jsonl`, 1e12 + i);
    expect(await pruneRotatedLogs(DIR)).toEqual([]);
    expect(await fs.readdir(DIR)).toHaveLength(4);
  });

  // Pruning runs on the logging path; it must never be able to stop it.
  it("returns quietly when the directory does not exist", async () => {
    expect(await pruneRotatedLogs(path.join(TEST_WORKDIR, "nope"))).toEqual([]);
  });

  it("leaves unrelated files alone", async () => {
    await fs.writeFile(path.join(DIR, "notes.txt"), "keep me");
    for (let i = 0; i < 20; i++) await rotatedFile(`services.z${i}.jsonl`, 1e12 + i);

    await pruneRotatedLogs(DIR);

    expect(await fs.readFile(path.join(DIR, "notes.txt"), "utf8")).toBe("keep me");
  });
});
