import { BrowserWindow, app, autoUpdater } from "electron";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import {
  decideInstall,
  shouldBroadcast,
  shouldCheck,
  unsupportedReason,
  type InstallDecision,
  type UpdateStatus,
} from "@x/core/dist/updates/update-policy.js";
import { peekMeetingController } from "./meeting-controller.js";

/**
 * Auto-update, surfaced in the app instead of in an OS dialog.
 *
 * `update-electron-app` still owns the feed and the polling schedule — this
 * module only takes over *telling the user*. It runs with `notifyUser: false`
 * so the native "A new version is available" dialog never appears; the renderer
 * shows an in-app prompt driven by the status broadcast here.
 *
 * The distinction that matters to a user is "downloading" vs "ready", not
 * whether a release exists. Squirrel downloads on its own as soon as a check
 * finds something, so `update-available` is not yet actionable — only
 * `update-downloaded` is, because that is the point where restarting is
 * instant. Prompting any earlier asks someone to wait without saying so.
 *
 * The decisions live in @x/core/updates/update-policy so they can be tested;
 * this file is the Electron wiring around them.
 */

const UPDATE_REPO = "Oppulence-Engineering/Desktop-Assistant";

let status: UpdateStatus = { state: "idle" };
let initialized = false;

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:updateStatus", status);
  }
}

function setStatus(next: UpdateStatus): void {
  const announce = shouldBroadcast(status, next);
  status = next;
  if (announce) broadcast();
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function initUpdates(): void {
  if (initialized) return;
  initialized = true;

  const reason = unsupportedReason({ isPackaged: app.isPackaged, platform: process.platform });
  if (reason) {
    setStatus({ state: "unsupported", detail: reason });
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking", lastCheckedAt: status.lastCheckedAt });
  });
  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "idle", lastCheckedAt: Date.now() });
  });
  autoUpdater.on("update-available", () => {
    // Squirrel is downloading now. Nothing for the user to do yet, but settings
    // says so rather than sitting on "checking" for minutes.
    setStatus({ state: "downloading", lastCheckedAt: Date.now() });
  });
  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    setStatus({ state: "ready", version: releaseName, lastCheckedAt: Date.now() });
  });
  autoUpdater.on("error", (err) => {
    // A failed check is not worth interrupting anyone over — it retries on the
    // next tick. Recorded so settings can be honest when someone goes looking.
    setStatus({
      state: "error",
      detail: err instanceof Error ? err.message : String(err),
      lastCheckedAt: Date.now(),
    });
  });

  updateElectronApp({
    updateSource: { type: UpdateSourceType.ElectronPublicUpdateService, repo: UPDATE_REPO },
    // The whole point: no native dialog. The renderer prompt replaces it.
    notifyUser: false,
  });
}

/** Manual check, for the button in settings. */
export function checkForUpdates(): UpdateStatus {
  if (!shouldCheck(status.state)) return status;
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    setStatus({
      state: "error",
      detail: err instanceof Error ? err.message : String(err),
      lastCheckedAt: Date.now(),
    });
  }
  return status;
}

/** Restart into the downloaded update, unless something is being captured. */
export function installUpdate(): InstallDecision {
  const controller = peekMeetingController();
  const decision = decideInstall({
    state: status.state,
    recording: controller?.recording ?? false,
    standingBy: controller?.standingBy ?? false,
  });
  if (decision.installed) autoUpdater.quitAndInstall();
  return decision;
}
