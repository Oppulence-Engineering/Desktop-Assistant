import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "../config/config.js";
import { CALENDAR_SYNC_DIR, listUpcomingEvents } from "./calendar_events.js";
import type { ResolvedCalendarEvent } from "@x/shared/dist/calendar.js";
import container from "../di/container.js";
import type { INotificationService } from "../application/notification/service.js";
import { DEEP_LINK_SCHEME } from "@x/shared/dist/branding.js";

const TICK_INTERVAL_MS = 30_000;
// Notify when an event is between 30s in the past (started just now) and
// 90s in the future (about to start). The window is wider than 60s so we
// don't miss an event if the tick lands slightly off the start time.
const NOTIFY_LEAD_MS = 90_000;
const NOTIFY_GRACE_MS = 30_000;
/**
 * Readiness runs earlier than the join reminder — between 1.5 and 3.5 minutes out — so
 * a problem it finds is still fixable before the meeting rather than during it. The
 * window is two minutes wide against a 30s tick, which leaves margin for a slow tick.
 */
const PREFLIGHT_EARLIEST_MS = 90_000;
const PREFLIGHT_LEAD_MS = 210_000;
/**
 * Recording is offered as the meeting actually begins, not before: a prompt two minutes
 * early is one you dismiss and then forget, and starting early records the small talk of
 * whatever you were doing instead.
 */
const RECORD_GRACE_MS = 120_000;
const RECORD_LEAD_MS = 30_000;
// Drop state entries older than 24h so the file doesn't grow forever.
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const STATE_FILE = path.join(WorkDir, "calendar_notifications_state.json");

export interface NotificationState {
  notifiedEventIds: Record<string, { notifiedAt: string; startTime: string }>;
}

/**
 * What main plugs into this tick.
 *
 * Everything here needs capabilities that live in the main process — the capture
 * sidecar, the recording controller, the meetings config — which core cannot import.
 * Injecting them keeps one timer for all three notifications instead of three timers
 * racing to talk about the same meeting, and keeps their dedupe in one file.
 */
