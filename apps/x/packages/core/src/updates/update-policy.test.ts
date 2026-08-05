import { describe, expect, it } from "vitest";
import {
  decideInstall,
  shouldBroadcast,
  shouldCheck,
  unsupportedReason,
  updatePending,
  updateReady,
} from "./update-policy.js";

describe("updatePending — when a user should know a new version exists", () => {
  it("is true while still downloading, not only once installable", () => {
    // The point of the distinction: waiting for `ready` means a slow link or a
    // download that never finishes tells the user nothing at all.
    expect(updatePending({ state: "downloading" })).toBe(true);
  });

  it("is true when ready", () => {
    expect(updatePending({ state: "ready" })).toBe(true);
  });

  it("reads correctly before any version number is known", () => {
    // Electron's `update-available` carries no version, so anything driven by
    // this must not depend on one being present.
    expect(updatePending({ state: "downloading" })).toBe(true);
    expect(updateReady({ state: "downloading" })).toBe(false);
  });

  it("is false for every state where nothing new exists", () => {
    for (const state of ["idle", "checking", "error", "unsupported"] as const) {
      expect(updatePending({ state })).toBe(false);
    }
  });

  it("separates knowing from acting", () => {
    // `downloading` is information; `ready` is a decision. Both surface, but
    // only one should interrupt.
    expect(updatePending({ state: "downloading" })).toBe(true);
    expect(updateReady({ state: "downloading" })).toBe(false);
    expect(updateReady({ state: "ready" })).toBe(true);
  });
});

describe("unsupportedReason", () => {
  it("allows updates for a packaged mac build", () => {
    expect(unsupportedReason({ isPackaged: true, platform: "darwin" })).toBeNull();
  });

  it("allows updates for a packaged windows build", () => {
    expect(unsupportedReason({ isPackaged: true, platform: "win32" })).toBeNull();
  });

  it("declines on linux, where autoUpdater has no implementation", () => {
    // Calling into autoUpdater here throws; the point is to never get there.
    expect(unsupportedReason({ isPackaged: true, platform: "linux" })).toMatch(/package manager/i);
  });

  it("declines in a dev build regardless of platform", () => {
    expect(unsupportedReason({ isPackaged: false, platform: "darwin" })).toMatch(/installed builds/i);
  });
});

describe("shouldBroadcast", () => {
  it("announces a state change", () => {
    expect(shouldBroadcast({ state: "idle" }, { state: "ready" })).toBe(true);
  });

  it("announces a newer version even in the same state", () => {
    expect(
      shouldBroadcast({ state: "ready", version: "0.1.25" }, { state: "ready", version: "0.1.26" }),
    ).toBe(true);
  });

  it("stays quiet when only the check timestamp moved", () => {
    // Squirrel polls on a timer — this is the common case, all day long.
    expect(
      shouldBroadcast({ state: "idle", lastCheckedAt: 1 }, { state: "idle", lastCheckedAt: 2 }),
    ).toBe(false);
  });
});

describe("decideInstall", () => {
  it("installs when an update is ready and nothing is capturing", () => {
    expect(decideInstall({ state: "ready", recording: false, standingBy: false })).toEqual({
      installed: true,
    });
  });

  it("refuses mid-recording rather than truncating the meeting", () => {
    // quitAndInstall bypasses the close reminder, so this is the only guard.
    const d = decideInstall({ state: "ready", recording: true, standingBy: false });
    expect(d.installed).toBe(false);
    expect(d).toMatchObject({ reason: expect.stringMatching(/stop the recording/i) });
  });

  it("refuses in standby, when the session is armed to capture", () => {
    expect(decideInstall({ state: "ready", recording: false, standingBy: true }).installed).toBe(
      false,
    );
  });

  it("refuses when nothing has been downloaded yet", () => {
    const d = decideInstall({ state: "downloading", recording: false, standingBy: false });
    expect(d).toMatchObject({ installed: false, reason: expect.stringMatching(/not?t? ready|yet/i) });
  });

  it("gives a reason whenever it refuses, so the caller never invents one", () => {
    for (const state of ["idle", "checking", "downloading", "error", "unsupported"] as const) {
      const d = decideInstall({ state, recording: false, standingBy: false });
      expect(d.installed).toBe(false);
      expect("reason" in d && d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("shouldCheck", () => {
  it("checks from idle and after an error", () => {
    expect(shouldCheck("idle")).toBe(true);
    expect(shouldCheck("error")).toBe(true);
  });

  it("does not re-check what is already downloaded or in flight", () => {
    expect(shouldCheck("ready")).toBe(false);
    expect(shouldCheck("checking")).toBe(false);
  });

  it("never reaches the network where updates cannot apply", () => {
    expect(shouldCheck("unsupported")).toBe(false);
  });
});
