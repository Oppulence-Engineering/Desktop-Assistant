/**
 * Update decisions, kept free of Electron so they can be tested.
 *
 * The main process owns the `autoUpdater` wiring; the judgement calls — whether
 * an update path exists at all, whether a status change is worth telling anyone
 * about, and whether restarting right now is safe — live here.
 */

import type { UpdateStatus, UpdateStatusName } from "@x/shared/dist/updates.js";

export type { UpdateStatus, UpdateStatusName };
export { updatePending, updateReady } from "@x/shared/dist/updates.js";

/**
 * Why updates can't apply here, or null when they can.
 *
 * Both cases are ordinary, not broken: an unpackaged build has no feed, and
 * Electron ships no Squirrel implementation for Linux — calling `autoUpdater`
 * there throws. Naming the reason lets settings say something true instead of
 * showing a Check button that cannot work.
 */
export function unsupportedReason(env: {
  isPackaged: boolean;
  platform: NodeJS.Platform | string;
}): string | null {
  if (!env.isPackaged) return "Updates apply to installed builds only.";
  if (env.platform === "linux") return "Update from your package manager on Linux.";
  return null;
}

/** What the autoUpdater just told us. */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "not-available"; at: number }
  | { type: "available"; at: number }
  | { type: "downloaded"; at: number; version?: string }
  | { type: "error"; at: number; detail: string };

/**
 * Fold an autoUpdater event into the current status.
 *
 * The rule that makes this a function rather than five handlers: **`ready` is
 * sticky**. `update-electron-app` polls on an unconditional `setInterval` that
 * never stops after a download completes, so a staged update is followed ten
 * minutes later by `checking-for-update` and then `update-not-available`.
 * Folding those in naively walks a downloaded, installable update back to
 * `idle` — the dot disappears, settings claims you're up to date, and Restart
 * refuses, all while the update sits on disk waiting for a relaunch.
 *
 * Nothing un-stages a download except installing it, so nothing here may clear
 * `ready` either. Only a `downloaded` naming a *different* version supersedes
 * it, and a failed check leaves it alone — the update is still there.
 */
export function applyUpdateEvent(current: UpdateStatus, event: UpdateEvent): UpdateStatus {
  if (current.state === "ready") {
    if (event.type === "downloaded" && event.version !== current.version) {
      return { state: "ready", version: event.version, lastCheckedAt: event.at };
    }
    return current;
  }
  switch (event.type) {
    case "checking":
      // Carry the previous timestamp: a check in flight has not completed one.
      return { state: "checking", lastCheckedAt: current.lastCheckedAt };
    case "not-available":
      return { state: "idle", lastCheckedAt: event.at };
    case "available":
      return { state: "downloading", lastCheckedAt: event.at };
    case "downloaded":
      return { state: "ready", version: event.version, lastCheckedAt: event.at };
    case "error":
      return { state: "error", detail: event.detail, lastCheckedAt: event.at };
  }
}

/**
 * Whether a status change is worth pushing to the renderer.
 *
 * Squirrel polls on a timer, so `checking → idle` repeats all day. Broadcasting
 * every one of those would wake the renderer for no news. A change in state or
 * in the version being offered is news; a new `lastCheckedAt` on its own is not.
 */
export function shouldBroadcast(prev: UpdateStatus, next: UpdateStatus): boolean {
  return prev.state !== next.state || prev.version !== next.version;
}

export type InstallDecision = { installed: true } | { installed: false; reason: string };

/**
 * Whether to restart into a downloaded update now.
 *
 * Refuses during capture. `quitAndInstall` deliberately bypasses the close
 * reminder (main routes `before-quit-for-update` straight to cleanup), so
 * nothing further downstream would stop it — and no update is worth truncating
 * a recording someone is relying on. Standby counts: the session is armed and
 * about to hold audio.
 */
export function decideInstall(input: {
  state: UpdateStatusName;
  recording: boolean;
  standingBy: boolean;
}): InstallDecision {
  if (input.state !== "ready") {
    return { installed: false, reason: "No update is ready to install yet." };
  }
  if (input.recording || input.standingBy) {
    return {
      installed: false,
      reason: "A meeting is being recorded. Stop the recording first, then restart to update.",
    };
  }
  return { installed: true };
}

/**
 * Whether a manual check should reach the network.
 *
 * Re-checking while one is in flight, while a download is running, or when a
 * build is already waiting only re-reports what the user can already see — and
 * mid-download it risks restarting a transfer that was going to finish. The
 * settings button is disabled in those states; this is the same rule enforced
 * where it can't be bypassed by calling the channel directly.
 */
export function shouldCheck(state: UpdateStatusName): boolean {
  return state === "idle" || state === "error";
}
