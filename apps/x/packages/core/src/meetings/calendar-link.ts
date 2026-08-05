import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MeetingSessionMeta } from "@x/shared/dist/meetings.js";
import { normalizeMeetingEvent } from "@x/shared/dist/meetings.js";
import { WorkDir } from "../config/config.js";
import { META_FILE } from "./session.js";
import { readMeta } from "./session.js";

/**
 * Recovering the calendar event id for sessions recorded before it was preserved.
 *
 * `meta.calendar_event` used to be written without the provider's event id, so those
 * sessions have the invite's title and time but no handle on the invite itself. The
 * recovery below is deliberately conservative: an observation's `externalId` is
 * derived from this value, so a wrong match does not merely mislabel one session — it
 * makes two unrelated meetings collide under one identity and dedupe each other away.
 *
 * Ambiguity therefore returns undefined. No id is a fully supported state; callers
 * fall back to the session id.
 */

/** How far a cached event's start may sit from the recording's start and still match. */
const START_TOLERANCE_MS = 15 * 60 * 1000;

function calendarSyncDir(): string {
  return path.join(WorkDir, "calendar_sync");
}

function eventStartMs(event: { start?: { dateTime?: string; date?: string } }): number | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * The calendar event id for a finished session, or undefined.
 *
 * Prefers the id already stored in `meta.calendar_event`. Falls back to a single
 * unambiguous match in `calendar_sync/`: exact title, start within
 * {@link START_TOLERANCE_MS}. More than one candidate means no answer.
 */
export async function resolveCalendarEventId(
  meta: Pick<MeetingSessionMeta, "started" | "calendar_event">,
): Promise<string | undefined> {
  if (!meta.calendar_event) return undefined;

  let stored: ReturnType<typeof normalizeMeetingEvent>;
  try {
    stored = normalizeMeetingEvent(JSON.parse(meta.calendar_event));
  } catch {
    return undefined;
  }
  if (!stored) return undefined;
  if (stored.id) return stored.id;

  const title = normalizeTitle(stored.summary);
  const startedAt = Date.parse(meta.started);
  if (!title || Number.isNaN(startedAt)) return undefined;

  let files: string[];
  try {
    files = await fs.readdir(calendarSyncDir());
  } catch {
    // calendar_sync is pruned to a rolling window, so an older session simply has
    // nothing left to match against. Not an error.
    return undefined;
  }

  const matches = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".json") || file === "sync_state.json") continue;
    let candidate: ReturnType<typeof normalizeMeetingEvent>;
    try {
      const raw = await fs.readFile(path.join(calendarSyncDir(), file), "utf8");
      candidate = normalizeMeetingEvent(JSON.parse(raw), {
        fallbackId: path.basename(file, ".json"),
      });
    } catch {
      continue;
    }
    if (!candidate?.id) continue;
    if (normalizeTitle(candidate.summary) !== title) continue;
    const candidateStart = eventStartMs(candidate);
    if (candidateStart === null) continue;
    if (Math.abs(candidateStart - startedAt) > START_TOLERANCE_MS) continue;
    matches.add(candidate.id);
    // Two distinct events already match; a third cannot make it unambiguous.
    if (matches.size > 1) return undefined;
  }

  const [only] = [...matches];
  return only;
}

/**
 * Resolve the id and, on success, write it back into the session's `meta.json`.
 *
 * Idempotent, and a no-op when the id is already stored or cannot be recovered. Call
 * it lazily for the session being published — never in a startup sweep over every
 * recording, which would re-read the whole calendar cache once per session.
 */
export async function backfillCalendarEventId(sessionDir: string): Promise<string | undefined> {
  const meta = await readMeta(sessionDir);
  if (!meta?.calendar_event) return undefined;

  let stored: ReturnType<typeof normalizeMeetingEvent>;
  try {
    stored = normalizeMeetingEvent(JSON.parse(meta.calendar_event));
  } catch {
    return undefined;
  }
  if (stored?.id) return stored.id;

  const id = await resolveCalendarEventId(meta);
  if (!id || !stored) return undefined;

  const updated: MeetingSessionMeta = {
    ...meta,
    calendar_event: JSON.stringify({ ...stored, id }),
  };
  const target = path.join(sessionDir, META_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf8");
  await fs.rename(tmp, target);
  return id;
}
