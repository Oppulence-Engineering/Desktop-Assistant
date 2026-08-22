import {
  mergeSummaryIntoNote,
  transcriptTextFromNote,
  type MeetingSessionMeta,
} from "@x/shared/meetings";
import { readFile, writeFile } from "../workspace/workspace.js";
import { appendLog } from "./session.js";

/**
 * Turning a finished meeting note into notes someone would actually read.
 *
 * This runs in the transcription queue rather than at stop, because at stop the native
 * path's note is still the empty placeholder — transcription happens afterwards. Doing
 * it there summarized nothing, and the queue's own note write then overwrote the result.
 *
 * The renderer capture path summarizes at stop and is correct to: it streams the
 * transcript into the note live, so by the time it stops there is something to read.
 */

export interface SummarizeNoteArgs {
  dir: string;
  notePath: string;
  meta: MeetingSessionMeta;
  /** Injected so core does not reach into the model layer, and tests need no LLM. */
  summarize: (
    transcript: string,
    meetingStartTime?: string,
    calendarEventJson?: string,
  ) => Promise<string>;
  read?: typeof readFile;
  write?: typeof writeFile;
}

/**
 * Returns true when the note was rewritten with a summary.
 *
 * Every failure here is non-fatal: a meeting with a transcript and no summary is a far
 * better outcome than a failed job, and the transcript is the durable artifact.
 */
export async function summarizeMeetingNote(args: SummarizeNoteArgs): Promise<boolean> {
  const read = args.read ?? readFile;
  const write = args.write ?? writeFile;

  let noteContent: string;
  try {
    const result = await read(args.notePath, "utf8");
    noteContent = typeof result.data === "string" ? result.data : "";
  } catch (err) {
    await appendLog(args.dir, `summary skipped: cannot read note (${(err as Error).message})`);
    return false;
  }

  // Nothing was said, or the transcript never landed. Summarizing an empty transcript is
  // how the old path produced invented notes.
  const transcript = transcriptTextFromNote(noteContent);
  if (!transcript) {
    await appendLog(args.dir, "summary skipped: transcript is empty");
    return false;
  }

  let summary: string;
  try {
    summary = await args.summarize(noteContent, args.meta.started, args.meta.calendar_event);
  } catch (err) {
    await appendLog(args.dir, `summary failed: ${(err as Error).message}`);
    return false;
  }
  if (!summary.trim()) {
    await appendLog(args.dir, "summary skipped: model returned nothing");
    return false;
  }

  try {
    await write(args.notePath, mergeSummaryIntoNote(noteContent, summary), {
      encoding: "utf8",
    });
  } catch (err) {
    await appendLog(args.dir, `summary written but not saved: ${(err as Error).message}`);
    return false;
  }

  await appendLog(args.dir, "summarized");
  return true;
}
