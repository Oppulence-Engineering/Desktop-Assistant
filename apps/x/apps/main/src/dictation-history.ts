import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readValidatedJson } from "./safe-json-file.js";

import {
  DictationHistoryEntry as DictationHistoryEntrySchema,
  type DictationHistoryEngine,
  type DictationHistoryEntry,
  type DictationHistoryRetention,
  type DictationHistoryStats,
  type DictationLanguage,
  type DictationPolishChange,
} from "@x/shared/transcription";

const FILE_VERSION = 1;
const MAX_ENTRIES = 10_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

interface StoredHistory {
  version: typeof FILE_VERSION;
  entries: DictationHistoryEntry[];
}

const StoredHistorySchema: z.ZodType<StoredHistory> = z.object({
  version: z.literal(FILE_VERSION),
  entries: z.array(DictationHistoryEntrySchema),
});

export interface DictationHistoryInput {
  text: string;
  rawText?: string;
  polishChanges?: DictationPolishChange[];
  status?: "success" | "failed";
  delivery?: "pasted" | "copied" | "none";
  appName?: string;
  bundleIdentifier?: string;
  engine?: DictationHistoryEngine;
  language?: DictationLanguage;
  audioDurationMs?: number;
  transcriptionDurationMs?: number;
  errorCode?: string;
  createdAt?: Date;
}

export interface DictationHistoryPage {
  entries: DictationHistoryEntry[];
  total: number;
  stats: DictationHistoryStats;
}

/**
 * Count words with Unicode-aware segmentation. This keeps CJK dictations from being
 * counted as a single whitespace-delimited word, which would corrupt both totals and WPM.
 */
export function countDictationWords(text: string): number {
  const compact = text.trim();
  if (!compact) return 0;
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    let count = 0;
    for (const segment of segmenter.segment(compact)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }
  return compact.split(/\s+/u).filter(Boolean).length;
}

function localDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function priorLocalDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return localDayKey(new Date(year, month - 1, day - 1, 12));
}

function boundedNumber(value: number | undefined, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return 0;
  return Math.min(max, Math.max(0, value));
}

