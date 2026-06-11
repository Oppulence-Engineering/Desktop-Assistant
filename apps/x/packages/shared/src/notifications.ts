import z from "zod";

// ---------------------------------------------------------------------------
// Notification preferences (RFC 006)
// ---------------------------------------------------------------------------
//
// Persisted at `$WorkDir/config/notifications.json`. Both flags default OFF:
// OS notifications are an explicit opt-in (RFC 006 decision — never
// default-on), and the quit reminder shows until the user suppresses it.

export const NotificationsConfigSchema = z.object({
  version: z.literal(1).default(1),
  // Show a system notification when cloud runs finished while the app was
  // closed (in addition to the in-app toast). Opt-in.
  cloudRunsOfflineNotify: z.boolean().default(false),
  // "Don't remind me again" on the desktop-schedule quit reminder.
  suppressDesktopScheduleQuitReminder: z.boolean().default(false),
});
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
