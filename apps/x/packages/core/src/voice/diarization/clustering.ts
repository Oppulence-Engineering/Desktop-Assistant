import {
  DEFAULT_DIARIZATION_SETTINGS,
  speakerDisplayName,
  UNKNOWN_SPEAKER_LABEL,
  type DiarizationAssignmentMethod,
} from "@x/shared/dist/diarization.js";

/**
 * Online speaker clustering (RFC 017 §"Embedding and clustering details").
 *
 * Conservative, meeting-scoped, centroid-based assignment:
 *  1. Compare an incoming embedding to existing speaker centroids (cosine).
 *  2. Assign to the nearest centroid above `similarityThreshold`.
 *  3. Create a new speaker when nothing is close enough and `maxSpeakers` is not
 *     exceeded.
 *  4. Update the matched centroid with a weighted running average.
 *  5. Prefer `Unknown speaker` over a false confident assignment (below
 *     `unknownThreshold`, or when the speaker cap is reached with no good match).
 *
 * It holds no audio and no raw vectors leave this object except as the opaque
 * centroid reference exposed via {@link snapshot}.
 */

export interface ClustererTunables {
  similarityThreshold: number;
  unknownThreshold: number;
  centroidUpdateWeight: number;
  maxSpeakers: number;
}

export interface ClusterAssignment {
  /** The assigned speaker id, or null when left unattributed. */
  speakerId: string | null;
  displayName: string;
  confidence: number;
  method: DiarizationAssignmentMethod;
}

interface SpeakerCentroid {
  speakerId: string;
  index: number; // 1-based, for the anonymous display name
  vector: Float32Array; // unit-normalized running centroid
  segmentCount: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface SpeakerSnapshot {
  speakerId: string;
  displayName: string;
  embeddingCentroidRef: string;
  segmentCount: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

/** Cosine similarity of two equal-length vectors; 0 for a zero/empty vector. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Return a unit-normalized copy; a zero vector is returned unchanged. */
export function normalizeVector(v: ArrayLike<number>): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export class OnlineSpeakerClusterer {
  private readonly speakers: SpeakerCentroid[] = [];
  private nextIndex = 1;
  private readonly t: ClustererTunables;

  constructor(tunables: Partial<ClustererTunables> = {}) {
    this.t = {
      similarityThreshold:
        tunables.similarityThreshold ?? DEFAULT_DIARIZATION_SETTINGS.similarityThreshold,
      unknownThreshold: tunables.unknownThreshold ?? DEFAULT_DIARIZATION_SETTINGS.unknownThreshold,
      centroidUpdateWeight:
        tunables.centroidUpdateWeight ?? DEFAULT_DIARIZATION_SETTINGS.centroidUpdateWeight,
      maxSpeakers: tunables.maxSpeakers ?? DEFAULT_DIARIZATION_SETTINGS.maxSpeakers,
    };
  }

  /**
   * Assign an embedding (captured at [startMs,endMs]) to a speaker. Returns the
   * assignment; mutates internal centroid state when a confident match or a new
   * speaker is created. An embedding marked `lowQuality` (overlap/too-short) is
   * never used to create or update a centroid and resolves to unknown.
   */
  assign(
    embedding: ArrayLike<number>,
    span: { startMs: number; endMs: number },
    opts: { lowQuality?: boolean } = {},
  ): ClusterAssignment {
    const vec = normalizeVector(embedding);
    if (this.isZero(vec)) return this.unknown();

    let best: SpeakerCentroid | null = null;
    let bestSim = -1;
    for (const s of this.speakers) {
      const sim = cosineSimilarity(vec, s.vector);
      if (sim > bestSim) {
        bestSim = sim;
        best = s;
      }
    }

    // A confident match to an existing speaker.
    if (best && bestSim >= this.t.similarityThreshold) {
      if (!opts.lowQuality) this.update(best, vec, span);
      return {
        speakerId: best.speakerId,
        displayName: speakerDisplayName(best.index),
        confidence: clamp01(bestSim),
        method: "embedding_cluster",
      };
    }

    // Low quality, or a weak match that we won't trust → leave unknown without
    // polluting any centroid.
    if (opts.lowQuality || bestSim >= this.t.unknownThreshold) {
      return this.unknown(bestSim);
    }

    // Confidently distinct from every existing speaker → a new speaker, unless
    // we have hit the cap (then prefer unknown over over-splitting).
    if (this.speakers.length >= this.t.maxSpeakers) {
      return this.unknown(bestSim);
    }
    return this.create(vec, span);
  }

  /** Current speakers as opaque snapshots (no raw vectors). */
  snapshot(): SpeakerSnapshot[] {
    return this.speakers.map((s) => ({
      speakerId: s.speakerId,
      displayName: speakerDisplayName(s.index),
      embeddingCentroidRef: `centroid:${s.speakerId}`,
      segmentCount: s.segmentCount,
      firstSeenMs: s.firstSeenMs,
      lastSeenMs: s.lastSeenMs,
    }));
  }

  /** Number of distinct speakers discovered so far. */
  get speakerCount(): number {
    return this.speakers.length;
  }

  // ---- internals ----

  private create(vec: Float32Array, span: { startMs: number; endMs: number }): ClusterAssignment {
    const index = this.nextIndex++;
    const speakerId = `spk_${index}`;
    this.speakers.push({
      speakerId,
      index,
      vector: vec,
      segmentCount: 1,
      firstSeenMs: span.startMs,
      lastSeenMs: span.endMs,
    });
    return {
      speakerId,
      displayName: speakerDisplayName(index),
      confidence: 1,
      method: "embedding_cluster",
    };
  }

  private update(
    s: SpeakerCentroid,
    vec: Float32Array,
    span: { startMs: number; endMs: number },
  ): void {
    const w = this.t.centroidUpdateWeight;
    const next = new Float32Array(s.vector.length);
    for (let i = 0; i < next.length; i++) next[i] = (1 - w) * s.vector[i] + w * vec[i];
    s.vector = normalizeVector(next);
    s.segmentCount += 1;
    s.firstSeenMs = Math.min(s.firstSeenMs, span.startMs);
    s.lastSeenMs = Math.max(s.lastSeenMs, span.endMs);
  }

  private unknown(confidence = 0): ClusterAssignment {
    return {
      speakerId: null,
      displayName: UNKNOWN_SPEAKER_LABEL,
      confidence: clamp01(Math.max(0, confidence)),
      method: "unknown",
    };
  }

  private isZero(v: Float32Array): boolean {
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) return false;
    return true;
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