function optionalBoundedText(value: string | undefined, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedTranscript(value: string | undefined): string | undefined {
  const text = value?.normalize("NFC").trim();
  return text ? text.slice(0, 50_000) : undefined;
}

export function calculateDictationStats(
  entries: DictationHistoryEntry[],
  now = new Date(),
): DictationHistoryStats {
  const successful = entries.filter((entry) => entry.status === "success" && entry.text);
  const totalWords = successful.reduce((sum, entry) => sum + entry.wordCount, 0);
  const totalAudioDurationMs = successful.reduce((sum, entry) => sum + entry.audioDurationMs, 0);
  const today = localDayKey(now);
  const todayWords = successful
    .filter((entry) => localDayKey(entry.createdAt) === today)
    .reduce((sum, entry) => sum + entry.wordCount, 0);
  const usedDays = new Set(successful.map((entry) => localDayKey(entry.createdAt)));

  let cursor = usedDays.has(today) ? today : priorLocalDayKey(today);
  let streakDays = 0;
  while (usedDays.has(cursor)) {
    streakDays += 1;
    cursor = priorLocalDayKey(cursor);
  }

  const appCounts = new Map<string, number>();
  for (const entry of successful) {
    if (!entry.appName) continue;
    appCounts.set(entry.appName, (appCounts.get(entry.appName) ?? 0) + 1);
  }
  const topApps = [...appCounts]
    .map(([appName, dictations]) => ({ appName, dictations }))
    .sort(
      (left, right) =>
        right.dictations - left.dictations || left.appName.localeCompare(right.appName),
    )
    .slice(0, 5);
  const automaticallyEditedDictations = successful.filter(
    (entry) => entry.polishedText && entry.polishChanges.length > 0,
  ).length;
  const wordsCleanedUp = successful.reduce((sum, entry) => {
    if (!entry.rawText || !entry.polishedText) return sum;
    return (
      sum +
      Math.max(0, countDictationWords(entry.rawText) - countDictationWords(entry.polishedText))
    );
  }, 0);

  return {
    totalWords,
    todayWords,
    averageWpm:
      totalAudioDurationMs > 0
        ? Math.round((totalWords / (totalAudioDurationMs / 60_000)) * 10) / 10
        : 0,
    streakDays,
    daysUsed: usedDays.size,
    totalDictations: successful.length,
    totalAudioDurationMs,
    automaticallyEditedDictations,
    wordsCleanedUp,
    topApps,
  };
}

/** Atomic, owner-readable, local-only transcript history with bounded growth. */
export class DictationHistoryStore {
  private mutation: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async add(
    input: DictationHistoryInput,
    retention: DictationHistoryRetention,
  ): Promise<DictationHistoryEntry | null> {
    if (retention === "never") {
      await this.clear();
      return null;
    }
    const status = input.status ?? "success";
    const text = input.text.slice(0, 50_000);
    const rawText = boundedTranscript(input.rawText);
    const polishedText = rawText && rawText !== text ? text : undefined;
    if (status === "success" && !text) throw new Error("Successful dictation history needs text");
    const entry = DictationHistoryEntrySchema.parse({
      id: randomUUID(),
      createdAt: (input.createdAt ?? new Date()).toISOString(),
      text,
      rawText,
      polishedText,
      polishChanges: polishedText ? input.polishChanges : [],
      formattingUndone: false,
      status,
      delivery: input.delivery ?? (status === "success" ? "pasted" : "none"),
      appName: optionalBoundedText(input.appName, 200),
      bundleIdentifier: optionalBoundedText(input.bundleIdentifier, 300),
      engine: input.engine ?? "unknown",
      language: input.language,
      audioDurationMs: boundedNumber(input.audioDurationMs, 20 * 60 * 1_000),
      transcriptionDurationMs:
        input.transcriptionDurationMs === undefined
          ? undefined
          : boundedNumber(input.transcriptionDurationMs, 20 * 60 * 1_000),
      wordCount: countDictationWords(rawText ?? text),
      errorCode: optionalBoundedText(input.errorCode, 100),
    });

    await this.mutate(async (entries) => {
      entries.unshift(entry);
      return this.prune(entries, retention).slice(0, MAX_ENTRIES);
    });
    return entry;
  }

  async complete(
    id: string,
    input: DictationHistoryInput,
    retention: DictationHistoryRetention,
  ): Promise<DictationHistoryEntry | null> {
    if (retention === "never") {
      await this.clear();
      return null;
    }
    let completed: DictationHistoryEntry | null = null;
    await this.mutate(async (entries) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return this.prune(entries, retention);
      const previous = entries[index];
      const text = input.text.slice(0, 50_000);
      const rawText = boundedTranscript(input.rawText);
      const polishedText = rawText && rawText !== text ? text : undefined;
      if (!text) return entries;
      completed = DictationHistoryEntrySchema.parse({
        ...previous,
        text,
        rawText,
        polishedText,
        polishChanges: polishedText ? input.polishChanges : [],
        formattingUndone: false,
        status: "success",
        delivery: input.delivery ?? "pasted",
        engine: input.engine ?? previous.engine,
        language: input.language ?? previous.language,
        audioDurationMs: boundedNumber(input.audioDurationMs, 20 * 60 * 1_000),
        transcriptionDurationMs:
          input.transcriptionDurationMs === undefined
            ? previous.transcriptionDurationMs
            : boundedNumber(input.transcriptionDurationMs, 20 * 60 * 1_000),
        wordCount: countDictationWords(rawText ?? text),
        errorCode: undefined,
      });
      entries[index] = completed;
      return this.prune(entries, retention);
    });
    return completed;
  }

  async list(
    options: { query?: string; limit?: number; offset?: number } = {},
    retention: DictationHistoryRetention = "forever",
    now = new Date(),
  ): Promise<DictationHistoryPage> {
    if (retention === "never") {
      await this.clear();
      return { entries: [], total: 0, stats: calculateDictationStats([], now) };
    }
    await this.mutation;
    let entries = await this.readEntries();
    const pruned = this.prune(entries, retention, now);
    if (pruned.length !== entries.length) {
      await this.mutate(async (current) => this.prune(current, retention, now));
      entries = await this.readEntries();
    } else {
      entries = pruned;
    }
    const query = options.query?.trim().toLocaleLowerCase();
    const filtered = query
      ? entries.filter(
          (entry) =>
            entry.text.toLocaleLowerCase().includes(query) ||
            entry.rawText?.toLocaleLowerCase().includes(query) ||
            entry.polishedText?.toLocaleLowerCase().includes(query) ||
            entry.appName?.toLocaleLowerCase().includes(query) ||
            entry.errorCode?.toLocaleLowerCase().includes(query),
        )
      : entries;
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    return {
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      stats: calculateDictationStats(entries, now),
    };
  }

  async find(id: string): Promise<DictationHistoryEntry | null> {
    await this.mutation;
    return (await this.readEntries()).find((entry) => entry.id === id) ?? null;
  }

  async toggleFormatting(id: string): Promise<DictationHistoryEntry | null> {
    let updated: DictationHistoryEntry | null = null;
    await this.mutate(async (entries) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return entries;
      const previous = entries[index];
      if (!previous.rawText || !previous.polishedText) return entries;
      updated = DictationHistoryEntrySchema.parse({
        ...previous,
        text: previous.formattingUndone ? previous.polishedText : previous.rawText,
        formattingUndone: !previous.formattingUndone,
      });
      entries[index] = updated;
      return entries;
    });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    let deleted = false;
    await this.mutate(async (entries) => {
      const next = entries.filter((entry) => entry.id !== id);
      deleted = next.length !== entries.length;
      return next;
    });
    return deleted;
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await fs.unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    });
  }

  async applyRetention(retention: DictationHistoryRetention, now = new Date()): Promise<void> {
    if (retention === "never") return this.clear();
    await this.mutate(async (entries) => this.prune(entries, retention, now));
  }

  private prune(
    entries: DictationHistoryEntry[],
    retention: DictationHistoryRetention,
    now = new Date(),
  ): DictationHistoryEntry[] {
    if (retention === "never") return [];
    const cutoff = retention === "24-hours" ? now.getTime() - ONE_DAY_MS : -Infinity;
    return entries
      .filter((entry) => Date.parse(entry.createdAt) >= cutoff)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, MAX_ENTRIES);
  }

  private async readEntries(): Promise<DictationHistoryEntry[]> {
    try {
      return (await readValidatedJson(this.filePath, StoredHistorySchema)).entries;
    } catch {
      return [];
    }
  }

  private async mutate(
    transform: (
      entries: DictationHistoryEntry[],
    ) => Promise<DictationHistoryEntry[]> | DictationHistoryEntry[],
  ): Promise<void> {
    await this.enqueue(async () => {
      const entries = await this.readEntries();
      await this.writeEntries(await transform(entries));
    });
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.catch(() => {});
    return result;
  }

  private async writeEntries(entries: DictationHistoryEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporaryPath,
        JSON.stringify({ version: FILE_VERSION, entries } satisfies StoredHistory),
        { encoding: "utf8", mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }
}
