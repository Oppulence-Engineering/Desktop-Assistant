import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  MeetingSessionMeta,
  MeetingTrackMeta,
  MeetingTranscript,
  MeetingTranscriptSegment,
} from "@x/shared/meetings";
import { isNonSpeech, pcmStats } from "../voice/whisper/index.js";
import { decodedName, isCompressed, type AudioCodec } from "./codec.js";
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

/**
 * Below this peak a window holds no speech worth transcribing. Skipping it is faster
 * and, more importantly, stops whisper inventing text for silence.
 *
 * In the same int16 units `pcmStats` reports (0…32767), **not** normalized — comparing
 * a 0…1 threshold against those made this skip fire only on a perfectly zero window.
 * 164 is ≈0.005 full scale, about −46 dBFS: far below anything audible as speech.
 */
export const SILENCE_PEAK_THRESHOLD = 164;

/** The slice of `WhisperService` this needs, so tests inject a fake instead of a
 *  model download. Mirrors the DI seam in `core/src/mailbox`. */
export interface MeetingTranscriber {
  transcribe(
    pcm: Int16Array,
    opts: { channels: 1; model?: string; lang?: string },
  ): Promise<{
    segments: { start: number; end: number; text: string }[];
    /**
     * The language the engine actually ran in, when it reports one.
     *
     * whisper reports this (`result.language` in its `-oj` output). **Parakeet does
     * not** — the sidecar's JSON carries only engine, model and segments — so a
     * Parakeet session leaves this undefined and the once-per-session resolution below
     * cannot latch. An explicit language still reaches Parakeet through `--language`;
     * it is only `auto` that stays per-window there. Giving the sidecar a detected
     * language to report would close that gap.
     */
    language?: string;
    /** False for `.en` models, which ignore the requested language entirely. */
    multilingualModel?: boolean;
  }>;
}

/**
 * The session's language, resolved once and then reused.
 *
 * `auto` is deliberately **not** passed to every window. Transcription runs in
 * 10-minute chunks across two tracks, and the dual-track design guarantees one track is
 * usually near-silent — which is exactly where detection misfires. Detecting per window
 * lets a meeting come back half French and half Portuguese. So the first window that
 * reports a language fixes it for every window after it, on both tracks.
 */
interface SessionLanguage {
  /** True when the user asked for detection rather than naming a language. */
  readonly autoDetect: boolean;
  /** The explicit code the user chose, when they chose one. */
  readonly requested?: string;
  /** Set by the first window that reported one; reused from then on. */
  resolved?: string;
  /**
   * What the engine actually used, which is not always what was asked for: whisper.cpp
   * ignores `--language` on an English-only model and reports `en` regardless. Recording
   * the request instead of the result would misreport precisely the broken case.
   */
  effective?: string;
  /** Set when an English-only model silently discarded a non-English request. */
  modelIgnoredLanguage?: boolean;
}

/** The language to hand the engine for the next window. */
function nextRequest(language: SessionLanguage): string | undefined {
  if (!language.autoDetect) return language.requested;
  return language.resolved ?? "auto";
}

/** Fold one window's result back into the session's language state. */
function observeLanguage(language: SessionLanguage, result: { language?: string; multilingualModel?: boolean }): void {
  const reported = result.language?.trim();
  if (reported) {
    language.effective ??= reported;
    if (language.autoDetect) language.resolved ??= reported;
  }
  if (
    result.multilingualModel === false &&
    language.requested &&
    language.requested !== "en" &&
    language.requested !== "auto"
  ) {
    language.modelIgnoredLanguage = true;
  }
}

/**
 * Track order for transcription.
 *
 * Only matters while the language is still being detected: the track carrying the most
 * signal is the one whose detection is worth trusting, so it runs first and everything
 * after it inherits the answer. Output ordering is unaffected — segments are sorted onto
 * the shared clock at the end regardless of the order they were produced in.
 */
export function transcriptionOrder(tracks: MeetingTrackMeta[]): MeetingTrackMeta[] {
  return [...tracks].sort((a, b) => {
    if (a.silent !== b.silent) return a.silent ? 1 : -1;
    return b.peak - a.peak;
  });
}

export interface TranscribeSessionOpts {
  dir: string;
  meta: MeetingSessionMeta;
  transcriber: MeetingTranscriber;
  engine: string;
  model: string;
  lang?: string;
  /** Needed only to re-transcribe a session whose audio was compressed. */
  codec?: AudioCodec;
  /** Window size, for tests and for engines that prefer a different granularity. */
  chunkSeconds?: number;
  /** 0…1 across all tracks in this session. */
  onProgress?: (fraction: number) => void;
  now?: () => Date;
}

