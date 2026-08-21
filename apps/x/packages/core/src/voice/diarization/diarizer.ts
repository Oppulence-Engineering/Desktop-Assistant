import {
  DEFAULT_DIARIZATION_SETTINGS,
  UNKNOWN_SPEAKER_LABEL,
  type DiarizationAssignment,
  type DiarizationAssignmentMethod,
  type DiarizationSettings,
  type DiarizationState,
  type SpeakerCorrection,
} from "@x/shared/diarization";
import { OnlineSpeakerClusterer, cosineSimilarity, normalizeVector } from "./clustering.js";
import type { SpeakerEmbedder } from "./embedder.js";
import type { DiarizationTurn } from "./alignment.js";

/**
 * Session-scoped diarization orchestrator (RFC 017 §"Runtime topology").
 *
 * Drives one meeting: speech segments (+PCM) → speaker embedding → online
 * clustering → per-segment assignment. It owns the meeting-local speaker state
 * and an optional trailing refinement pass that stabilizes early labels and emits
 * correction patches. Embeddings are sensitive (RFC 017 §"Privacy detail"): they
 * are held in memory only and dropped by {@link dispose}; they never appear in
 * the serialized {@link DiarizationState}.
 */

export interface DiarizerInput {
  segmentId: string;
  startMs: number;
  endMs: number;
  /** Mono 16-bit PCM for this speech region. */
  pcm: Int16Array;
  sampleRate: number;
  /** Weak meeting-layout hint (e.g. mic=0/system=1). Used only as fallback. */
  channel?: number;
  vadConfidence?: number;
  /** Estimated overlapping-speech fraction (0..1); high → low quality. */
  overlapRatio?: number;
}

export interface DiarizerTurn extends DiarizationTurn {
  segmentId: string;
  displayName: string;
  method: DiarizationAssignmentMethod;
}

export interface DiarizerOptions {
  sessionId: string;
  embedder: SpeakerEmbedder;
  settings?: Partial<DiarizationSettings>;
  /** Attribute by audio channel when embedding is inconclusive (weak hint). */
  channelFallback?: boolean;
}

interface StoredSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  embedding: Float32Array | null;
  speakerId: string | null;
  confidence: number;
  method: DiarizationAssignmentMethod;
}

export class Diarizer {
  private readonly clusterer: OnlineSpeakerClusterer;
  private readonly settings: DiarizationSettings;
  private readonly segments: StoredSegment[] = [];
  private readonly channelSpeakers = new Map<number, string>();

  constructor(private readonly opts: DiarizerOptions) {
    this.settings = { ...DEFAULT_DIARIZATION_SETTINGS, ...(opts.settings ?? {}) };
    this.clusterer = new OnlineSpeakerClusterer({
      similarityThreshold: this.settings.similarityThreshold,
      unknownThreshold: this.settings.unknownThreshold,
      centroidUpdateWeight: this.settings.centroidUpdateWeight,
      maxSpeakers: this.settings.maxSpeakers,
    });
  }

  /** Process one speech segment and return its (online) speaker turn. */
  async addSegment(input: DiarizerInput): Promise<DiarizerTurn> {
    const durMs = Math.max(0, input.endMs - input.startMs);
    const tooShort = durMs < this.settings.minSegmentMs;
    const tooOverlapped = (input.overlapRatio ?? 0) > this.settings.maxOverlapRatio;
    const lowQuality = tooShort || tooOverlapped;

    let embedding: Float32Array | null = null;
    if (!tooShort && input.pcm.length > 0) {
      const raw = await this.opts.embedder.embed(input.pcm, input.sampleRate);
      embedding = normalizeVector(raw);
    }

    let speakerId: string | null = null;
    let confidence = 0;
    let method: DiarizationAssignmentMethod = "unknown";

    if (embedding) {
      const a = this.clusterer.assign(
        embedding,
        { startMs: input.startMs, endMs: input.endMs },
        { lowQuality },
      );
      speakerId = a.speakerId;
      confidence = a.confidence;
      method = a.method;
    }

    // Weak channel hint only when embedding could not attribute a speaker.
    if (speakerId === null && this.opts.channelFallback && input.channel !== undefined) {
      speakerId = this.channelSpeaker(input.channel);
      confidence = 0.3;
      method = "channel_fallback";
    }

    this.segments.push({
      segmentId: input.segmentId,
      startMs: input.startMs,
      endMs: input.endMs,
      embedding,
      speakerId,
      confidence,
      method,
    });

    return {
      segmentId: input.segmentId,
      startMs: input.startMs,
      endMs: input.endMs,
      speakerId,
      confidence,
      method,
      displayName: this.displayNameFor(speakerId),
    };
  }

