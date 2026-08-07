import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import fs from "fs/promises";
import path from "path";
import {
  NotificationsConfigSchema,
  type NotificationsConfig,
} from "@x/shared/dist/notifications.js";
import { WorkDir } from "./config.js";

// Notification preferences (RFC 006): the offline-return OS-notification
// opt-in and the quit-reminder suppression flag. Follows the transcription
// config pattern (voice.ts): tolerant read → schema defaults, and patches
// only override keys the caller explicitly set so toggling one preference
// never clobbers the other.

function notificationsConfigPath(): string {
  return path.join(WorkDir, "config", "notifications.json");
}

/** The effective notifications config; schema defaults when the file is
 * absent or unreadable. Always returns a value. */
export async function getNotificationsConfig(): Promise<NotificationsConfig> {
  try {
    const raw = await fs.readFile(notificationsConfigPath(), "utf8");
    return NotificationsConfigSchema.parse(JSON.parse(raw));
  } catch {
    return NotificationsConfigSchema.parse({});
  }
}

export interface NotificationsConfigPatch {
  cloudRunsOfflineNotify?: boolean;
  suppressDesktopScheduleQuitReminder?: boolean;
}

/** Persist `notifications.json`, merging a partial update over the current
 * config. */
export async function setNotificationsConfig(
  patch: NotificationsConfigPatch,
): Promise<NotificationsConfig> {
  const current = await getNotificationsConfig();
  const next = NotificationsConfigSchema.parse({
    ...current,
    ...(patch.cloudRunsOfflineNotify !== undefined
      ? { cloudRunsOfflineNotify: patch.cloudRunsOfflineNotify }
      : {}),
    ...(patch.suppressDesktopScheduleQuitReminder !== undefined
      ? { suppressDesktopScheduleQuitReminder: patch.suppressDesktopScheduleQuitReminder }
      : {}),
  });
  const configPath = notificationsConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeJsonAtomic(configPath, next);
  return next;
}