export async function transcribeSession(opts: TranscribeSessionOpts): Promise<MeetingTranscript> {
  const { dir, meta, transcriber, engine, model, lang, onProgress } = opts;
  const now = opts.now ?? (() => new Date());

  const totalFrames = meta.tracks.reduce((sum, track) => sum + Math.max(0, track.frames), 0) || 1;
  let framesDone = 0;
  let failures = 0;
  const segments: MeetingTranscriptSegment[] = [];

  // An unset language is detection, not English. The old behaviour — no `lang` reaching
  // the runner, which then defaulted to `-l en` — is the bug this exists to close.
  const language: SessionLanguage = {
    autoDetect: !lang || lang === "auto",
    requested: lang && lang !== "auto" ? lang : undefined,
  };

  for (const track of transcriptionOrder(meta.tracks)) {
    // One unreadable track must not cost us the other's transcript — a denied
    // system-audio grant is common, and your own half is still worth having.
    try {
      const trackSegments = await transcribeTrack({
        dir,
        track,
        transcriber,
        language,
        codec: opts.codec,
        chunkSeconds: opts.chunkSeconds ?? CHUNK_SECONDS,
        onFrames: (frames) => {
          framesDone += frames;
          onProgress?.(Math.min(1, framesDone / totalFrames));
        },
      });
      segments.push(...trackSegments);
    } catch (err) {
      failures += 1;
      await appendLog(dir, `skipping ${track.file}: ${(err as Error).message}`);
    }
  }

  // "Nothing was said" and "nothing could be read" must not look the same. Returning an
  // empty transcript for a total failure would mark the session done, overwrite its note
  // with a blank one, and — with the default retention — delete the audio, losing the
  // meeting outright. A missing whisper binary alone is enough to reach this.
  if (meta.tracks.length > 0 && failures === meta.tracks.length) {
    throw new Error(
      `no track could be transcribed (${failures}/${meta.tracks.length}) — see transcribe.log`,
    );
  }

  segments.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);

  if (language.modelIgnoredLanguage) {
    await appendLog(
      dir,
      `language: asked for ${language.requested} but the model is English-only — it transcribed as ${language.effective ?? "en"}. Switch to a multilingual model and re-transcribe.`,
    );
  } else if (language.autoDetect && !language.resolved && segments.length > 0) {
    // Speech, but the engine never named a language. whisper always does; Parakeet never
    // does, so this is also the normal Parakeet-on-auto case — and there it means each
    // window detected independently rather than the session resolving once. Either way
    // the honest thing is to claim no language rather than guess one.
    await appendLog(
      dir,
      "language: the engine reported none, so the session language is unknown and each window detected on its own",
    );
  } else if (language.effective) {
    await appendLog(
      dir,
      `language: ${language.effective}${language.autoDetect ? " (detected)" : ""}`,
    );
  }

  return {
    schema: 1,
    engine,
    model,
    created_at: now().toISOString(),
    ...(language.effective ? { language: language.effective } : {}),
    ...(language.effective ? { language_detected: language.autoDetect } : {}),
    segments,
  };
}

async function transcribeTrack(args: {
  dir: string;
  track: MeetingTrackMeta;
  transcriber: MeetingTranscriber;
  language: SessionLanguage;
  codec?: AudioCodec;
  chunkSeconds: number;
  onFrames: (frames: number) => void;
}): Promise<MeetingTranscriptSegment[]> {
  const { dir, track, transcriber, language, codec, chunkSeconds, onFrames } = args;

  // A track the sidecar already flagged silent has nothing to transcribe. This is
  // the failure mode that looks like success — correct duration, no signal — so it
  // is worth naming in the log rather than silently producing an empty transcript.
  if (track.silent) {
    await appendLog(dir, `${track.file}: recorded silence (peak 0) — nothing to transcribe`);
    onFrames(track.frames);
    return [];
  }

  // Retained audio is compressed, so re-transcribing means decoding back to the WAV
  // capture produced. The scratch file is cleaned up in `finally` — otherwise a
  // failure part-way through would silently double the session's disk use.
  let file = path.join(dir, track.file);
  let scratch: string | undefined;

  try {
    if (isCompressed(track.file)) {
      if (!codec) throw new Error(`${track.file} is compressed and no decoder is available`);
      scratch = path.join(dir, decodedName(track.file));
      // Inside the try: a decode that fails part-way still leaves a partial file, and
      // cleaning up only around the transcribe call would leak it.
      await codec.decode(file, scratch);
      file = scratch;
    }

    return await transcribeDecodedTrack({
      dir,
      track,
      file,
      transcriber,
      language,
      chunkSeconds,
      onFrames,
    });
  } finally {
    if (scratch) await fs.rm(scratch, { force: true }).catch(() => {});
  }
}

async function transcribeDecodedTrack(args: {
  dir: string;
  track: MeetingTrackMeta;
  file: string;
  transcriber: MeetingTranscriber;
  language: SessionLanguage;
  chunkSeconds: number;
  onFrames: (frames: number) => void;
}): Promise<MeetingTranscriptSegment[]> {
  const { dir, track, file, transcriber, language, chunkSeconds, onFrames } = args;

  // Repair a header the writer never finalized before reading, so the retained file
  // is also playable afterwards.
  if (await recoverWavHeader(file)) {
    await appendLog(dir, `${track.file}: recovered an unfinalized WAV header`);
  }

  const info = await readWavInfo(file);
  if (info.channels !== 1) {
    throw new Error(`expected mono, got ${info.channels} channels`);
  }

  const chunkFrames = Math.floor(chunkSeconds * info.sampleRate);
  const segments: MeetingTranscriptSegment[] = [];

  for (let startFrame = 0; startFrame < info.frames; startFrame += chunkFrames) {
    const pcm = await readPcmChunk(file, info, startFrame, chunkFrames);
    if (pcm.length === 0) break;
    onFrames(pcm.length);

    const stats = pcmStats(pcm);
    if (stats.peak < SILENCE_PEAK_THRESHOLD) continue;

    const result = await transcriber.transcribe(pcm, { channels: 1, lang: nextRequest(language) });
    observeLanguage(language, result);
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
