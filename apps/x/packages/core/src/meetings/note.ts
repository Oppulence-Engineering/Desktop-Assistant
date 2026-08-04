import {
  applyGeneratedSection,
  formatMeetingNote,
  segmentsToEntries,
  GENERATED_SECTION_HEADING,
  type MeetingCalendarEvent,
  type MeetingSessionMeta,
  type MeetingTranscript,
} from "@x/shared/dist/meetings.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorkDir } from "../config/config.js";
import { readFile, remove, writeFile } from "../workspace/workspace.js";

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
  /**
   * Appended before the extension when the plain path already belongs to a different
   * session. See {@link resolveMeetingNotePath}.
   */
  suffix?: string;
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
  const base = filename || `meeting-${args.sessionId}`;
  const suffixed = args.suffix ? `${base}-${args.suffix}` : base;
  return `knowledge/Meetings/solomon/${dateFolder}/${suffixed}.md`;
}

/**
 * The time part of a session id (`2026.07.29-1430` → `1430`).
 *
 * Used to tell two same-titled meetings apart in the file tree. The date is already the
 * containing folder, so repeating it in the filename would only make it longer.
 */
function sessionSuffix(sessionId: string): string {
  const dash = sessionId.indexOf("-");
  return dash === -1 ? sessionId : sessionId.slice(dash + 1);
}

/**
 * The `session_id` a meeting note records in its frontmatter, if it has one.
 *
 * Scoped to the frontmatter block rather than run over the whole file: below it sits the
 * user's own section, and a note that happens to contain a line beginning `session_id:`
 * — pasted, dictated, or transcribed — must not be able to change which session owns
 * the file.
 */
function noteSessionId(content: string): string | undefined {
  if (!content.startsWith("---")) return undefined;
  const end = content.indexOf("\n---", 3);
  const frontmatter = end === -1 ? content : content.slice(0, end);
  return /^session_id:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() || undefined;
}

/**
 * Which note file belongs to this session.
 *
 * The plain path is derived from the meeting's title and date, so **two meetings with
 * the same title on the same day derive the same path** — two "1:1"s, a standup that
 * ran twice. The second session then wrote over the first one's note, and since the
 * placeholder write happens at capture start, that landed before the second meeting had
 * anything of its own to show: the first meeting's transcript was replaced by an empty
 * one.
 *
 * Ownership is decided by the `session_id` the note records about itself, not by
 * position, so this is also stable across a restart — a session resumed from disk
 * re-derives the same answer and keeps writing to its own note.
 *
 * A note carrying *no* `session_id` is treated as ours. Those are notes from before the
 * native path recorded one, and from the renderer engine, which does not; claiming them
 * keeps "open note" and "delete note" working for old sessions. Only a note that names a
 * **different** session is refused.
 */
export async function resolveMeetingNotePath(args: {
  sessionId: string;
  startedAt: Date;
  calendarEvent?: MeetingCalendarEvent;
  /** Injected so tests need no workspace on disk. */
  readNote?: (relativePath: string) => Promise<string | null>;
}): Promise<string> {
  const read = args.readNote ?? readNoteFromDisk;
  const candidates = [
    undefined,
    sessionSuffix(args.sessionId),
    // The session id is unique by construction (`createSessionDir` claims its directory
    // with a non-recursive mkdir and suffixes on collision), so this always terminates.
    args.sessionId,
  ].map((suffix) =>
    meetingNotePath({
      startedAt: args.startedAt,
      sessionId: args.sessionId,
      calendarEvent: args.calendarEvent,
      suffix,
    }),
  );

  const notes = await Promise.all(candidates.map((relative) => read(relative)));

  // A note this session already wrote wins over any earlier candidate, even a free one.
  // Taking the first free path instead would strand our own note the moment the meeting
  // that had been holding the plain path was deleted: this session would start writing
  // a second file and the first would become unreachable, since listing and deletion
  // both resolve through here.
  for (const [index, existing] of notes.entries()) {
    if (existing !== null && noteSessionId(existing) === args.sessionId) return candidates[index];
  }

  // Otherwise take the first path that is free, or holds a note claiming no session.
  for (const [index, existing] of notes.entries()) {
    if (existing === null || noteSessionId(existing) === undefined) return candidates[index];
  }

  // Every candidate is spoken for by another session. Fall back to a path that cannot
  // collide rather than overwriting one of them.
  return meetingNotePath({
    startedAt: args.startedAt,
    sessionId: args.sessionId,
    calendarEvent: args.calendarEvent,
    suffix: `${args.sessionId}-${Date.now()}`,
  });
}

