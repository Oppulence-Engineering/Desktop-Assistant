import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workDir: string;

// Importing the config module pulls in WorkDir initialization, whose knowledge
// side effects (git init) can race the temp-dir cleanup — mock them out like
// every other core test that touches WorkDir.
function mockConfigSideEffects(): void {
  vi.doMock("../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solomon-notifications-test-"));
  workDir = path.join(tmpDir, "workspace");
  process.env.SOLOMON_WORKDIR = workDir;
  vi.resetModules();
  mockConfigSideEffects();
});

afterEach(async () => {
  delete process.env.SOLOMON_WORKDIR;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("notifications config (RFC 006)", () => {
  it("returns opt-out defaults when no file exists", async () => {
    const { getNotificationsConfig } = await import("./notifications.js");
    const cfg = await getNotificationsConfig();
    expect(cfg.cloudRunsOfflineNotify).toBe(false);
    expect(cfg.suppressDesktopScheduleQuitReminder).toBe(false);
  });

  it("patching one key preserves the other on disk", async () => {
    const { getNotificationsConfig, setNotificationsConfig } = await import("./notifications.js");
    await setNotificationsConfig({ cloudRunsOfflineNotify: true });
    await setNotificationsConfig({ suppressDesktopScheduleQuitReminder: true });

    const cfg = await getNotificationsConfig();
    expect(cfg.cloudRunsOfflineNotify).toBe(true);
    expect(cfg.suppressDesktopScheduleQuitReminder).toBe(true);

    // And flipping one back leaves the other untouched.
    const next = await setNotificationsConfig({ cloudRunsOfflineNotify: false });
    expect(next.cloudRunsOfflineNotify).toBe(false);
    expect(next.suppressDesktopScheduleQuitReminder).toBe(true);
  });

  it("falls back to defaults on corrupt JSON without throwing", async () => {
    await fs.mkdir(path.join(workDir, "config"), { recursive: true });
    await fs.writeFile(path.join(workDir, "config", "notifications.json"), "{not json", "utf8");
    const { getNotificationsConfig } = await import("./notifications.js");
    const cfg = await getNotificationsConfig();
    expect(cfg.cloudRunsOfflineNotify).toBe(false);
  });
});
