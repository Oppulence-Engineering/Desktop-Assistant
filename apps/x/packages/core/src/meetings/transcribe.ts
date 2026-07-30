import * as path from "node:path";
import type {
  MeetingSessionMeta,
  MeetingTrackMeta,
  MeetingTranscript,
  MeetingTranscriptSegment,
} from "@x/shared/dist/meetings.js";
import { isNonSpeech, pcmStats } from "../voice/whisper/index.js";
import { appendLog } from "./session.js";
import { readPcmChunk, readWavInfo, recoverWavHeader } from "./wav.js";

/**
 * Turning two capture tracks into one speaker-tagged transcript.
 *
 * Each track is transcribed on its own — clean single-source audio transcribes
 * better than a mix, and the track *is* the speaker attribution, so `me`/`them`
 * comes free with no speaker-identification model. Segments are then shifted onto a
 * shared clock and merged by time.
 */

/** 10-minute windows. An hour of 16 kHz mono is ~115 MB; the transcriber also writes
 *  the chunk out as a temp WAV, so a whole-meeting call would mean two copies of it
 *  in flight. */
export const CHUNK_SECONDS = 600;

/** Below this peak a window holds no speech worth transcribing. Skipping it is
 *  faster and, more importantly, stops whisper inventing text for silence. */
export const SILENCE_PEAK_THRESHOLD = 0.005;

/** The slice of `WhisperService` this needs, so tests inject a fake instead of a
 *  model download. Mirrors the DI seam in `core/src/mailbox`. */
export interface MeetingTranscriber {
  transcribe(
    pcm: Int16Array,
    opts: { channels: 1; model?: string; lang?: string },
  ): Promise<{ segments: { start: number; end: number; text: string }[] }>;
}

export interface TranscribeSessionOpts {
  dir: string;
  meta: MeetingSessionMeta;
  transcriber: MeetingTranscriber;
  engine: string;
  model: string;
  lang?: string;
  /** 0…1 across all tracks in this session. */
  onProgress?: (fraction: number) => void;
  now?: () => Date;
}

export async function transcribeSession(opts: TranscribeSessionOpts): Promise<MeetingTranscript> {
  const { dir, meta, transcriber, engine, model, lang, onProgress } = opts;
  const now = opts.now ?? (() => new Date());

  const totalFrames = meta.tracks.reduce((sum, track) => sum + Math.max(0, track.frames), 0) || 1;
  let framesDone = 0;
  const segments: MeetingTranscriptSegment[] = [];

  for (const track of meta.tracks) {
    // One unreadable track must not cost us the other's transcript — a denied
    // system-audio grant is common, and your own half is still worth having.
    try {
      const trackSegments = await transcribeTrack({
        dir,
        track,
        transcriber,
        lang,
        onFrames: (frames) => {
          framesDone += frames;
          onProgress?.(Math.min(1, framesDone / totalFrames));
        },
      });
      segments.push(...trackSegments);
    } catch (err) {
      await appendLog(dir, `skipping ${track.file}: ${(err as Error).message}`);
    }
  }

  segments.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);

  return {
    schema: 1,
    engine,
    model,
    created_at: now().toISOString(),
    segments,
  };
}

async function transcribeTrack(args: {
  dir: string;
  track: MeetingTrackMeta;
  transcriber: MeetingTranscriber;
  lang?: string;
  onFrames: (frames: number) => void;
}): Promise<MeetingTranscriptSegment[]> {
  const { dir, track, transcriber, lang, onFrames } = args;
  const file = path.join(dir, track.file);

  // A track the sidecar already flagged silent has nothing to transcribe. This is
  // the failure mode that looks like success — correct duration, no signal — so it
  // is worth naming in the log rather than silently producing an empty transcript.
  if (track.silent) {
    await appendLog(dir, `${track.file}: recorded silence (peak 0) — nothing to transcribe`);
    onFrames(track.frames);
    return [];
  }

  // Repair a header the writer never finalized before reading, so the retained file
  // is also playable afterwards.
  if (await recoverWavHeader(file)) {
    await appendLog(dir, `${track.file}: recovered an unfinalized WAV header`);
  }

  const info = await readWavInfo(file);
  if (info.channels !== 1) {
    throw new Error(`expected mono, got ${info.channels} channels`);
  }

  const chunkFrames = Math.floor(CHUNK_SECONDS * info.sampleRate);
  const segments: MeetingTranscriptSegment[] = [];

  for (let startFrame = 0; startFrame < info.frames; startFrame += chunkFrames) {
    const pcm = await readPcmChunk(file, info, startFrame, chunkFrames);
    if (pcm.length === 0) break;
    onFrames(pcm.length);

    const stats = pcmStats(pcm);
    if (stats.peak < SILENCE_PEAK_THRESHOLD) continue;

    const result = await transcriber.transcribe(pcm, { channels: 1, lang });
    // Two shifts onto the shared clock: where this window starts inside the track,
    // and how late the track itself started relative to the earliest one.
    const baseMs = (startFrame / info.sampleRate) * 1000 + track.offset_ms;
    for (const segment of result.segments) {
      const text = segment.text.trim();
      if (!text) continue;
      // Whisper answers near-silence with its guess at the noise — "[Music]",
      // "[BLANK_AUDIO]" — which would show up as a participant saying it. One of two
      // tracks is nearly always the quiet one, so this is the common case, not the edge.
      if (isNonSpeech(text)) continue;
      segments.push({
        speaker: track.speaker,
        start_ms: Math.round(baseMs + segment.start * 1000),
        end_ms: Math.round(baseMs + segment.end * 1000),
        text,
      });
    }
  }

  return segments;
}
