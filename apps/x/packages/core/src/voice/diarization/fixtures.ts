import {
  DEFAULT_DIARIZATION_SETTINGS,
  type DiarizationSettings,
  type DiarizationState,
} from "@x/shared/diarization";
import { Diarizer, type DiarizerTurn } from "./diarizer.js";
import { createEmbedder } from "./embedder.js";
import {
  diarizationErrorRate,
  jaccardErrorRate,
  speakerCountAccuracy,
  splitMergeRates,
  unknownRate,
  type DerResult,
  type LabeledTurn,
} from "./metrics.js";

/**
 * Offline fixture runner (RFC 017 §"Fixture runner"). It runs the diarizer over a
 * fixture WAV with the deterministic energy-profile embedder + a simple offline
 * VAD — no whisper binary or native model required — so DER/JER and performance
 * stats can be measured in CI on any host. The report computation is pure; the
 * thin CLI (scripts/diarize-fixtures.mjs) wires file IO around it.
 */

export interface DecodedWav {
  pcm: Int16Array; // interleaved if channels > 1
  sampleRate: number;
  channels: number;
}

/** Minimal PCM16 WAV decoder (RIFF/`data`); throws on a non-PCM16 file. */
export function decodeWav(input: ArrayBuffer | Uint8Array): DecodedWav {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) =>
    String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");

  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOff = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
    }
    off = body + size + (size % 2); // chunks are word-aligned
  }
  if (dataOff < 0) throw new Error("no data chunk");
  if (bitsPerSample !== 16) throw new Error(`unsupported bits/sample ${bitsPerSample}`);
  const count = Math.floor(dataLen / 2);
  const pcm = new Int16Array(count);
  for (let i = 0; i < count; i++) pcm[i] = view.getInt16(dataOff + i * 2, true);
  return { pcm, sampleRate, channels };
}

export interface OfflineVadOptions {
  frameMs?: number; // analysis window, default 30
  minSpeechMs?: number; // default 250
  minSilenceMs?: number; // default 300
  maxSegmentMs?: number; // default 28000
  /** RMS (0..1) above which a frame is speech. Default: relative to peak. */
  energyThreshold?: number;
}

export interface OfflineSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  pcm: Int16Array;
}

/** Energy-threshold offline VAD producing speech segments from mono PCM. */
export function offlineVadSegments(
  pcm: Int16Array,
  sampleRate: number,
  options: OfflineVadOptions = {},
): OfflineSegment[] {
  const frameMs = options.frameMs ?? 30;
  const minSpeechMs = options.minSpeechMs ?? 250;
  const minSilenceMs = options.minSilenceMs ?? 300;
  const maxSegmentMs = options.maxSegmentMs ?? 28000;
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frameCount = Math.ceil(pcm.length / frameLen);

  const rms = new Float32Array(frameCount);
  let peak = 0;
  for (let f = 0; f < frameCount; f++) {
    let sumSq = 0;
    const lo = f * frameLen;
    const hi = Math.min(pcm.length, lo + frameLen);
    for (let i = lo; i < hi; i++) {
      const s = pcm[i] / 32768;
      sumSq += s * s;
    }
    rms[f] = Math.sqrt(sumSq / Math.max(1, hi - lo));
    peak = Math.max(peak, rms[f]);
  }
  const threshold = options.energyThreshold ?? Math.max(0.01, peak * 0.15);

  const segments: OfflineSegment[] = [];
  let inSpeech = false;
  let segStartFrame = 0;
  let silenceRun = 0;
  const minSilenceFrames = Math.ceil(minSilenceMs / frameMs);
  let part = 0;

  const flush = (startFrame: number, endFrame: number) => {
    const startMs = startFrame * frameMs;
    const endMs = endFrame * frameMs;
    if (endMs - startMs < minSpeechMs) return;
    const lo = startFrame * frameLen;
    const hi = Math.min(pcm.length, endFrame * frameLen);
    segments.push({ segmentId: `seg_${part++}`, startMs, endMs, pcm: pcm.slice(lo, hi) });
  };

  for (let f = 0; f < frameCount; f++) {
    const speech = rms[f] >= threshold;
    if (!inSpeech) {
      if (speech) {
        inSpeech = true;
        segStartFrame = f;
        silenceRun = 0;
      }
    } else {
      if (speech) {
        silenceRun = 0;
        if ((f - segStartFrame) * frameMs >= maxSegmentMs) {
          flush(segStartFrame, f);
          segStartFrame = f;
        }
      } else {
        silenceRun++;
        if (silenceRun >= minSilenceFrames) {
          flush(segStartFrame, f - silenceRun + 1);
          inSpeech = false;
        }
      }
    }
  }
  if (inSpeech) flush(segStartFrame, frameCount);
  return segments;
}