/**
 * Bytes of a note read to find its `session_id`.
 *
 * The whole note is not read because resolution runs once per session in the sessions
 * list, and a note carries its entire transcript inline — an hour-long meeting is well
 * over 100 kB. Reading every one of them to look at a frontmatter field turned listing
 * from a stat per session into tens of megabytes of I/O.
 *
 * `session_id` is part of the provenance block, which `formatMeetingNote` writes before
 * `calendar_event` (the only frontmatter field that can get long), so it is always far
 * inside this window.
 */
const NOTE_HEAD_BYTES = 8192;

/**
 * Enough of a workspace note to read its frontmatter, or null when it is not there.
 *
 * Falls back to the whole file only when the head does not contain the frontmatter
 * terminator — otherwise a note with unusually long frontmatter could be misread as
 * having no `session_id`, which would make a session disown its own note.
 */
async function readNoteFromDisk(relativePath: string): Promise<string | null> {
  const absolute = path.join(WorkDir, relativePath);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absolute, "r");
    const buffer = Buffer.alloc(NOTE_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, NOTE_HEAD_BYTES, 0);
    const head = buffer.toString("utf8", 0, bytesRead);
    // Complete frontmatter in hand (or a file shorter than the window): the head is as
    // good as the whole file for this question.
    if (bytesRead < NOTE_HEAD_BYTES || head.indexOf("\n---", 3) !== -1) return head;
    return await fs.readFile(absolute, "utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export interface MeetingProvenance {
  transcription_provider: string;
  transcription_model: string;
  diarization_provider: string;
  diarization_mode: string;
  audio_uploaded: boolean;
  speaker_identity_persistence: string;
  /**
   * Whether the non-you speaker is named, and why not when they are not.
   *
   * Recorded because the reader has to know which lines to doubt: a note that says
   * "Dana" everywhere and a note that says "Other" everywhere are different claims, and
   * only the frontmatter says which one this is.
   */
  counterparty?: string;
  counterparty_email?: string;
  speaker_attribution?: string;
  capture_engine: string;
  /** The recording this note came from. Without it nothing links a note back to its
   *  audio, so a transcript line cannot offer to play the moment it describes. */
  session_id: string;
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
  sessionId: string;
  systemAudioCaptured: boolean;
  counterparty?: { label: string; email?: string };
  /** Why the counterparty is unnamed, when they are. */
  attributionLimit?: string;
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
    session_id: args.sessionId,
    system_audio_captured: args.systemAudioCaptured,
    // Whether the non-you speaker is named, and why not when they are not. The reader
    // has to be able to tell a note that says "Dana" from one that says "Other" —
    // they are different claims, and only this says which.
    ...(args.counterparty
      ? {
          counterparty: args.counterparty.label,
          ...(args.counterparty.email ? { counterparty_email: args.counterparty.email } : {}),
          speaker_attribution: "named (1:1)",
        }
      : {
          speaker_attribution: args.attributionLimit
            ? `unnamed — ${args.attributionLimit}`
            : "unnamed",
        }),
  };
}

/** A session's calendar event as stored in `meta.json` (JSON on one line). */
export function calendarEventFromMeta(
  meta: Pick<MeetingSessionMeta, "calendar_event">,
): MeetingCalendarEvent | undefined {
  if (!meta.calendar_event) return undefined;
  try {
    return JSON.parse(meta.calendar_event) as MeetingCalendarEvent;
  } catch {
    return undefined;
  }
}

/**
 * The note a finished session produced, if it is still on disk.
 *
 * Derived rather than stored, and only returned when the file exists: offering to open
 * — or delete — a note the user has since moved or removed is worse than offering
 * nothing. Deriving it here also means a caller never has to hand a path in, so nothing
 * can ask for an arbitrary file to be deleted.
 */
export async function existingNotePath(
  sessionId: string,
  meta: Pick<MeetingSessionMeta, "started" | "calendar_event">,
): Promise<string | undefined> {
  // Resolved rather than derived: with two same-titled meetings on one day the plain
  // path may hold the *other* session's note, and offering to open — or delete — that
  // one is worse than offering nothing.
  const relative = await resolveMeetingNotePath({
    sessionId,
    startedAt: new Date(meta.started),
    calendarEvent: calendarEventFromMeta(meta),
  });
  try {
    await fs.access(path.join(WorkDir, relative));
    return relative;
  } catch {
    return undefined;
  }
}

/**
 * Delete a session's note, if it has one. Returns whether anything was removed.
 *
 * Goes through the workspace layer, which keeps the path inside the workspace and moves
 * to trash rather than unlinking — a meeting note may have been edited or summarized
 * since it was written, so deleting one should be recoverable.
 */
