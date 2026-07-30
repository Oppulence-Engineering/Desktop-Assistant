import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

let workDir: string;

vi.mock("./config.js", () => ({
  get WorkDir() {
    return workDir;
  },
}));

const { getUiState, setUiState } = await import("./ui_state.js");

describe("ui_state", () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-state-"));
  });
  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  const file = () => path.join(workDir, "config", "ui_state.json");

  it("reads empty before anything is written", async () => {
    expect(await getUiState()).toEqual({});
  });

  it("creates the config directory on first write", async () => {
    await setUiState({ meetingCaptureCheckDone: true });
    expect((await getUiState()).meetingCaptureCheckDone).toBe(true);
  });

  it("merges rather than replaces, so two surfaces cannot clobber each other", async () => {
    await setUiState({ meetingCaptureCheckDone: true });
    // A flag this build does not know about must survive a write from one that does.
    await fs.writeFile(
      file(),
      JSON.stringify({ meetingCaptureCheckDone: true, someLaterFlag: "kept" }),
      "utf8",
    );
    await setUiState({ meetingCaptureCheckDone: false });
    const raw = JSON.parse(await fs.readFile(file(), "utf8"));
    expect(raw.someLaterFlag).toBe("kept");
    expect(raw.meetingCaptureCheckDone).toBe(false);
  });

  it("treats a corrupt file as unset rather than throwing", async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), "{ not json", "utf8");
    // A prompt shown twice beats a config read that throws during startup.
    expect(await getUiState()).toEqual({});
    await setUiState({ meetingCaptureCheckDone: true });
    expect((await getUiState()).meetingCaptureCheckDone).toBe(true);
  });

  it("ignores a value of the wrong type", async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), JSON.stringify({ meetingCaptureCheckDone: "yes" }), "utf8");
    expect(await getUiState()).toEqual({});
  });

  it("leaves no temp file behind", async () => {
    await setUiState({ meetingCaptureCheckDone: true });
    const names = await fs.readdir(path.dirname(file()));
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
