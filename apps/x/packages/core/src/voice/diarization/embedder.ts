/**
 * Speaker embedding (RFC 017 §3). An embedder turns a speech segment's PCM into a
 * fixed-length vector whose cosine distance separates speakers. The real product
 * model is an ONNX/pyannote-family encoder installed by the model manager; that
 * runtime is injected (see {@link createEmbedder}) so this module stays free of a
 * native dependency and fully unit-testable.
 *
 * {@link EnergyProfileEmbedder} is a dependency-free, deterministic embedder used
 * for fixture runs, tests, and as a graceful fallback when the model/runtime is
 * unavailable. It is a coarse pitch/timbre fingerprint (a Goertzel filterbank +
 * ZCR + RMS), NOT a learned speaker model — good enough to cluster clearly
 * distinct voices in fixtures, but it must not graduate diarization out of beta
 * on its own.
 */

export interface SpeakerEmbedder {
  /** Model id recorded in provenance (e.g. "speaker-embedding-v1"). */
  readonly id: string;
  /** Embedding dimensionality. */
  readonly dim: number;
  /** Embed one mono 16-bit PCM segment into a vector. */
  embed(pcm: Int16Array, sampleRate: number): Promise<Float32Array>;
  dispose?(): void;
}

/** Injected native inference callback (e.g. an ONNX session). */
export type EmbedInfer = (pcm: Int16Array, sampleRate: number) => Promise<Float32Array>;

/** Log-spaced Goertzel center frequencies (Hz) spanning the voice band. */
function bandFrequencies(count: number, lo = 80, hi = 4000): number[] {
  const freqs: number[] = [];
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    freqs.push(Math.exp(logLo + t * (logHi - logLo)));
  }
  return freqs;
}

/** Single Goertzel magnitude for frequency `f` over the first `len` samples. */
function goertzel(pcm: Int16Array, len: number, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    const x = pcm[i] / 32768;
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / Math.max(1, len);
}

export class EnergyProfileEmbedder implements SpeakerEmbedder {
  readonly id: string;
  readonly dim: number;
  private readonly bands: number[];
  private readonly maxSamples: number;

  constructor(opts: { id?: string; bands?: number; maxAnalyzeSeconds?: number } = {}) {
    const bandCount = opts.bands ?? 24;
    this.bands = bandFrequencies(bandCount);
    this.dim = bandCount + 2; // + ZCR + RMS
    this.id = opts.id ?? "energy-profile-fixture";
    this.maxSamples = Math.round((opts.maxAnalyzeSeconds ?? 4) * 16000);
  }

  async embed(pcm: Int16Array, sampleRate: number): Promise<Float32Array> {
    const len = Math.min(pcm.length, this.maxSamples);
    const v = new Float32Array(this.dim);
    if (len === 0) return v;

    // Band energies (log-compressed for perceptual spacing).
    for (let b = 0; b < this.bands.length; b++) {
      const mag = goertzel(pcm, len, this.bands[b], sampleRate);
      v[b] = Math.log1p(mag * 1000);
    }

    // Zero-crossing rate (timbre/voicing hint).
    let crossings = 0;
    for (let i = 1; i < len; i++) {
      if (pcm[i] >= 0 !== pcm[i - 1] >= 0) crossings++;
    }
    v[this.bands.length] = crossings / len;

    // RMS energy.
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const s = pcm[i] / 32768;
      sumSq += s * s;
    }
    v[this.bands.length + 1] = Math.sqrt(sumSq / len);

    return v;
  }
}

/** An embedder backed by an injected native inference function (ONNX runtime). */
export class NativeSpeakerEmbedder implements SpeakerEmbedder {
  constructor(
    readonly id: string,
    readonly dim: number,
    private readonly infer: EmbedInfer,
  ) {}

  embed(pcm: Int16Array, sampleRate: number): Promise<Float32Array> {
    return this.infer(pcm, sampleRate);
  }
}

export interface CreateEmbedderOptions {
  /** Model id to record in provenance. */
  modelId?: string;
  /** Force the deterministic embedder (LOCAL_DIARIZATION_FIXTURE_MODE / tests). */
  fixtureMode?: boolean;
  /** Native inference + its dimensionality, when the real model is installed. */
  native?: { infer: EmbedInfer; dim: number };
}

/**
 * Build the embedder for a session. Uses the native model when supplied and not
 * in fixture mode; otherwise falls back to the deterministic energy-profile
 * embedder so diarization degrades gracefully instead of failing the meeting.
 */
export function createEmbedder(opts: CreateEmbedderOptions = {}): SpeakerEmbedder {
  if (!opts.fixtureMode && opts.native) {
    return new NativeSpeakerEmbedder(
      opts.modelId ?? "speaker-embedding-v1",
      opts.native.dim,
      opts.native.infer,
    );
  }
  return new EnergyProfileEmbedder({ id: opts.modelId ?? "energy-profile-fixture" });
}
