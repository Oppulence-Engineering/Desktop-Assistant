import {
  segmentsToEntries,
  type MeetingSessionMeta,
  type MeetingTranscript,
} from "@x/shared/dist/meetings.js";
import { createEvent } from "../events/producer.js";

/**
 * Announcing a finished meeting to the event bus.
 *
 * Makes meetings a first-class event source alongside gmail and calendar sync, which is
 * what lets a user-authored background task react to one — "after every call with Acme,
 * draft the follow-up". Without this, a meeting is invisible to everything that is not
 * the meetings UI.
 *
 * The payload is markdown by contract (`RowboatEventSchema.payload`), so it is written to
 * be read by a model: who spoke, for how long, and the transcript itself.
 */

export const MEETING_EVENT_SOURCE = "meeting";
export const MEETING_TRANSCRIBED = "meeting.transcribed";

/** Keeps a long meeting from turning every event file into a novel. */
const MAX_TRANSCRIPT_CHARS = 20_000;

export async function publishMeetingTranscribed(args: {
  sessionId: string;
  meta: MeetingSessionMeta;
  transcript: MeetingTranscript;
  notePath?: string;
  now?: () => Date;
}): Promise<void> {
  const { sessionId, meta, transcript, notePath } = args;
  const now = args.now ?? (() => new Date());

  const body = segmentsToEntries(transcript.segments)
    .map((entry) => `**${entry.speaker}:** ${entry.text}`)
    .join("\n\n");
  const truncated =
    body.length > MAX_TRANSCRIPT_CHARS
      ? `${body.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n_(transcript truncated)_`
      : body;

  const minutes = Math.max(1, Math.round(meta.duration_seconds / 60));
  const lines = [
    `# Meeting transcribed — ${sessionId}`,
    "",
    `Started: ${meta.started}`,
    `Duration: ${minutes} minute${minutes === 1 ? "" : "s"}`,
    ...(notePath ? [`Note: ${notePath}`] : []),
    ...(meta.calendar_event ? [`Calendar event: ${meta.calendar_event}`] : []),
    "",
    "## Transcript",
    "",
    truncated || "_No speech was detected._",
  ];

  await createEvent({
    source: MEETING_EVENT_SOURCE,
    type: MEETING_TRANSCRIBED,
    createdAt: now().toISOString(),
    payload: lines.join("\n"),
  });
}
