/**
 * PCM ↔ WAV helpers (RFC 009 §10, Appendices D & M).
 *
 * The renderer captures 16 kHz `pcm_s16le` directly (its `AudioContext` resamples
 * device audio to 16 kHz), so the main process never resamples on the normal path —
 * it only wraps the raw int16 samples in a 44-byte RIFF header for `whisper-cli -f`.
 */

export interface WavOptions {
  sampleRate?: number;
  channels?: 1 | 2;
}

/**
 * Wrap raw signed-16-bit little-endian PCM in a canonical 44-byte WAV header.
 * `pcm` is the interleaved sample bytes (mono, or L/R-interleaved for stereo).
 */
export function pcm16ToWav(
  pcm: ArrayBufferLike,
  { sampleRate = 16000, channels = 1 }: WavOptions = {},
): Buffer {
  const data = Buffer.from(pcm);
  const blockAlign = channels * 2; // 16-bit → 2 bytes per sample per channel
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4); // file size minus the first 8 bytes
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Split L/R-interleaved stereo int16 into two mono channels.
 * For meetings: channel 0 = mic ("You"), channel 1 = system audio ("Other").
 */
export function deinterleaveStereoI16(interleaved: Int16Array): {
  mic: Int16Array;
  sys: Int16Array;
} {
  const n = interleaved.length >> 1;
  const mic = new Int16Array(n);
  const sys = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    mic[i] = interleaved[2 * i];
    sys[i] = interleaved[2 * i + 1];
  }
  return { mic, sys };
}

/**
 * Convert float32 samples (Web Audio range [-1, 1]) to int16 PCM with asymmetric
 * full-scale and clamping (no wrap). Mirrors the renderer's capture conversion;
 * kept here for any main-side resample/deinterleave path (Appendix M).
 */
export function f32ToI16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
}

/** Concatenate a list of int16 frames into one contiguous buffer. */
export function concatI16(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}
