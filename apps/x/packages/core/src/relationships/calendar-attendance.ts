import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorkDir } from "../config/config.js";
import { listCalendarEvents } from "../knowledge/calendar_events.js";
import { setCalendarSyncedHook } from "../knowledge/sync_calendar.js";
import { getAccountEmail } from "../knowledge/sync_gmail.js";
import { buildMeetingRoster, resolveRosterBinding } from "../meetings/roster.js";
import { getTranscriptionConfig } from "../voice/voice.js";
import { enqueueRelationshipEvidence, flushRelationshipEvidence } from "./evidence-outbox.js";
import type { RelationshipObservationInput } from "@x/shared/dist/relationships.js";

/**
 * Attendance for meetings that were never recorded.
 *
 * Most meetings are not recorded, and the invite still says who was there. Without
 * this, an account's history is shaped by which calls happened to be captured rather
 * than by which calls happened.
 *
 * `source` is **"calendar"**, deliberately asymmetric with the recorded path, which
 * files attendance under "meeting". A recorded meeting's attendance describes the
 * recording, so deleting the recording must delete it too — and conversation deletion
 * removes evidence by `source IN ("meeting", …)`. This evidence describes an invite
 * that exists independently of any recording, so filing it under "meeting" would make
 * it vanish when an unrelated recording was deleted. Both sides of that asymmetry are
 * documented in `meetingAttendanceObservation`.
 *
 * The trade-off: "calendar" maps to the Google source capability rather than the
 * desktop publish capability, which is exactly why the outbox partitions by source.
 */

const STATE_FILE = "calendar_attendance_state.json";

/** Only meetings that have actually finished. */
const SETTLE_MS = 15 * 60 * 1000;

/** How far back to consider. The calendar cache holds a rolling window anyway. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type State = { schema: 1; published: Record<string, string> };

function statePath(): string {
  return path.join(WorkDir, STATE_FILE);
}

async function readState(): Promise<State> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as State;
    if (parsed?.schema === 1 && parsed.published) return parsed;
  } catch {
    // A missing or corrupt state file means "publish nothing twice that we can
    // remember" — the observation externalId still makes replay idempotent.
  }
  return { schema: 1, published: {} };
}

async function writeState(state: State): Promise<void> {
  const target = statePath();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

/**
 * Publish attendance for finished, unrecorded, externally-attended meetings.
 *
 * Skips anything the roster binding declines to resolve — internal-only meetings,
 * multi-organization meetings, and invites too large to be meetings — so the same
 * conservative rules apply here as to a recorded call.
 */
export async function publishCalendarAttendance(args: {
  selfEmails: string[];
  now?: () => number;
  /** Session ids already recorded, so a captured meeting is not published twice. */
  recordedEventIds?: Set<string>;
}): Promise<{ published: number; skipped: number }> {
  const config = await getTranscriptionConfig();
  if (!config.relationships.meetingAttendance) return { published: 0, skipped: 0 };

  const now = args.now?.() ?? Date.now();
  const state = await readState();
  const events = await listCalendarEvents();
  let published = 0;
  let skipped = 0;

  for (const event of events) {
    const endedAt = (event.end ?? event.start).getTime();
    if (!Number.isFinite(endedAt)) continue;
    // Not over yet, or too old to be worth backfilling.
    if (endedAt > now - SETTLE_MS || endedAt < now - MAX_AGE_MS) continue;
    if (state.published[event.id]) continue;
    if (args.recordedEventIds?.has(event.id)) continue;

    const roster = buildMeetingRoster(event.raw, { selfEmails: args.selfEmails });
    if (!roster) {
      // Record the decision, not just the skip. An invite too large to be a
      // meeting is re-read on every 30-second sync otherwise, for as long as it
      // stays inside the calendar cache window.
      skipped += 1;
      state.published[event.id] = new Date(now).toISOString();
      continue;
    }
    const binding = resolveRosterBinding(roster);
    // Same rules as a recorded meeting: an internal or ambiguous invite publishes
    // nothing, and an ambiguous one is not worth prompting about retroactively.
    if (binding.kind !== "single_domain") {
      skipped += 1;
      state.published[event.id] = new Date(now).toISOString();
      continue;
    }

    const observation: RelationshipObservationInput = {
      displayName: binding.displayName,
      accountDomain: binding.accountDomain,
      source: "calendar",
      externalId: `calendar-attendance:${event.id}`,
      sourceVersion: roster.fingerprint,
      eventType: "meeting_attendance_recorded",
      occurredAt: event.start.toISOString(),
      summary: `${roster.external.length} external participant(s) on "${event.summary}"`,
      channel: "meeting",
      participants: roster.external.map((participant) => ({
        displayName: participant.displayName,
        ...(participant.email ? { email: participant.email } : {}),
        role: "contact",
      })),
      normalizedFacts: {
        calendar_event_id: event.id,
        meeting_title: event.summary,
        attendance_source: "calendar_invite",
        recorded: false,
        meeting_size: roster.size,
        invitee_count: roster.people.length,
        external_count: roster.external.length,
        declined_count: roster.declined.length,
        external_domains: roster.externalDomains,
        ...(roster.organizerEmail ? { organizer_email: roster.organizerEmail } : {}),
        capture_caveats: [
          ...roster.caveats,
          "This meeting was not recorded; attendance comes from the invite alone.",
        ],
      },
    };

    await enqueueRelationshipEvidence(observation);
    state.published[event.id] = new Date(now).toISOString();
    published += 1;
  }

  // Forget entries for events that have aged out, so the file stays bounded.
  const cutoff = now - MAX_AGE_MS * 2;
  for (const [id, at] of Object.entries(state.published)) {
    if (Date.parse(at) < cutoff) delete state.published[id];
  }
  await writeState(state);
  return { published, skipped };
}

/**
 * Register the post-sync attendance pass.
 *
 * Re-reads consent on every run and is a no-op until the user turns meeting
 * attendance on, so registering early is safe.
 */
export function initCalendarAttendance(): void {
  setCalendarSyncedHook(async () => {
    const accountEmail = await getAccountEmail();
    const result = await publishCalendarAttendance({
      selfEmails: accountEmail ? [accountEmail] : [],
    });
    if (result.published > 0) {
      await flushRelationshipEvidence();
      console.log(`[Calendar] queued attendance for ${result.published} unrecorded meeting(s)`);
    }
  });
}