export interface CalendarNotifyHooks {
  /**
   * Is this machine ready to record? Asked at most once per tick, because the answer is
   * about the machine and not about any particular event. Returns null when there is
   * nothing worth saying — which must be the common case.
   */
  preflight?: () => Promise<{ summary: string } | null>;
  /** How to treat an event that is starting: prompt, start silently, or ignore. */
  recordPolicy?: (event: ResolvedCalendarEvent) => Promise<"off" | "prompt" | "auto">;
  /** Start recording for this event. Only called when the policy says `auto`. */
  startRecording?: (event: ResolvedCalendarEvent) => Promise<void>;
  /**
   * Arm the standby buffer ahead of a meeting, if the user asked for that. Called in
   * the same window as the readiness check — early enough that the buffer holds the
   * minutes before the meeting nominally starts, which is the point.
   */
  armStandby?: (event: ResolvedCalendarEvent) => Promise<void>;
  /** True while a session is already running — never offer to record over one. */
  isRecording?: () => boolean;
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

/**
 * Dedupe key for one kind of notification about one event.
 *
 * The join reminder deliberately keeps the bare event id: every entry already in a
 * user's state file uses it, and prefixing it would re-fire the reminder for every
 * event currently in the window. The newer kinds get a prefix, which is also what stops
 * a readiness warning from suppressing the join reminder for the same meeting.
 */
function key(kind: "join" | "preflight" | "record", eventId: string): string {
  return kind === "join" ? eventId : `${kind}:${eventId}`;
}

/**
 * Exported for tests. The interaction worth proving is that three kinds of notification
 * now share one dedupe map: a readiness warning must not suppress the join reminder for
 * the same meeting, and that is invisible from outside `init`'s infinite loop.
 */
export async function tick(
  state: NotificationState,
  hooks: CalendarNotifyHooks = {},
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

  const mark = (kind: "join" | "preflight" | "record", event: ResolvedCalendarEvent) => {
    state.notifiedEventIds[key(kind, event.id)] = {
      notifiedAt: new Date(now).toISOString(),
      startTime: event.start.toISOString(),
    };
    dirty = true;
  };
  const alreadyDone = (kind: "join" | "preflight" | "record", event: ResolvedCalendarEvent) =>
    state.notifiedEventIds[key(kind, event.id)] !== undefined;

  // --- Join reminder -------------------------------------------------------
  // Cancelled, declined, all-day and unparseable events are already dropped by the
  // shared reader; the window is `[-grace, +lead]` around the start.
  const due = await listUpcomingEvents(
    { earliestMs: -NOTIFY_GRACE_MS, latestMs: NOTIFY_LEAD_MS, now },
    CALENDAR_SYNC_DIR,
  );

  for (const event of due) {
    if (alreadyDone("join", event)) continue;
    const eid = encodeURIComponent(event.id);

    try {
      service.notify({
        title: "Upcoming meeting",
        message: `${event.summary} starts in 1 minute. Click to join and take notes.`,
        // Single labeled button — adding a secondary action would force
        // macOS to bundle them into an "Options" dropdown, hiding the
        // primary label.
        link: `${DEEP_LINK_SCHEME}://action?type=join-and-take-meeting-notes&eventId=${eid}`,
        actionLabel: "Join & Notes",
      });
      console.log(`[CalendarNotify] notified for "${event.summary}" (${event.id})`);
    } catch (err) {
      console.error(`[CalendarNotify] notify failed for ${event.id}:`, err);
      continue;
    }
    mark("join", event);
  }

  // --- Readiness -----------------------------------------------------------
  // Only for meetings with a join link: those are the ones that would be recorded, and
  // a readiness warning about a meeting nobody would capture is pure noise.
  if (hooks.preflight) {
    const upcoming = await listUpcomingEvents(
      {
        earliestMs: PREFLIGHT_EARLIEST_MS,
        latestMs: PREFLIGHT_LEAD_MS,
        requireConferenceLink: true,
        now,
      },
      CALENDAR_SYNC_DIR,
    );
    const pending = upcoming.filter((event) => !alreadyDone("preflight", event));
    if (pending.length > 0) {
      // Asked once even when several meetings are due: the answer is about the machine.
      let problem: { summary: string } | null = null;
      try {
        problem = await hooks.preflight();
      } catch (err) {
        // A readiness check that throws must not become a warning about the meeting.
        console.error("[CalendarNotify] preflight failed:", err);
      }
      for (const event of pending) {
        // Marked whether or not anything was said, so a healthy machine is not
        // re-checked every tick for the same meeting.
        mark("preflight", event);
        if (hooks.armStandby && !hooks.isRecording?.()) {
          try {
            await hooks.armStandby(event);
          } catch (err) {
            console.error(`[CalendarNotify] could not arm standby for ${event.id}:`, err);
          }
        }
        if (!problem) continue;
        try {
          service.notify({
            title: "Check your recording setup",
            message: `Before "${event.summary}" — ${problem.summary}`,
            link: `${DEEP_LINK_SCHEME}://action?type=meeting-setup`,
            actionLabel: "Fix it",
          });
        } catch (err) {
          console.error(`[CalendarNotify] preflight notify failed for ${event.id}:`, err);
        }
        // One warning per tick. The problem is with the machine, so saying it once
        // covers every meeting it would affect.
        break;
      }
    }
  }

  // --- Offer to record -----------------------------------------------------
  if (hooks.recordPolicy && !hooks.isRecording?.()) {
    const starting = await listUpcomingEvents(
      {
        earliestMs: -RECORD_GRACE_MS,
        latestMs: RECORD_LEAD_MS,
        requireConferenceLink: true,
        now,
      },
      CALENDAR_SYNC_DIR,
    );
    for (const event of starting) {
      if (alreadyDone("record", event)) continue;
      let policy: "off" | "prompt" | "auto" = "off";
      try {
        policy = await hooks.recordPolicy(event);
      } catch (err) {
        console.error(`[CalendarNotify] record policy failed for ${event.id}:`, err);
        continue;
      }
      if (policy === "off") {
        // Marked anyway: an event the policy declined should not be re-evaluated every
        // 30 seconds for the two minutes it stays in the window.
        mark("record", event);
        continue;
      }

      if (policy === "auto" && hooks.startRecording) {
        try {
          await hooks.startRecording(event);
          service.notify({
            // Never silent about starting: a recording that begins with no notice is
            // the behaviour this feature must not have, whatever the user opted into.
            title: "Recording this meeting",
            message: `Started for "${event.summary}". Everything stays on this Mac.`,
            link: `${DEEP_LINK_SCHEME}://action?type=meeting-setup`,
            actionLabel: "Open",
          });
        } catch (err) {
          console.error(`[CalendarNotify] auto-start failed for ${event.id}:`, err);
        }
        mark("record", event);
        // One session at a time — anything else in this window is not ours to start.
        break;
      }

      try {
        service.notify({
          title: `"${event.summary}" is starting`,
          message: "Record it? Audio and transcript stay on this Mac.",
          link: `${DEEP_LINK_SCHEME}://action?type=record-meeting&eventId=${encodeURIComponent(event.id)}`,
          actionLabel: "Record",
        });
      } catch (err) {
        console.error(`[CalendarNotify] record notify failed for ${event.id}:`, err);
        continue;
      }
      mark("record", event);
    }
  }

  return { state, dirty };
}

export async function init(hooks: CalendarNotifyHooks = {}): Promise<void> {
  console.log("[CalendarNotify] starting calendar notification service");
  console.log(`[CalendarNotify] tick every ${TICK_INTERVAL_MS / 1000}s`);

  let state = gcState(await loadState());

  while (true) {
    try {
      const result = await tick(state, hooks);
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
