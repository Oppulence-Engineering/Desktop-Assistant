import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isEventNow,
  resolveCalendarEvent,
  startsWithin,
  type ResolvedCalendarEvent,
} from "@x/shared/calendar";
import { WorkDir } from "../config/config.js";

/**
 * Reading synced calendar events off disk, once.
 *
 * `sync_calendar.ts` writes raw Google event JSON one file per event. Four call sites
 * grew their own loader, their own partial type, and their own filters; anything that
 * decides whether to record a meeting needs one answer instead.
 */

export const CALENDAR_SYNC_DIR = path.join(WorkDir, "calendar_sync");

/** Written by the sync loop, not an event. */
function isEventFile(name: string): boolean {
  return name.endsWith(".json") && !name.startsWith("sync_state");
}

/**
 * Every actionable event on disk, earliest first. Cancelled, declined, all-day and
 * unparseable entries are dropped by {@link resolveCalendarEvent}.
 */
export async function listCalendarEvents(
  dir = CALENDAR_SYNC_DIR,
): Promise<ResolvedCalendarEvent[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // calendar never synced — not an error
  }

  const events: ResolvedCalendarEvent[] = [];
  for (const name of names) {
    if (!isEventFile(name)) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      const resolved = resolveCalendarEvent(raw, path.basename(name, ".json"));
      if (resolved) events.push(resolved);
    } catch {
      // One malformed file must not hide the rest of the calendar.
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Events starting inside a window relative to now.
 *
 * The window is explicit because every caller is on a periodic tick and must accept a
 * span at least as wide as its interval, or it will straddle the moment it cares about.
 */
export async function listUpcomingEvents(
  opts: { earliestMs?: number; latestMs: number; requireConferenceLink?: boolean; now?: number },
  dir = CALENDAR_SYNC_DIR,
): Promise<ResolvedCalendarEvent[]> {
  return filterUpcoming(await listCalendarEvents(dir), opts);
}

/**
 * The filter half of {@link listUpcomingEvents}, over events already read.
 *
 * Split out because the notification tick asks three different questions of the same
 * calendar — join, readiness, record — and calling the reader three times meant re-reading
 * and re-parsing every event file three times every thirty seconds, forever. On a busy
 * calendar that is a real amount of background I/O for an answer that cannot have changed
 * between the three calls.
 */
export function filterUpcoming(
  events: ResolvedCalendarEvent[],
  opts: { earliestMs?: number; latestMs: number; requireConferenceLink?: boolean; now?: number },
): ResolvedCalendarEvent[] {
  const now = opts.now ?? Date.now();
  const earliest = opts.earliestMs ?? 0;
  return events.filter(
    (event) =>
      startsWithin(event, earliest, opts.latestMs, now) &&
      (!opts.requireConferenceLink || event.conferenceLink !== null),
  );
}

/** Events happening right now — the signal for "should we be recording?". */
export async function listEventsInProgress(
  opts: { requireConferenceLink?: boolean; now?: number } = {},
  dir = CALENDAR_SYNC_DIR,
): Promise<ResolvedCalendarEvent[]> {
  const now = opts.now ?? Date.now();
  const events = await listCalendarEvents(dir);
  return events.filter(
    (event) =>
      isEventNow(event, now) && (!opts.requireConferenceLink || event.conferenceLink !== null),
  );
}
