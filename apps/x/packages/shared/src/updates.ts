import { z } from "zod";

/**
 * Auto-update status, shared by every process that touches it.
 *
 * Lives in `shared` because all three need it and none may reach the others:
 * main produces it, the IPC layer validates it, and the renderer renders it.
 */
export const UpdateStatusSchema = z.object({
  state: z.enum(["unsupported", "idle", "checking", "downloading", "ready", "error"]),
  /** The version being offered. Only known once downloaded — see `updatePending`. */
  version: z.string().optional(),
  /** Why it's unsupported, or what failed. Never the whole user-facing message. */
  detail: z.string().optional(),
  /** Epoch ms of the last check that completed, successfully or not. */
  lastCheckedAt: z.number().optional(),
});

export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type UpdateStatusName = UpdateStatus["state"];

/**
 * Whether a new version exists that the user does not have yet.
 *
 * Deliberately true while still `downloading`, not just when `ready`. Someone
 * should learn a new version exists when we learn it — waiting for the download
 * to finish means a slow link or a failed download tells them nothing at all.
 * What changes between the two is the *ask*: `downloading` is information,
 * `ready` is a decision. Both are worth surfacing; only one interrupts.
 *
 * Note that Electron's `update-available` event carries no version number, so
 * anything driven by this must read correctly with `version` still undefined.
 */
export function updatePending(status: Pick<UpdateStatus, "state">): boolean {
  return status.state === "downloading" || status.state === "ready";
}

/** Whether the update is installable right now, pending the main-process guards. */
export function updateReady(status: Pick<UpdateStatus, "state">): boolean {
  return status.state === "ready";
}
