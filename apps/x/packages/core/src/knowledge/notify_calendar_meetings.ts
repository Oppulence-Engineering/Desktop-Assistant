import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "../config/config.js";
import { CALENDAR_SYNC_DIR, listUpcomingEvents } from "./calendar_events.js";
import container from "../di/container.js";
import type { INotificationService } from "../application/notification/service.js";
import { DEEP_LINK_SCHEME } from "@x/shared/dist/branding.js";

const TICK_INTERVAL_MS = 30_000;
// Notify when an event is between 30s in the past (started just now) and
// 90s in the future (about to start). The window is wider than 60s so we
// don't miss an event if the tick lands slightly off the start time.
const NOTIFY_LEAD_MS = 90_000;
const NOTIFY_GRACE_MS = 30_000;
// Drop state entries older than 24h so the file doesn't grow forever.
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const STATE_FILE = path.join(WorkDir, "calendar_notifications_state.json");

interface NotificationState {
  notifiedEventIds: Record<string, { notifiedAt: string; startTime: string }>;
}

async function loadState(): Promise<NotificationState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.notifiedEventIds) {
      return parsed as NotificationState;
    }
  } catch {
    // No state file yet, or corrupt — start fresh.
  }
  return { notifiedEventIds: {} };
}

async function saveState(state: NotificationState): Promise<void> {
  // Write to a sibling tmp file then rename so a mid-write crash can't leave
  // the JSON corrupt — a corrupt state file would make every event in the
  // 90s notify window re-fire on next start.
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmp, STATE_FILE);
}

function gcState(state: NotificationState): NotificationState {
  const cutoff = Date.now() - STATE_TTL_MS;
  const fresh: NotificationState["notifiedEventIds"] = {};
  for (const [id, entry] of Object.entries(state.notifiedEventIds)) {
    const ts = Date.parse(entry.notifiedAt);
    if (Number.isFinite(ts) && ts >= cutoff) fresh[id] = entry;
  }
  return { notifiedEventIds: fresh };
}

async function tick(
  state: NotificationState,
): Promise<{ state: NotificationState; dirty: boolean }> {
  let service: INotificationService;
  try {
    service = container.resolve<INotificationService>("notificationService");
  } catch {
    // Notification service not registered yet (very early startup) — skip this tick.
    return { state, dirty: false };
  }
  if (!service.isSupported()) return { state, dirty: false };

  const now = Date.now();
  let dirty = false;

  // Cancelled, declined, all-day and unparseable events are already dropped by the
  // shared reader; the window is `[-grace, +lead]` around the start.
  const due = await listUpcomingEvents(
    { earliestMs: -NOTIFY_GRACE_MS, latestMs: NOTIFY_LEAD_MS, now },
    CALENDAR_SYNC_DIR,
  );

  for (const event of due) {
    // Files are named `${event.id}.json`, so this key matches every entry already
    // written to the state file — changing it would re-notify the whole window once.
    const eventId = event.id;
    if (state.notifiedEventIds[eventId]) continue;

    const summary = event.summary;
    const eid = encodeURIComponent(eventId);

    try {
      service.notify({
        title: "Upcoming meeting",
        message: `${summary} starts in 1 minute. Click to join and take notes.`,
        // Single labeled button — adding a secondary action would force
        // macOS to bundle them into an "Options" dropdown, hiding the
        // primary label.
        link: `${DEEP_LINK_SCHEME}://action?type=join-and-take-meeting-notes&eventId=${eid}`,
        actionLabel: "Join & Notes",
      });
      console.log(`[CalendarNotify] notified for "${summary}" (${eventId})`);
    } catch (err) {
      console.error(`[CalendarNotify] notify failed for ${eventId}:`, err);
      continue;
    }

    state.notifiedEventIds[eventId] = {
      notifiedAt: new Date().toISOString(),
      startTime: event.start.toISOString(),
    };
    dirty = true;
  }

  return { state, dirty };
}

export async function init(): Promise<void> {
  console.log("[CalendarNotify] starting calendar notification service");
  console.log(`[CalendarNotify] tick every ${TICK_INTERVAL_MS / 1000}s`);

  let state = gcState(await loadState());

  while (true) {
    try {
      const result = await tick(state);
      state = result.state;
      if (result.dirty) {
        state = gcState(state);
        try {
          await saveState(state);
        } catch (err) {
          console.error("[CalendarNotify] failed to save state:", err);
        }
      }
    } catch (err) {
      console.error("[CalendarNotify] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }
}
