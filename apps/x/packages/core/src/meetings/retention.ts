import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MeetingKeepAudio, MeetingSessionMeta } from "@x/shared/dist/meetings.js";
import { appendLog, patchMeta } from "./session.js";

/**
 * Audio retention.
 *
 * The transcript is the durable artifact; the audio exists to survive a crash and to
 * allow re-transcription. RFC 035 is explicit that raw audio is not kept by default,
 * so `untilTranscribed` is the default and the recording is deleted once
 * `transcript.json` lands.
 *
 * | mode              | audio is deleted                                              |
 * | ----------------- | ------------------------------------------------------------- |
 * | `always`          | never — re-transcribe with a better model whenever you like   |
 * | `untilTranscribed`| once a transcript exists; kept on failure so a retry is possible |
 * | `never`           | when the session ends, transcript or not — strictest posture  |
 */

export interface ApplyRetentionArgs {
  dir: string;
  meta: MeetingSessionMeta;
  mode: MeetingKeepAudio;
  transcribed: boolean;
}

/** Returns true when audio was deleted. */
export async function applyRetention(args: ApplyRetentionArgs): Promise<boolean> {
  const { dir, meta, mode, transcribed } = args;
  if (mode === "always") return false;
  // Keeping the audio on failure is the whole point of `untilTranscribed`: without a
  // transcript, deleting it would throw the meeting away.
  if (mode === "untilTranscribed" && !transcribed) return false;
  if (meta.audio_deleted_at) return false;

  let deleted = false;
  for (const track of meta.tracks) {
    try {
      await fs.rm(path.join(dir, track.file), { force: true });
      deleted = true;
    } catch (err) {
      await appendLog(dir, `could not delete ${track.file}: ${(err as Error).message}`);
    }
  }
  if (deleted) {
    // Recorded so the UI can say "audio was deleted by your retention setting"
    // rather than showing a session that looks broken.
    await patchMeta(dir, { audio_deleted_at: new Date().toISOString() });
    await appendLog(dir, `audio deleted (keepAudio: ${mode})`);
  }
  return deleted;
}

/** True when every track file is still on disk — i.e. re-transcription is possible. */
export async function hasAudio(dir: string, meta: MeetingSessionMeta): Promise<boolean> {
  if (meta.tracks.length === 0) return false;
  for (const track of meta.tracks) {
    try {
      await fs.access(path.join(dir, track.file));
    } catch {
      return false;
    }
  }
  return true;
}