  /** Turns derived from recorded assignments, in time order (for alignment). */
  turns(): DiarizerTurn[] {
    return [...this.segments]
      .sort((a, b) => a.startMs - b.startMs)
      .map((s) => ({
        segmentId: s.segmentId,
        startMs: s.startMs,
        endMs: s.endMs,
        speakerId: s.speakerId,
        confidence: s.confidence,
        method: s.method,
        displayName: this.displayNameFor(s.speakerId),
      }));
  }

  /** Serializable meeting-scoped diarization state (no raw embeddings). */
  state(): DiarizationState {
    const snap = this.clusterer.snapshot();
    const assignments: DiarizationAssignment[] = this.segments
      .filter((s) => s.speakerId !== null)
      .map((s) => ({
        segmentId: s.segmentId,
        speakerId: s.speakerId as string,
        confidence: s.confidence,
        method: s.method,
      }));
    return {
      sessionId: this.opts.sessionId,
      modelVersion: this.opts.embedder.id,
      speakers: snap,
      assignments,
    };
  }

  /**
   * Trailing refinement (RFC 017 §"Online versus trailing refinement"): rebuild
   * each speaker centroid from all of its confidently-embedded segments, then
   * re-assign every segment to the nearest final centroid. Returns the label
   * corrections (stable segment ids) the UI should apply as patches.
   */
  refine(): SpeakerCorrection[] {
    if (!this.settings.refinement) return [];

    // Final centroids = mean of embeddings grouped by current speaker.
    const groups = new Map<string, Float32Array[]>();
    for (const s of this.segments) {
      if (s.speakerId && s.embedding) {
        const list = groups.get(s.speakerId) ?? [];
        list.push(s.embedding);
        groups.set(s.speakerId, list);
      }
    }
    const centroids = new Map<string, Float32Array>();
    for (const [id, vecs] of groups) centroids.set(id, meanUnit(vecs));

    const corrections: SpeakerCorrection[] = [];
    for (const s of this.segments) {
      if (!s.embedding) continue;
      let bestId: string | null = null;
      let bestSim = -1;
      for (const [id, c] of centroids) {
        const sim = cosineSimilarity(s.embedding, c);
        if (sim > bestSim) {
          bestSim = sim;
          bestId = id;
        }
      }
      const next = bestId && bestSim >= this.settings.similarityThreshold ? bestId : null;
      if (next !== s.speakerId) {
        corrections.push({
          segmentId: s.segmentId,
          ...(s.speakerId ? { fromSpeakerId: s.speakerId } : {}),
          toSpeakerId: next ?? "",
          fromDisplayName: this.displayNameFor(s.speakerId),
          toDisplayName: this.displayNameFor(next),
        });
        s.speakerId = next;
        s.confidence = next ? clamp01(bestSim) : 0;
        s.method = next ? "embedding_cluster" : "unknown";
      }
    }
    return corrections;
  }

  /** Drop sensitive embeddings from memory (RFC 017 privacy). */
  dispose(): void {
    for (const s of this.segments) s.embedding = null;
  }

  // ---- internals ----

  private channelSpeaker(channel: number): string {
    const existing = this.channelSpeakers.get(channel);
    if (existing) return existing;
    const id = `chan_${channel}`;
    this.channelSpeakers.set(channel, id);
    return id;
  }

  private displayNameFor(speakerId: string | null): string {
    if (!speakerId) return UNKNOWN_SPEAKER_LABEL;
    const snap = this.clusterer.snapshot().find((s) => s.speakerId === speakerId);
    if (snap) return snap.displayName;
    // Channel-fallback pseudo-speaker: present as the next anonymous label slot.
    const channelEntry = [...this.channelSpeakers.entries()].find(([, id]) => id === speakerId);
    if (channelEntry) return `Speaker ${this.clusterer.speakerCount + channelEntry[0] + 1}`;
    return UNKNOWN_SPEAKER_LABEL;
  }
}

function meanUnit(vecs: Float32Array[]): Float32Array {
  if (vecs.length === 0) return new Float32Array(0);
  const dim = vecs[0].length;
  const acc = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) acc[i] += v[i];
  for (let i = 0; i < dim; i++) acc[i] /= vecs.length;
  return normalizeVector(acc);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
