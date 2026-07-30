import * as fs from "node:fs/promises";

/**
 * Reading the sidecar's capture files.
 *
 * `oppulence-audiocap` writes a canonical 44-byte PCM header up front with zero
 * sizes and appends samples as they arrive, patching the two size fields on clean
 * stop. That makes a killed process lose nothing but those two fields — so every
 * read here derives the sample count from the file length when the header says zero,
 * and {@link recoverWavHeader} can repair the file in place so it is playable again.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Byte offset of the first sample. */
  dataOffset: number;
  dataBytes: number;
  frames: number;
  /** True when the header's size fields were zero/short and we derived the real
   *  length from the file — i.e. the writer was killed before finalizing. */
  headerTruncated: boolean;
}

export class WavError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${message}: ${file}`);
    this.name = "WavError";
  }
}

const HEADER_SCAN_BYTES = 4096;

/**
 * Parse enough of the RIFF header to read samples. Walks the chunk list rather
 * than assuming a 44-byte header, so files from elsewhere (an imported recording
 * with a LIST chunk) also work.
 */
export async function readWavInfo(file: string): Promise<WavInfo> {
  const stat = await fs.stat(file);
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(Math.min(HEADER_SCAN_BYTES, stat.size));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (
      bytesRead < 12 ||
      head.toString("ascii", 0, 4) !== "RIFF" ||
      head.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new WavError("not a RIFF/WAVE file", file);
    }

    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let dataOffset = 0;
    let declaredDataBytes = 0;

    let cursor = 12;
    while (cursor + 8 <= bytesRead) {
      const id = head.toString("ascii", cursor, cursor + 4);
      const size = head.readUInt32LE(cursor + 4);
      const body = cursor + 8;
      if (id === "fmt " && body + 16 <= bytesRead) {
        const format = head.readUInt16LE(body);
        if (format !== 1) throw new WavError(`unsupported WAV format ${format}`, file);
        channels = head.readUInt16LE(body + 2);
        sampleRate = head.readUInt32LE(body + 4);
        bitsPerSample = head.readUInt16LE(body + 14);
      } else if (id === "data") {
        dataOffset = body;
        declaredDataBytes = size;
        break;
      }
      // Chunks are word-aligned; an odd size carries a pad byte.
      cursor = body + size + (size % 2);
    }

    if (!dataOffset || !sampleRate || !channels) throw new WavError("missing fmt/data chunk", file);
    if (bitsPerSample !== 16) throw new WavError(`expected 16-bit PCM, got ${bitsPerSample}`, file);

    const availableBytes = Math.max(0, stat.size - dataOffset);
    // A declared size of 0, or one that overruns the file, means the writer never
    // finalized. Trust the file length instead — the samples are all there.
    const truncated = declaredDataBytes === 0 || declaredDataBytes > availableBytes;
    const dataBytes = truncated ? availableBytes : declaredDataBytes;
    const frameBytes = channels * 2;

    return {
      sampleRate,
      channels,
      bitsPerSample,
      dataOffset,
      dataBytes,
      frames: Math.floor(dataBytes / frameBytes),
      headerTruncated: truncated && availableBytes > 0,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Repair a header the writer never finalized, so the file plays in the app's audio
 * viewer. Returns true when it patched something.
 *
 * Only safe because `data` is the last chunk in what the sidecar writes — the
 * samples run to EOF, so the file length is the data length.
 */
export async function recoverWavHeader(file: string): Promise<boolean> {
  const info = await readWavInfo(file);
  if (!info.headerTruncated) return false;

  const handle = await fs.open(file, "r+");
  try {
    const riffSize = Buffer.alloc(4);
    riffSize.writeUInt32LE(Math.min(0xffffffff, info.dataOffset - 8 + info.dataBytes), 0);
    await handle.write(riffSize, 0, 4, 4);

    const dataSize = Buffer.alloc(4);
    dataSize.writeUInt32LE(Math.min(0xffffffff, info.dataBytes), 0);
    await handle.write(dataSize, 0, 4, info.dataOffset - 4);
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Read `frameCount` frames starting at `startFrame` as interleaved int16.
 *
 * Chunked on purpose: an hour of 16 kHz mono is ~115 MB, and holding a whole
 * meeting (times two tracks) in memory to hand to the transcriber is how a long
 * recording turns into an out-of-memory crash.
 */
export async function readPcmChunk(
  file: string,
  info: WavInfo,
  startFrame: number,
  frameCount: number,
): Promise<Int16Array> {
  const frameBytes = info.channels * 2;
  const start = Math.max(0, Math.min(startFrame, info.frames));
  const count = Math.max(0, Math.min(frameCount, info.frames - start));
  if (count === 0) return new Int16Array(0);

  const buffer = Buffer.alloc(count * frameBytes);
  const handle = await fs.open(file, "r");
  try {
    await handle.read(buffer, 0, buffer.length, info.dataOffset + start * frameBytes);
  } finally {
    await handle.close();
  }
  // Copy rather than aliasing the Buffer: Node pools small allocations, and a view
  // onto pooled memory would be corrupted by the next read.
  const samples = new Int16Array(count * info.channels);
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2);
  return samples;
}