export interface DiarizerRunResult {
  turns: DiarizerTurn[];
  state: DiarizationState;
  elapsedMs: number;
}

/**
 * Run the full diarizer over mono PCM (offline VAD → embed → cluster). Used by
 * the fixture runner and the developer flag's offline self-test.
 */
export async function runDiarizerOverPcm(
  pcm: Int16Array,
  sampleRate: number,
  settings: Partial<DiarizationSettings> = {},
  now: () => number = Date.now,
): Promise<DiarizerRunResult> {
  const merged = { ...DEFAULT_DIARIZATION_SETTINGS, ...settings };
  const embedder = createEmbedder({ fixtureMode: true, modelId: merged.model });
  const diarizer = new Diarizer({ sessionId: "fixture", embedder, settings: merged });
  const vad = offlineVadSegments(pcm, sampleRate);
  const start = now();
  for (const seg of vad) {
    await diarizer.addSegment({
      segmentId: seg.segmentId,
      startMs: seg.startMs,
      endMs: seg.endMs,
      pcm: seg.pcm,
      sampleRate,
      vadConfidence: 1,
    });
  }
  if (merged.refinement) diarizer.refine();
  const elapsedMs = now() - start;
  return { turns: diarizer.turns(), state: diarizer.state(), elapsedMs };
}

/** Convert diarizer turns to scoreable labeled turns (unknown → "" silent). */
export function turnsToLabeled(turns: DiarizerTurn[]): LabeledTurn[] {
  return turns.map((t) => ({
    startMs: t.startMs,
    endMs: t.endMs,
    speakerId: t.speakerId ?? "",
  }));
}

/** Frame-grid confusion matrix: reference speaker → { hyp speaker → ms }. */
export function confusionMatrix(
  reference: LabeledTurn[],
  hypothesis: LabeledTurn[],
  frameMs = 10,
): Record<string, Record<string, number>> {
  const end = Math.max(0, ...reference.map((t) => t.endMs), ...hypothesis.map((t) => t.endMs));
  const frames = Math.ceil(end / frameMs);
  const grid = (turns: LabeledTurn[]) => {
    const g = new Array<string>(frames).fill("");
    for (const t of turns) {
      const lo = Math.max(0, Math.floor(t.startMs / frameMs));
      const hi = Math.min(frames, Math.ceil(t.endMs / frameMs));
      for (let i = lo; i < hi; i++) g[i] = t.speakerId;
    }
    return g;
  };
  const ref = grid(reference);
  const hyp = grid(hypothesis);
  const matrix: Record<string, Record<string, number>> = {};
  for (let i = 0; i < frames; i++) {
    const r = ref[i] || "∅";
    const h = hyp[i] || "∅";
    (matrix[r] ??= {})[h] = (matrix[r][h] ?? 0) + frameMs;
  }
  return matrix;
}

export interface FixtureDatasetMeta {
  name: string;
  category?: string; // one_speaker | two_speakers | crosstalk | noisy | remote_call | ...
  durationMs?: number;
}

export interface FixtureReport {
  dataset: FixtureDatasetMeta;
  der: DerResult;
  jer: number;
  speakerCount: { refSpeakers: number; hypSpeakers: number; error: number };
  splitMerge: { falseSplit: number; falseMerge: number };
  unknownRate: number;
  confusion: Record<string, Record<string, number>>;
  timing: { elapsedMs: number; realTimeFactor?: number };
  memory?: { peakRssMb?: number };
}

export interface BuildReportInput {
  dataset: FixtureDatasetMeta;
  reference: LabeledTurn[];
  hypothesisTurns: DiarizerTurn[];
  elapsedMs: number;
  audioDurationMs?: number;
  peakRssMb?: number;
}

/** Assemble the full fixture report (pure; the heart of the CI gate). */
export function buildFixtureReport(input: BuildReportInput): FixtureReport {
  const hyp = turnsToLabeled(input.hypothesisTurns);
  const der = diarizationErrorRate(input.reference, hyp);
  return {
    dataset: input.dataset,
    der,
    jer: jaccardErrorRate(input.reference, hyp),
    speakerCount: speakerCountAccuracy(input.reference, hyp),
    splitMerge: splitMergeRates(input.reference, hyp),
    unknownRate: unknownRate(
      input.hypothesisTurns.map((t) => ({
        startMs: t.startMs,
        endMs: t.endMs,
        speakerId: t.speakerId ?? "",
      })),
    ),
    confusion: confusionMatrix(input.reference, hyp),
    timing: {
      elapsedMs: input.elapsedMs,
      ...(input.audioDurationMs && input.elapsedMs
        ? { realTimeFactor: input.elapsedMs / input.audioDurationMs }
        : {}),
    },
    ...(input.peakRssMb !== undefined ? { memory: { peakRssMb: input.peakRssMb } } : {}),
  };
}
