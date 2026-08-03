import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { pcm16ToWav } from "@x/core/dist/voice/whisper/wav.js";
import {
  DictationLanguage as DictationLanguageSchema,
  type DictationLanguage,
} from "@x/shared/dist/transcription.js";
import { audiocapBinaryPath } from "./meeting-capture.js";
import { parakeetModelStatus } from "./meeting-engines.js";

interface PersistentResult {
  id: string;
  type: "transcriptionResult";
  engine: "parakeet";
  model: string;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  durationMs: number;
  language?: DictationLanguage;
}

interface PersistentError {
  id?: string;
  type: "transcriptionError" | "error";
  code: string;
  message: string;
}

interface Pending {
  resolve: (result: PersistentResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface FastDictationResult {
  engine: "parakeet";
  model: string;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  durationMs: number;
  rtf: number;
  language?: DictationLanguage;
}

/**
 * Supervised Parakeet worker. Core ML models are loaded once at app startup and stay
 * resident, so release-to-paste latency contains inference rather than model startup.
 */
class ParakeetDictationRunner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private stdoutBuffer = "";
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  async warmup(): Promise<void> {
    if (this.child && !this.child.killed && !this.starting) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      const child = spawn(audiocapBinaryPath(), ["serve", "--model", "v3"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.stdoutBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const message = chunk.trim();
        if (message) console.log(`[dictation] parakeet worker: ${message}`);
      });
      child.on("error", (error) => this.failWorker(error));
      child.on("exit", (code, signal) => {
        this.failWorker(new Error(`Parakeet worker exited (${signal ?? `code ${String(code)}`})`));
      });
    }).finally(() => {
      this.starting = null;
      this.readyResolve = null;
      this.readyReject = null;
    });
    return this.starting;
  }

  async transcribe(pcm: Int16Array, language?: DictationLanguage): Promise<FastDictationResult> {
    if (pcm.length === 0) throw new Error("cannot transcribe empty audio");
    await this.warmup();
    const child = this.child;
    if (!child || child.killed) throw new Error("Parakeet worker is unavailable");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-dictation-"));
    const audioPath = path.join(dir, "utterance.wav");
    const id = randomUUID();
    const startedAt = performance.now();
    try {
      const wav = pcm16ToWav(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), {
        sampleRate: 16000,
        channels: 1,
      });
      await fs.writeFile(audioPath, wav, { mode: 0o600 });

      const nativeResult = await new Promise<PersistentResult>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.pending.delete(id);
            reject(new Error("Parakeet worker timed out"));
          },
          Math.max(10_000, Math.round((pcm.length / 16000) * 2_000)),
        );
        this.pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, audioPath, language })}\n`);
      });

      const durationMs = performance.now() - startedAt;
      const detectedLanguage = DictationLanguageSchema.safeParse(nativeResult.language);
      return {
        engine: "parakeet",
        model: nativeResult.model,
        text: nativeResult.text,
        segments: nativeResult.segments,
        durationMs,
        rtf: pcm.length / 16000 / (durationMs / 1000),
        ...(detectedLanguage.success ? { language: detectedLanguage.data } : {}),
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.stdin.write("stop\n");
      child.kill("SIGTERM");
    }
    this.failPending(new Error("Parakeet worker stopped"));
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (event.type === "transcriptionReady") {
      this.readyResolve?.();
      return;
    }
    if (event.type === "error" && this.readyReject) {
      this.readyReject(new Error(String(event.message ?? "Parakeet worker failed to start")));
      return;
    }

    const id = typeof event.id === "string" ? event.id : "";
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (event.type === "transcriptionResult") {
      pending.resolve(event as unknown as PersistentResult);
    } else {
      const error = event as unknown as PersistentError;
      pending.reject(new Error(error.message || error.code || "Parakeet transcription failed"));
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private failWorker(error: Error): void {
    this.child = null;
    this.readyReject?.(error);
    this.failPending(error);
  }
}

const runner = new ParakeetDictationRunner();
let availability: Promise<boolean> | null = null;

/** Warm only when the model is installed; a passive app launch never downloads it. */
export function warmFastDictationEngine(options?: { refresh?: boolean }): Promise<boolean> {
  if (options?.refresh) availability = null;
  if (availability) return availability;

  const attempt = (async () => {
    const status = await parakeetModelStatus("v3");
    if (!status.ready) return false;
    await runner.warmup();
    // Core ML performs additional graph/device setup on the first inference.
    // Pay that cost during app startup instead of after the user's first release.
    // Silence may correctly produce a no-transcription error after inference;
    // the model and Neural Engine are still primed for the first real utterance.
    await runner.transcribe(new Int16Array(3_200), "en").catch(() => {});
    return true;
  })();
  availability = attempt;
  void attempt.catch(() => {
    if (availability === attempt) availability = null;
  });
  return attempt;
}

export async function transcribeFastDictation(
  pcm: Int16Array,
  language?: DictationLanguage,
): Promise<FastDictationResult> {
  if (!(await warmFastDictationEngine())) {
    throw new Error("Parakeet v3 models are not installed");
  }
  return runner.transcribe(pcm, language);
}

export function stopFastDictationEngine(): void {
  availability = null;
  runner.stop();
}
