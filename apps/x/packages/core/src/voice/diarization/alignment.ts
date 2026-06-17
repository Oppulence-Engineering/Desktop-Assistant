import type { TranscriptSegment, TranscriptWord } from "@x/shared/dist/diarization.js";

/**
 * Overlap-aware alignment of whisper.cpp transcript segments to diarization
 * speaker turns (RFC 017 §5 "Alignment"):
 *
 *  1. Use time overlap between STT segments and diarization turns.
 *  2. Split a transcript segment when one STT segment spans multiple turns
 *     (only when word timestamps make a clean split possible).
 *  3. Mark low-confidence overlap as `Unknown speaker` (speakerId omitted).
 *  4. Preserve original STT timestamps for traceability.
 *
 * Diarization never discards transcript text: a segment with no usable overlap is
 * returned verbatim, just without speaker attribution (RFC 017 Decisions).
 */

/** A diarization turn: a contiguous time range attributed to one speaker. */
export interface DiarizationTurn {
  startMs: number;
  endMs: number;
  /** null = `Unknown speaker` turn. */
  speakerId: string | null;
  confidence: number;
}

/** Raw STT input prior to speaker attribution. */
export interface SttSegment {
  segmentId: string;
  text: string;
  startMs: number;
  endMs: number;
  words?: TranscriptWord[];
}

export interface AlignmentOptions {
  /**
   * Fraction of a segment a single turn must cover to claim the whole segment
   * (when word-level splitting isn't possible). Default 0.6.
   */
  dominanceThreshold?: number;
  /**
   * Minimum overlap fraction for a word/segment to be attributed at all; below
   * this it is left unknown. Default 0.5.
   */
  minAttributionOverlap?: number;
}

const DEFAULTS: Required<AlignmentOptions> = {
  dominanceThreshold: 0.6,
  minAttributionOverlap: 0.5,
};

/** Overlap in ms of [a0,a1] and [b0,b1] (0 when disjoint). */
export function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Align STT segments to turns, returning attributed (and possibly split)
 * TranscriptSegments in time order. Turns may be empty (→ all segments
 * unattributed) without error.
 */
export function alignTranscriptToSpeakers(
  segments: SttSegment[],
  turns: DiarizationTurn[],
  options: AlignmentOptions = {},
): TranscriptSegment[] {
  const opts = { ...DEFAULTS, ...options };
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    out.push(...alignOne(seg, turns, opts));
  }
  return out;
}

function alignOne(
  seg: SttSegment,
  turns: DiarizationTurn[],
  opts: Required<AlignmentOptions>,
): TranscriptSegment[] {
  const segDur = Math.max(0, seg.endMs - seg.startMs);
  const overlapping = turns
    .map((t) => ({ turn: t, ov: overlapMs(seg.startMs, seg.endMs, t.startMs, t.endMs) }))
    .filter((x) => x.ov > 0)
    .sort((a, b) => b.ov - a.ov);

  if (overlapping.length === 0) {
    return [unattributed(seg)];
  }

  const distinctSpeakers = new Set(overlapping.map((x) => x.turn.speakerId));
  const canSplit = seg.words && seg.words.length > 0 && distinctSpeakers.size > 1;

  // Multi-speaker segment with word timestamps → split cleanly by word.
  if (canSplit) {
    const split = splitByWords(seg, turns, opts);
    if (split.length > 0) return split;
  }

  // Otherwise attribute the whole segment to the dominant turn when it covers a
  // large-enough share; else leave it unknown but keep the text + timestamps.
  const top = overlapping[0];
  const dominance = segDur > 0 ? top.ov / segDur : 0;
  if (top.turn.speakerId && dominance >= opts.dominanceThreshold) {
    return [
      {
        segmentId: seg.segmentId,
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        ...(seg.words ? { words: seg.words } : {}),
        speakerId: top.turn.speakerId,
        speakerConfidence: clamp01(top.turn.confidence * dominance),
        provider: "whisper.cpp",
      },
    ];
  }
  return [unattributed(seg)];
}

/** Split a segment into runs of consecutive words sharing one speaker. */
function splitByWords(
  seg: SttSegment,
  turns: DiarizationTurn[],
  opts: Required<AlignmentOptions>,
): TranscriptSegment[] {
  const words = seg.words ?? [];
  type Tagged = { word: TranscriptWord; speakerId: string | null; confidence: number };
  const tagged: Tagged[] = words.map((w) => {
    const dur = Math.max(1, w.endMs - w.startMs);
    let best: DiarizationTurn | null = null;
    let bestOv = 0;
    for (const t of turns) {
      const ov = overlapMs(w.startMs, w.endMs, t.startMs, t.endMs);
      if (ov > bestOv) {
        bestOv = ov;
        best = t;
      }
    }
    const frac = bestOv / dur;
    if (!best || !best.speakerId || frac < opts.minAttributionOverlap) {
      return { word: w, speakerId: null, confidence: 0 };
    }
    return { word: w, speakerId: best.speakerId, confidence: clamp01(best.confidence * frac) };
  });

  const runs: TranscriptSegment[] = [];
  let i = 0;
  let part = 0;
  while (i < tagged.length) {
    const spk = tagged[i].speakerId;
    let j = i;
    let confSum = 0;
    while (j < tagged.length && tagged[j].speakerId === spk) {
      confSum += tagged[j].confidence;
      j++;
    }
    const slice = tagged.slice(i, j);
    const runWords = slice.map((s) => s.word);
    const text = runWords
      .map((w) => w.text)
      .join(" ")
      .trim();
    const startMs = runWords[0].startMs;
    const endMs = runWords[runWords.length - 1].endMs;
    runs.push({
      segmentId: `${seg.segmentId}.${part++}`,
      text,
      startMs,
      endMs,
      words: runWords,
      ...(spk ? { speakerId: spk, speakerConfidence: clamp01(confSum / slice.length) } : {}),
      provider: "whisper.cpp",
    });
    i = j;
  }
  return runs;
}

function unattributed(seg: SttSegment): TranscriptSegment {
  return {
    segmentId: seg.segmentId,
    text: seg.text,
    startMs: seg.startMs,
    endMs: seg.endMs,
    ...(seg.words ? { words: seg.words } : {}),
    provider: "whisper.cpp",
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
