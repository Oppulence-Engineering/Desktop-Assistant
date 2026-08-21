import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MeetingKeepAudio, MeetingSessionMeta } from "@x/shared/meetings";
import { compressedName, isCompressed, type AudioCodec } from "./codec.js";
import { appendLog, patchMeta } from "./session.js";

/**
 * Audio retention.
 *
 * The transcript is the durable artifact; the audio exists to survive a crash and to
 * allow re-transcription. RFC 035 is explicit that raw audio is not kept by default,
 * so `untilTranscribed` is the default and the recording is deleted once
 * `transcript.json` lands.
 *
 * | mode              | audio is deleted                                                |
 * | ----------------- | --------------------------------------------------------------- |
 * | `always`          | never — compressed instead, so re-transcription stays possible   |
 * | `untilTranscribed`| once a transcript exists; kept on failure so a retry is possible |
 *
 * Deletion always requires a transcript. Nothing here removes the only copy of a
 * meeting that was never successfully read.
 */

export interface ApplyRetentionArgs {
  dir: string;
  meta: MeetingSessionMeta;
  mode: MeetingKeepAudio;
  transcribed: boolean;
  /** When present, `always` compresses instead of just keeping the WAV. */
  codec?: AudioCodec;
}

/**
 * Returns true when audio was deleted **or** compressed — i.e. when the session's
 * audio files changed and `meta.json` was rewritten to match.
 */
export async function applyRetention(args: ApplyRetentionArgs): Promise<boolean> {
  const { dir, meta, mode, transcribed, codec } = args;
  // Nothing is ever removed before a transcript exists — without one, deleting would
  // throw the meeting away with nothing to show for it.
  if (!transcribed) return false;

  // Keeping audio does not mean keeping it uncompressed: once a transcript exists the
  // WAV has done its job, and AAC is ~1/8 the size and still playable.
  if (mode === "always") {
    if (!codec) return false;
    return compressTracks({ dir, meta, codec });
  }
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

/**
 * Compress each track in place and repoint `meta.json` at the new files. Skips tracks
 * that are already compressed, so it is safe to run again.
 *
 * The original WAV is deleted only after its `.m4a` exists, so a failure part-way
 * through costs disk, never the recording.
 */
async function compressTracks(args: {
  dir: string;
  meta: MeetingSessionMeta;
  codec: AudioCodec;
}): Promise<boolean> {
  const { dir, meta, codec } = args;
  const tracks = [...meta.tracks];
  let changed = false;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (isCompressed(track.file)) continue;
    const source = path.join(dir, track.file);
    const target = path.join(dir, compressedName(track.file));
    try {
      await fs.access(source);
    } catch {
      continue; // already gone
    }
    try {
      await codec.compress(source, target);
      await fs.rm(source, { force: true });
      tracks[i] = { ...track, file: path.basename(target) };
      changed = true;
    } catch (err) {
      // Leave the WAV alone — an uncompressed recording beats no recording.
      await fs.rm(target, { force: true }).catch(() => {});
      await appendLog(dir, `could not compress ${track.file}: ${(err as Error).message}`);
    }
  }

  if (changed) {
    await patchMeta(dir, { tracks });
    await appendLog(dir, "compressed retained audio");
  }
  return changed;
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
