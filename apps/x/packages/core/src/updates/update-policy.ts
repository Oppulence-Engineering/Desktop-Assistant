/**
 * Update decisions, kept free of Electron so they can be tested.
 *
 * The main process owns the `autoUpdater` wiring; the judgement calls — whether
 * an update path exists at all, whether a status change is worth telling anyone
 * about, and whether restarting right now is safe — live here.
 */

export type UpdateStatusName =
  | "unsupported"
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateStatus {
  state: UpdateStatusName;
  version?: string;
  detail?: string;
  lastCheckedAt?: number;
}

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
 * Re-checking while one is in flight, or when a build is already downloaded and
 * waiting, only re-reports what the user can already see.
 */
export function shouldCheck(state: UpdateStatusName): boolean {
  return state !== "unsupported" && state !== "checking" && state !== "ready";
}
