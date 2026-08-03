import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface RecoveredDictation {
  text: string;
  createdAt: string;
}

interface StoredDictation extends RecoveredDictation {
  version: 1;
}

/**
 * Durable, local-only storage for the most recent polished transcript.
 *
 * One record is intentional: it provides a crash/paste safety net without silently
 * growing a speech history. The file is written atomically and owner-readable only.
 */
export class DictationRecoveryStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(text: string, now = new Date()): Promise<RecoveredDictation> {
    if (!text || text.length > 50_000) throw new Error("Invalid dictation recovery text");
    const value: StoredDictation = { version: 1, text, createdAt: now.toISOString() };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    return value;
  }

  async read(): Promise<RecoveredDictation | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<StoredDictation>;
      if (
        value.version !== 1 ||
        typeof value.text !== "string" ||
        !value.text ||
        value.text.length > 50_000 ||
        typeof value.createdAt !== "string" ||
        !Number.isFinite(Date.parse(value.createdAt))
      ) {
        return null;
      }
      return { text: value.text, createdAt: value.createdAt };
    } catch {
      return null;
    }
  }
}

export function dictationRecoveryPreview(
  recovered: RecoveredDictation | null,
  limit = 180,
): { available: boolean; preview?: string; createdAt?: string } {
  if (!recovered) return { available: false };
  const compact = recovered.text.replace(/\s+/g, " ").trim();
  return {
    available: true,
    preview: compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 1))}…`,
    createdAt: recovered.createdAt,
  };
}
