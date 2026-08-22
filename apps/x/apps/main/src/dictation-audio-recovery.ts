import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readValidatedJson } from "./safe-json-file.js";

const RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;

interface StoredFailedAudio {
  version: 1;
  id: string;
  audioFile: string;
  createdAt: string;
  durationMs: number;
  status: "pending" | "failed";
  errorCode?: string;
  errorMessage?: string;
  historyId?: string;
}

const StoredFailedAudioSchema: z.ZodType<StoredFailedAudio> = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  audioFile: z.string().refine((value) => path.basename(value) === value),
  createdAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["pending", "failed"]),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  historyId: z.string().optional(),
});

export interface FailedDictationAudioSummary {
  available: boolean;
  createdAt?: string;
  durationMs?: number;
  errorCode?: string;
}

export interface FailedDictationAudio extends FailedDictationAudioSummary {
  id: string;
  historyId?: string;
  pcm16: Int16Array;
}

/** One-item, local-only PCM recovery with Wispr-compatible 14-day expiry. */
export class DictationAudioRecoveryStore {
  private readonly directory: string;
  private readonly metadataPath: string;

  constructor(directory: string) {
    this.directory = directory;
    this.metadataPath = path.join(directory, "failed-audio.json");
  }

  async stage(
    pcm16: Int16Array,
    sampleRate = 16_000,
    now = new Date(),
  ): Promise<StoredFailedAudio> {
    if (!pcm16.length || sampleRate !== 16_000) throw new Error("Invalid recovery audio");
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);

    const id = randomUUID();
    const audioFile = `${id}.wav`;
    const audioPath = path.join(this.directory, audioFile);
    const temporaryAudioPath = `${audioPath}.tmp`;
    const wav = pcm16ToRecoveryWav(pcm16, sampleRate);
    await fs.writeFile(temporaryAudioPath, wav, { mode: 0o600 });
    await fs.rename(temporaryAudioPath, audioPath);

    const previous = await this.readMetadata();
    const value: StoredFailedAudio = {
      version: 1,
      id,
      audioFile,
      createdAt: now.toISOString(),
      durationMs: Math.round((pcm16.length / sampleRate) * 1_000),
      status: "pending",
    };
    // Keep an existing failed item retryable until the replacement actually
    // fails. A successful later dictation should not destroy older recovery.
    if (previous?.status !== "failed") {
      await this.writeMetadata(value);
      await this.unlinkAudio(previous?.audioFile);
    }
    return value;
  }

  async markFailed(
    staged: StoredFailedAudio,
    errorCode?: string,
    errorMessage?: string,
    historyId?: string,
  ): Promise<void> {
    const current = await this.readMetadata();
    if (current?.id !== staged.id && current?.status !== "failed") return;
    await this.writeMetadata({
      ...staged,
      status: "failed",
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(historyId ? { historyId } : {}),
    });
    if (current?.id !== staged.id) await this.unlinkAudio(current?.audioFile);
  }

  async discard(staged: StoredFailedAudio): Promise<void> {
    await this.unlinkAudio(staged.audioFile);
    const current = await this.readMetadata();
    if (current?.id === staged.id) await fs.unlink(this.metadataPath).catch(() => {});
  }

  async read(now = new Date()): Promise<FailedDictationAudio | null> {
    const metadata = await this.readMetadata();
    if (!metadata) return null;
    if (now.getTime() - Date.parse(metadata.createdAt) >= RETENTION_MS) {
      await this.clear(metadata);
      return null;
    }
    try {
      const wav = await fs.readFile(path.join(this.directory, metadata.audioFile));
      const pcm16 = parseMonoPcm16Wav(wav);
      return {
        available: true,
        id: metadata.id,
        pcm16,
        createdAt: metadata.createdAt,
        durationMs: metadata.durationMs,
        ...(metadata.historyId ? { historyId: metadata.historyId } : {}),
        errorCode: metadata.errorCode ?? (metadata.status === "pending" ? "interrupted" : undefined),
      };
    } catch {
      await this.clear(metadata);
      return null;
    }
  }

  async summary(now = new Date()): Promise<FailedDictationAudioSummary> {
    const failed = await this.read(now);
    if (!failed) return { available: false };
    return {
      available: true,
      createdAt: failed.createdAt,
      durationMs: failed.durationMs,
      ...(failed.errorCode ? { errorCode: failed.errorCode } : {}),
    };
  }

  async clear(metadata?: StoredFailedAudio): Promise<void> {
    const current = metadata ?? (await this.readMetadata());
    await this.unlinkAudio(current?.audioFile);
    await fs.unlink(this.metadataPath).catch(() => {});
  }

  private async readMetadata(): Promise<StoredFailedAudio | null> {
    try {
      return await readValidatedJson(this.metadataPath, StoredFailedAudioSchema);
    } catch {
      return null;
    }
  }

  private async writeMetadata(value: StoredFailedAudio): Promise<void> {
    const temporaryPath = `${this.metadataPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, this.metadataPath);
    await fs.chmod(this.metadataPath, 0o600);
  }

  private async unlinkAudio(audioFile?: string): Promise<void> {
    if (!audioFile || path.basename(audioFile) !== audioFile) return;
    await fs.unlink(path.join(this.directory, audioFile)).catch(() => {});
  }
}

function pcm16ToRecoveryWav(pcm16: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(
    pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength),
  );
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function parseMonoPcm16Wav(wav: Buffer): Int16Array {
  if (
    wav.length < 44 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE" ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== 16_000 ||
    wav.readUInt16LE(34) !== 16 ||
    wav.toString("ascii", 36, 40) !== "data"
  ) {
    throw new Error("Unsupported recovery WAV");
  }
  const byteLength = wav.readUInt32LE(40);
  if (byteLength <= 0 || byteLength % 2 !== 0 || 44 + byteLength > wav.length) {
    throw new Error("Invalid recovery WAV length");
  }
  const copy = Buffer.from(wav.subarray(44, 44 + byteLength));
  return new Int16Array(copy.buffer, copy.byteOffset, byteLength / 2).slice();
}
