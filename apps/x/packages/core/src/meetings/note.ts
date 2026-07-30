import {
  formatMeetingNote,
  segmentsToEntries,
  type MeetingCalendarEvent,
  type MeetingSessionMeta,
  type MeetingTranscript,
} from "@x/shared/dist/meetings.js";
import { writeFile } from "../workspace/workspace.js";

/**
 * The workspace note a finished session produces.
 *
 * Deliberately the *same* note the renderer capture path writes — same folder, same
 * frontmatter, same fenced `transcript` block — because everything downstream is
 * already built on that shape: the transcript block is an editor node, note listing
 * filters on `source: solomon`, and `meeting:summarize` prepends its notes above the
 * block. The formatter itself lives in `@x/shared` so both engines call one
 * implementation and cannot drift apart.
 */

/** `knowledge/Meetings/solomon/<YYYY-MM-DD>/<title|session>.md`, matching the
 *  renderer path exactly so both engines' notes sort together in the file tree. */
export function meetingNotePath(args: {
  startedAt: Date;
  sessionId: string;
  calendarEvent?: MeetingCalendarEvent;
}): string {
  const dateFolder = args.startedAt.toISOString().split("T")[0];
  const summary = args.calendarEvent?.summary;
  const filename = summary
    ? summary
        .replace(/[\\/*?:"<>|]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100)
        .trim()
    : `meeting-${args.sessionId}`;
  return `knowledge/Meetings/solomon/${dateFolder}/${filename || `meeting-${args.sessionId}`}.md`;
}

export interface MeetingProvenance {
  transcription_provider: string;
  transcription_model: string;
  diarization_provider: string;
  diarization_mode: string;
  audio_uploaded: boolean;
  speaker_identity_persistence: string;
  capture_engine: string;
  /** False when the system track never opened — the note holds only your side, and
   *  saying so is the difference between "one-sided" and "the meeting was silent". */
  system_audio_captured: boolean;
}

/**
 * RFC 017 trust surface. The native path is unambiguous: audio never left the
 * machine, and speaker attribution came from having two tracks rather than from a
 * diarization model.
 */
export function nativeProvenance(args: {
  model: string;
  systemAudioCaptured: boolean;
}): MeetingProvenance {
  return {
    transcription_provider: "whisper.cpp",
    transcription_model: args.model,
    // Not "none" and not a model: the track *is* the speaker.
    diarization_provider: "dual-track",
    diarization_mode: "channel",
    audio_uploaded: false,
    speaker_identity_persistence: "none",
    capture_engine: "native",
    system_audio_captured: args.systemAudioCaptured,
  };
}

export interface WriteMeetingNoteArgs {
  sessionId: string;
  meta: MeetingSessionMeta;
  transcript: MeetingTranscript;
  calendarEvent?: MeetingCalendarEvent;
  provenance: MeetingProvenance;
  /** Injected so tests don't need a workspace on disk. */
  write?: typeof writeFile;
}

/** Render and write the note; returns its workspace-relative path. */
export async function writeMeetingNote(args: WriteMeetingNoteArgs): Promise<string> {
  const startedAt = new Date(args.meta.started);
  const notePath = meetingNotePath({
    startedAt,
    sessionId: args.sessionId,
    calendarEvent: args.calendarEvent,
  });
  const content = formatMeetingNote(
    segmentsToEntries(args.transcript.segments),
    args.meta.started,
    args.calendarEvent,
    args.provenance as unknown as Record<string, string | boolean>,
  );
  await (args.write ?? writeFile)(notePath, content, { encoding: "utf8", mkdirp: true });
  return notePath;
}
