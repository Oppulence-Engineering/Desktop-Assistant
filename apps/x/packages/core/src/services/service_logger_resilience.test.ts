import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-logger-resilience-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));
vi.mock("./service_bus.js", () => ({ serviceBus: { publish: async () => {} } }));

import { ServiceLogger } from "./service_logger.js";

/**
 * The write queue must never be left rejected.
 *
 * `writeQueue.then(fn)` on a rejected promise does not run fn — it propagates
 * the rejection — so one failure (a full disk, a transient EMFILE opening the
 * stream) would make every later log() skip its work and reject too. Service
 * logging would be dead for the rest of the process from a single bad moment,
 * and Data health would just stop updating with nothing to say why.
 *
 * Callers also `await serviceLogger.log(...)` inside their own try/catch, so a
 * rejection would be reported as a failure of the work being logged.
 */

const LOG_FILE = path.join(TEST_WORKDIR, "logs", "services.jsonl");

function event(message: string) {
  return { type: "run_start", service: "memory", runId: "r1", level: "info", message } as never;
}

async function readLog(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    try {
      return await fsp.readFile(LOG_FILE, "utf8");
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return "";
}

beforeEach(async () => {
  await fsp.rm(TEST_WORKDIR, { recursive: true, force: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("ServiceLogger write queue", () => {
  it("keeps logging after a failure opening the stream", async () => {
    const real = fs.createWriteStream;
    let failed = false;
    vi.spyOn(fs, "createWriteStream").mockImplementation(((...args: unknown[]) => {
      if (!failed) {
        failed = true;
        throw new Error("EMFILE: too many open files");
      }
      return (real as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof fs.createWriteStream);

    const logger = new ServiceLogger();
    await logger.log(event("first — lost to the failure"));
    await logger.log(event("second — must still be written"));

    expect(await readLog()).toContain("second — must still be written");
  });

  // The failing call itself must not reject: callers await this inside the
  // try/catch that guards their real work.
  it("does not reject the caller when a write fails", async () => {
    vi.spyOn(fs, "createWriteStream").mockImplementation((() => {
      throw new Error("ENOSPC: no space left on device");
    }) as unknown as typeof fs.createWriteStream);

    const logger = new ServiceLogger();
    await expect(logger.log(event("into the void"))).resolves.toBeUndefined();
  });

  it("reports one console error per outage, not one per event", async () => {
    vi.spyOn(fs, "createWriteStream").mockImplementation((() => {
      throw new Error("ENOSPC");
    }) as unknown as typeof fs.createWriteStream);

    const logger = new ServiceLogger();
    for (let i = 0; i < 5; i++) await logger.log(event(`drop ${i}`));

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("writes normally when nothing is wrong", async () => {
    const logger = new ServiceLogger();
    await logger.log(event("hello"));
    expect(await readLog()).toContain("hello");
  });
});

/**
 * Rotation creates a second stream. Attaching the error handler at only one of
 * the two creation sites meant every log written after the first rotation was
 * back to failing silently into a dead handle.
 */
describe("stream creation", () => {
  it("attaches an error handler to every stream it opens, including after rotation", async () => {
    const src = await fsp.readFile(
      new URL("./service_logger.ts", import.meta.url),
      "utf8",
    );
    const creations = src.match(/fs\.createWriteStream\(/g) ?? [];
    expect(
      creations.length,
      "a second createWriteStream call site can silently skip the error handler; " +
        "route it through openStream() instead",
    ).toBe(1);
    expect(src).toMatch(/private openStream\(\)/);
  });
});
