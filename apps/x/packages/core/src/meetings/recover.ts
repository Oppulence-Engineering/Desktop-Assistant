import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  MeetingSessionMeta,
  MeetingSpeaker,
  MeetingTrackId,
  MeetingTrackMeta,
} from "@x/shared/dist/meetings.js";
import { appendLog, exists, writeJsonAtomic, META_FILE } from "./session.js";
import { readPcmChunk, readWavInfo, recoverWavHeader } from "./wav.js";

/**
 * Recovering a session the recorder never finished.
 *
 * `meta.json` is what marks a session complete, and the sidecar writes it last — so a
 * hard kill (SIGKILL, a panic, the machine losing power) leaves track files with no
 * meta at all. Without this those recordings are invisible: the queue's pending
 * predicate needs a `meta.json`, and so does the sessions list. The audio survived the
 * crash and then nothing ever looked at it.
 *
 * So: synthesize the meta from the files themselves. Everything the sidecar observes
 * live is recoverable except the per-track start offsets, which only exist as the
 * wall-clock of each track's first buffer. Those default to 0 and the session is
 * flagged, because a few hundred milliseconds of skew between two speakers is a much
 * better outcome than losing the meeting.
 */

/** Track file names the sidecar writes, and who each one is. */
const KNOWN_TRACKS: { id: MeetingTrackId; file: string; speaker: MeetingSpeaker }[] = [
  { id: "mic", file: "mic.wav", speaker: "me" },
  { id: "system", file: "system.wav", speaker: "them" },
];

export const RECOVERED_WARNING =
  "recovered_without_meta: the recorder was killed before writing meta.json — " +
  "track start offsets are unknown and assumed simultaneous";

/** Peak amplitude 0…1, read in windows so a long track is not loaded whole. */
async function trackPeak(file: string, frames: number, sampleRate: number): Promise<number> {
  const info = await readWavInfo(file);
  const window = sampleRate * 60;
  let peak = 0;
  for (let start = 0; start < frames; start += window) {
    const pcm = await readPcmChunk(file, info, start, window);
    for (let i = 0; i < pcm.length; i++) {
      const magnitude = Math.abs(pcm[i]) / 32768;
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/**
 * Rebuild `meta.json` for a session directory that has track files but no meta.
 * Returns the synthesized meta, or null when there is nothing worth recovering.
 */
export async function recoverSessionMeta(dir: string): Promise<MeetingSessionMeta | null> {
  if (await exists(path.join(dir, META_FILE))) return null;

  const tracks: MeetingTrackMeta[] = [];
  let longestMs = 0;
  let lastWrite = 0;
  let sampleRate = 16000;

  for (const known of KNOWN_TRACKS) {
    const file = path.join(dir, known.file);
    if (!(await exists(file))) continue;
    try {
      // Repair the header first so the retained file is playable and every later
      // read sees a normal WAV.
      await recoverWavHeader(file);
      const info = await readWavInfo(file);
      if (info.frames === 0) continue;
      sampleRate = info.sampleRate;

      const durationMs = Math.round((info.frames / info.sampleRate) * 1000);
      longestMs = Math.max(longestMs, durationMs);
      const stat = await fs.stat(file);
      lastWrite = Math.max(lastWrite, stat.mtimeMs);

      const peak = await trackPeak(file, info.frames, info.sampleRate);
      tracks.push({
        id: known.id,
        speaker: known.speaker,
        file: known.file,
        // Unknowable after the fact — see the note above.
        offset_ms: 0,
        frames: info.frames,
        duration_ms: durationMs,
        peak,
        silent: peak === 0,
      });
    } catch {
      // A track too damaged to read must not stop the other from being recovered.
    }
  }

  if (tracks.length === 0) return null;

  // The last write is effectively when recording stopped; work back from there.
  const ended = new Date(lastWrite || Date.now());
  const started = new Date(ended.getTime() - longestMs);

  const meta: MeetingSessionMeta = {
    schema: 1,
    started: started.toISOString(),
    ended: ended.toISOString(),
    duration_seconds: Math.round(longestMs / 1000),
    audio: { sample_rate: sampleRate, channels: 1, encoding: "pcm_s16le", container: "wav" },
    tracks,
    warnings: [RECOVERED_WARNING],
  };

  await writeJsonAtomic(path.join(dir, META_FILE), meta);
  await appendLog(dir, `recovered ${tracks.length} track(s) with no meta.json`);
  return meta;
}

/**
 * Rebuild meta for every orphaned session under `root`. Run before scanning for
 * pending work, so a recording that outlived its recorder becomes ordinary pending
 * work rather than staying invisible.
 */
export async function recoverOrphanedSessions(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const recovered: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      if (await recoverSessionMeta(dir)) recovered.push(dir);
    } catch {
      // Recovery is best-effort; one bad directory never blocks the rest.
    }
  }
  return recovered.sort();
}
