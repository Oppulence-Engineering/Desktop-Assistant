import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MeetingTranscript, type MeetingSessionSummary } from "@x/shared/dist/meetings.js";
import { WorkDir } from "../config/config.js";
import { meetingNotePath, calendarEventFromMeta } from "./note.js";
import { hasAudio } from "./retention.js";
import { sessionDirs } from "./queue.js";
import { exists, readMeta, TRANSCRIBE_LOG, TRANSCRIPT_JSON } from "./session.js";

/**
 * Reading past sessions for the UI. Derived entirely from what is on disk — there is
 * no index to fall out of sync, which also means a session copied in by hand (or
 * restored from a backup) simply appears.
 */

/** Newest first, which is the order the UI wants. */
export async function listSessionSummaries(root: string): Promise<MeetingSessionSummary[]> {
  const dirs = await sessionDirs(root);
  const summaries: MeetingSessionSummary[] = [];

  for (const dir of dirs.reverse()) {
    const meta = await readMeta(dir);
    // No meta.json means the session never finished — either it is recording right
    // now or the process died before stop. Either way there is nothing to list yet.
    if (!meta) continue;

    const transcriptPath = path.join(dir, TRANSCRIPT_JSON);
    const transcribed = await exists(transcriptPath);
    summaries.push({
      id: path.basename(dir),
      dir,
      startedAt: meta.started,
      durationSeconds: meta.duration_seconds,
      transcribed,
      hasAudio: await hasAudio(dir, meta),
      notePath: await noteFor(dir, meta),
      segmentCount: transcribed ? await countSegments(transcriptPath) : undefined,
      tracks: meta.tracks,
      warnings: meta.warnings,
      error: transcribed ? undefined : await lastLogError(dir),
    });
  }
  return summaries;
}

export async function readTranscript(dir: string): Promise<MeetingTranscript | null> {
  try {
    const raw = await fs.readFile(path.join(dir, TRANSCRIPT_JSON), "utf8");
    const parsed = MeetingTranscript.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The note this session produced, if it is still there. Derived rather than stored, and
 * only returned when the file exists — offering to open a note the user has since
 * deleted or moved would be worse than offering nothing.
 */
async function noteFor(
  dir: string,
  meta: Awaited<ReturnType<typeof readMeta>>,
): Promise<string | undefined> {
  if (!meta) return undefined;
  const relative = meetingNotePath({
    startedAt: new Date(meta.started),
    sessionId: path.basename(dir),
    calendarEvent: calendarEventFromMeta(meta),
  });
  try {
    await fs.access(path.join(WorkDir, relative));
    return relative;
  } catch {
    return undefined;
  }
}

async function countSegments(transcriptPath: string): Promise<number | undefined> {
  try {
    const raw = await fs.readFile(transcriptPath, "utf8");
    const parsed = MeetingTranscript.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.segments.length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The most recent failure line from the session's own log, so an untranscribed
 * session can say why instead of just sitting there looking pending.
 */
async function lastLogError(dir: string): Promise<string | undefined> {
  try {
    const log = await fs.readFile(path.join(dir, TRANSCRIBE_LOG), "utf8");
    const failures = log
      .split("\n")
      .filter((line) => line.includes("failed") || line.includes("skipping"));
    const last = failures.at(-1);
    // Drop the ISO timestamp prefix — the UI has the session's own time already.
    return last ? last.slice(last.indexOf(" ") + 1) : undefined;
  } catch {
    return undefined;
  }
}
