import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AudioCodec, MeetingTranscriber } from "@x/core/dist/meetings/meetings.js";
import type { ParakeetModel as SharedParakeetModel } from "@x/shared/dist/meetings.js";
import { pcm16ToWav } from "@x/core/dist/voice/whisper/wav.js";
import { audiocapBinaryPath, nativeCaptureAvailable } from "./meeting-capture.js";

/**
 * The sidecar's non-capture jobs: Parakeet transcription, and the AAC round-trip for
 * retained audio.
 *
 * Both are here rather than in core because they mean spawning a packaged binary, and
 * core deliberately knows nothing about processes or resource paths. They plug into
 * seams core already defines — `MeetingTranscriber` and `AudioCodec` — so the queue
 * cannot tell which engine it is driving.
 */

export interface SidecarResult {
  stdout: string;
  stderr: string;
}

/** Run a one-shot sidecar subcommand. Rejects with the NDJSON error message when the
 *  sidecar reported one, since that carries the remediation. */
function runSidecar(
  args: string[],
  opts: { timeoutMs?: number; onEvent?: (event: Record<string, unknown>) => void } = {},
): Promise<SidecarResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(audiocapBinaryPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buffered = "";
    let reportedError: string | undefined;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`audiocap ${args[0]} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!opts.onEvent) return;
      buffered += chunk;
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "error") reportedError = `${event.code}: ${event.message}`;
          opts.onEvent(event);
        } catch {
          /* not an event line */
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`could not run audiocap ${args[0]}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      // Prefer the structured error the sidecar emitted; fall back to its log.
      const detail = reportedError ?? stderr.trim().split("\n").slice(-3).join(" ");
      reject(new Error(`audiocap ${args[0]} failed (exit ${code}): ${detail}`));
    });
  });
}

/** Parse the last JSON object on stdout — the sidecar may have emitted event lines first. */
function lastJsonLine<T>(stdout: string): T {
  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim().startsWith("{"));
  const last = lines.at(-1);
  if (!last) throw new Error("audiocap produced no JSON output");
  try {
    return JSON.parse(last) as T;
  } catch {
    // A sidecar killed mid-write leaves a truncated line. Callers all handle a
    // throw (ensure surfaces {error} to the renderer; live transcription logs
    // and skips the pass) — but a bare "Unexpected end of JSON input" gave no
    // hint the sidecar was the source.
    throw new Error(`audiocap produced malformed JSON output: ${last.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Audio codec
// ---------------------------------------------------------------------------

/** AAC round-trip for retained recordings. */
export const audiocapCodec: AudioCodec = {
  async compress(wavPath, outPath) {
    await runSidecar(["compress", "--in", wavPath, "--out", outPath], { timeoutMs: 10 * 60_000 });
  },
  async decode(compressedPath, outWavPath) {
    await runSidecar(["decode", "--in", compressedPath, "--out", outWavPath], {
      timeoutMs: 10 * 60_000,
    });
  },
};

/** Only usable when the sidecar shipped; otherwise retention keeps the plain WAV. */
export function codecAvailable(): boolean {
  return nativeCaptureAvailable();
}

// ---------------------------------------------------------------------------
// Parakeet
// ---------------------------------------------------------------------------

export interface ParakeetModelStatus {
  ready: boolean;
  model: string;
  cacheDir: string;
}

/** Re-exported from the schema rather than redeclared — a local union drifts silently
 *  when the schema changes. v3 is multilingual (28 European languages); v2 English-only. */
export type ParakeetModel = SharedParakeetModel;

export async function parakeetModelStatus(model: ParakeetModel): Promise<ParakeetModelStatus> {
  try {
    const { stdout } = await runSidecar(["models", "--model", model, "--json"], {
      timeoutMs: 30_000,
    });
    return lastJsonLine<ParakeetModelStatus>(stdout);
  } catch {
    // Exit 1 just means "not downloaded", which is not an error worth throwing over.
    return { ready: false, model, cacheDir: "" };
  }
}

/**
 * Download the models (~600 MB) if absent. Reports progress, because otherwise the
 * first transcription looks like a hang for several minutes.
 */
export async function ensureParakeetModels(
  model: ParakeetModel,
  onProgress?: (fraction: number, phase: string) => void,
): Promise<ParakeetModelStatus> {
  const { stdout } = await runSidecar(["models", "--ensure", "--model", model, "--json"], {
    // A cold download on a slow connection legitimately takes a while.
    timeoutMs: 60 * 60_000,
    onEvent: (event) => {
      if (event.type !== "modelProgress") return;
      onProgress?.(Number(event.fraction ?? 0), String(event.phase ?? ""));
    },
  });
  return lastJsonLine<ParakeetModelStatus>(stdout);
}

interface SidecarTranscript {
  engine: string;
  model: string;
  segments: { start: number; end: number; text: string }[];
}

export interface ParakeetTranscriptionResult extends SidecarTranscript {
  text: string;
  durationMs: number;
  /** Realtime speed multiplier (audio seconds / processing seconds). */
  rtf: number;
}

/**
 * Run the Neural Engine Parakeet path for one mono PCM utterance. This is shared by
 * meetings and system-wide dictation so the fast engine is not trapped behind the
 * meeting feature.
 */
export async function transcribeParakeetPcm(
  pcm: Int16Array,
  args: { model: ParakeetModel; language?: string },
): Promise<ParakeetTranscriptionResult> {
  if (pcm.length === 0) throw new Error("cannot transcribe empty audio");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-parakeet-"));
  const wavPath = path.join(dir, "in.wav");
  const startedAt = performance.now();
  try {
    const wav = pcm16ToWav(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), {
      sampleRate: 16000,
      channels: 1,
    });
    await fs.writeFile(wavPath, wav, { mode: 0o600 });

    const argv = ["transcribe", "--in", wavPath, "--model", args.model, "--json"];
    if (args.language && args.language !== "auto") argv.push("--language", args.language);

    const { stdout } = await runSidecar(argv, {
      // Parakeet measures ~70x realtime; this is a hang guard, not a budget.
      timeoutMs: Math.max(60_000, Math.round((pcm.length / 16000) * 2_000)),
    });
    const result = lastJsonLine<SidecarTranscript>(stdout);
    const durationMs = performance.now() - startedAt;
    const audioSeconds = pcm.length / 16000;
    return {
      ...result,
      segments: result.segments ?? [],
      text: (result.segments ?? [])
        .map((segment) => segment.text)
        .join(" ")
        .trim(),
      durationMs,
      rtf: audioSeconds / (durationMs / 1000),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parakeet as a {@link MeetingTranscriber}, so the queue drives it exactly like
 * whisper.
 *
 * The interface passes PCM rather than a path, so each chunk is written to a temp WAV
 * first — the same thing whisper's runner does internally, and the cost is trivial next
 * to inference. Keeping the interface unchanged is worth more than saving the write:
 * every offset, merge, and retention behaviour stays shared between the two engines.
 */
export function createParakeetTranscriber(args: {
  model: ParakeetModel;
  language?: string;
}): MeetingTranscriber {
  return {
    async transcribe(pcm, opts) {
      const result = await transcribeParakeetPcm(pcm, {
        model: args.model,
        language: opts.lang ?? args.language,
      });
      return { segments: result.segments };
    },
  };
}