export async function deleteMeetingNote(
  sessionId: string,
  meta: Pick<MeetingSessionMeta, "started" | "calendar_event">,
): Promise<boolean> {
  const relative = await existingNotePath(sessionId, meta);
  if (!relative) return false;
  await remove(relative);
  return true;
}

export interface WriteMeetingNoteArgs {
  sessionId: string;
  /** ISO start time — `meta.started` for a finished session. */
  startedAt: string;
  segments: MeetingTranscript["segments"];
  calendarEvent?: MeetingCalendarEvent;
  provenance: MeetingProvenance;
  /** Speaker label overrides, when the counterparty was resolved. */
  speakerLabels?: Partial<Record<"me" | "them", string>>;
  /**
   * Reuse an existing path instead of deriving one. The placeholder written when
   * recording starts and the final note must be the *same* file: derived paths differ
   * if the two timestamps straddle midnight, which would leave two notes for one
   * meeting.
   */
  notePath?: string;
  /** Injected so tests don't need a workspace on disk. */
  write?: typeof writeFile;
  /**
   * Injected alongside `write` for the same reason. Used to read the note this call is
   * about to replace, so anything the user typed into it survives.
   */
  read?: typeof readFile;
}

/**
 * Render and write the note; returns its workspace-relative path.
 *
 * Called twice per session: once with no segments when recording starts, so there is
 * something to open immediately, and again with the transcript once it exists. Same
 * two-write shape as the renderer capture path.
 *
 * **The second write must not clobber the first.** The whole reason a note exists during
 * the call is so the user can type into it, and this function used to render a fresh
 * document and overwrite whatever was there — so every note taken *during* a meeting was
 * destroyed the moment its transcript landed, before summarization even ran. It now
 * rewrites only the generated region and copies the rest through.
 */
export async function writeMeetingNote(args: WriteMeetingNoteArgs): Promise<string> {
  const notePath =
    args.notePath ??
    (await resolveMeetingNotePath({
      sessionId: args.sessionId,
      startedAt: new Date(args.startedAt),
      calendarEvent: args.calendarEvent,
      readNote: args.read
        ? async (relative) => {
            try {
              const result = await args.read!(relative, "utf8");
              return typeof result.data === "string" ? result.data : null;
            } catch {
              return null;
            }
          }
        : undefined,
    }));
  const provenance = { ...args.provenance } as Record<string, string | boolean>;
  // An empty transcript block is ambiguous: it looks the same whether nothing was said
  // or capture silently failed. Say which, so the UI and the note pipeline can tell a
  // finished-but-silent meeting from one still waiting on a transcript.
  if (args.segments.length === 0) provenance.no_speech_detected = true;

  const content = formatMeetingNote(
    segmentsToEntries(args.segments, args.speakerLabels ?? {}),
    args.startedAt,
    args.calendarEvent,
    provenance,
    args.sessionId,
  );

  // A note that does not exist yet, or that cannot be read, is the first-write case —
  // not an error. Falling back to the freshly rendered content keeps a broken read from
  // costing the session its note entirely.
  const existing = await readExistingNote(notePath, args.read);
  const merged = existing ? mergeIntoExistingNote(existing, content) : content;

  await (args.write ?? writeFile)(notePath, merged, { encoding: "utf8", mkdirp: true });
  return notePath;
}

async function readExistingNote(
  notePath: string,
  read: typeof readFile | undefined,
): Promise<string | null> {
  try {
    const result = await (read ?? readFile)(notePath, "utf8");
    const data = typeof result.data === "string" ? result.data : "";
    return data.trim() ? data : null;
  } catch {
    return null;
  }
}

/**
 * Fold a freshly rendered note into the one already on disk, keeping the user's text.
 *
 * Both sides come from `formatMeetingNote`, so the generated region and transcript block
 * are lifted straight out of the new render — no re-derivation and nothing to drift.
 */
function mergeIntoExistingNote(existing: string, rendered: string): string {
  const frontmatter = frontmatterOf(rendered);
  const title = /^title:\s*(.+)$/m.exec(rendered)?.[1]?.trim() || "Meeting Notes";
  return applyGeneratedSection(existing, {
    frontmatter,
    title,
    generated: generatedSectionOf(rendered),
    transcriptBlock: transcriptBlockOf(rendered),
  });
}

function frontmatterOf(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? null : content.slice(0, end + 4);
}

function transcriptBlockOf(content: string): string {
  return content.match(/(```transcript\n[\s\S]*?\n```)/)?.[1] ?? "";
}

/** The rendered note's generated region, minus its heading. */
function generatedSectionOf(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === GENERATED_SECTION_HEADING);
  if (start === -1) return "";
  const rest: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ") || line.startsWith("# ") || line.startsWith("```transcript")) break;
    rest.push(line);
  }
  return rest.join("\n").trim();
}
