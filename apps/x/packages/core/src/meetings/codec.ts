import * as path from "node:path";

/**
 * Compressing retained audio, and decoding it back.
 *
 * Capture writes uncompressed 16 kHz WAV — that is what survives a hard kill and what
 * the transcriber reads directly — at ~115 MB per hour per track. Keeping recordings at
 * that size is wasteful, so a session being *kept* gets compressed to AAC after it is
 * transcribed: roughly an eighth of the size, still playable in the app.
 *
 * Decoding is part of the same seam because compressing the WAV away would otherwise
 * cost re-transcription, which is the main reason to keep audio at all. Nothing else in
 * the repo can decode AAC — the sidecar does it with AVFoundation.
 */

export const COMPRESSED_EXTENSION = ".m4a";

/** Implemented in main over the sidecar; injected so core never spawns anything. */
export interface AudioCodec {
  compress(wavPath: string, outPath: string): Promise<void>;
  decode(compressedPath: string, outWavPath: string): Promise<void>;
}

export function isCompressed(file: string): boolean {
  return path.extname(file).toLowerCase() === COMPRESSED_EXTENSION;
}

/** `mic.wav` → `mic.m4a`. */
export function compressedName(file: string): string {
  return `${path.basename(file, path.extname(file))}${COMPRESSED_EXTENSION}`;
}

/** `mic.m4a` → `mic.decoded.wav`, a scratch file the caller deletes after use. Named
 *  distinctly so it can never be mistaken for the original capture. */
export function decodedName(file: string): string {
  return `${path.basename(file, path.extname(file))}.decoded.wav`;
}
