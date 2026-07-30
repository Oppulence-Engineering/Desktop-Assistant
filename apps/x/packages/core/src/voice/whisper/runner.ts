import { spawn, spawnSync, type StdioOptions } from "node:child_process";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { binaryPath } from "./bin.js";
import { pcm16ToWav } from "./wav.js";
import { WhisperError } from "./errors.js";

/**
 * The spawn boundary for `whisper-cli` (RFC 009 §8, Appendix Q): build args, run
 * with a hard timeout, parse the JSON sidecar, classify errors, and serialize
 * batch work behind a semaphore (transcription is CPU/GPU-heavy → one at a time).
 *
 * The pure helpers (`buildArgs`, `parseWhisperJson`, `classify`) are exported so
 * they can be unit-tested without spawning a real binary.
 */

export interface RunOpts {
  modelPath: string;
  vadModelPath?: string;
  lang?: string; // 'en' (default) | 'auto'
  threads?: number;
  audioSeconds: number;
  timeoutMs?: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface RunResult {
  text: string;
  segments: Segment[];
  rtf: number;
  durationMs: number;
  engineLog?: string;
}

export interface PcmStats {
  samples: number;
  audioSeconds: number;
  peak: number;
  rms: number;
  activeRatio: number;
}

/** Thread count: leave one core free, cap at 8 (RFC §5). */
export function autoThreads(): number {
  const cores = os.cpus()?.length || 4; // `|| 4`: an empty cpus() array (0) must fall back, not stick at 0
  return Math.max(1, Math.min(8, cores - 1));
}

/** Default timeout: generous for the first (cold) run, scales with audio length. */
export function timeoutFor(audioSeconds: number): number {
  return Math.max(15_000, Math.round(audioSeconds * 3_000));
}

export function pcmStats(pcm: Int16Array, channels = 1): PcmStats {
  let peak = 0;
  let sumSquares = 0;
  let active = 0;
  for (const sample of pcm) {
    const value = Math.abs(sample);
    if (value > peak) peak = value;
    sumSquares += value * value;
    if (value >= 256) active += 1;
  }
  const samples = pcm.length;
  return {
    samples,
    audioSeconds: samples / 16000 / channels,
    peak,
    rms: samples > 0 ? Math.sqrt(sumSquares / samples) : 0,
    activeRatio: samples > 0 ? active / samples : 0,
  };
}

function shouldRetryWithoutVad(stats: PcmStats): boolean {
  return stats.audioSeconds >= 0.5 && stats.peak >= 700 && stats.rms >= 20;
}

/** Build the `whisper-cli` argument vector. Pure → snapshot-testable. */
export function buildArgs(wavPath: string, outPrefix: string, o: RunOpts): string[] {
  const args = [
    "-m",
    o.modelPath,
    "-f",
    wavPath,
    "-l",
    o.lang ?? "en",
    "-t",
    String(o.threads ?? autoThreads()),
    "-oj", // JSON output
    "-of",
    outPrefix, // writes <outPrefix>.json
    "-nt", // no inline timestamps
    "-np", // no progress prints
  ];
  if (o.vadModelPath) args.push("--vad", "--vad-model", o.vadModelPath);
  return args;
}

/** Shape of the parsed `whisper-cli -oj` JSON (Appendix C). */
interface WhisperJsonSegment {
  offsets?: { from?: number; to?: number };
  text?: string;
}
interface WhisperJson {
  transcription?: WhisperJsonSegment[];
}

/** Map `whisper-cli` JSON → trimmed segments + joined text. Pure → unit-testable. */
export function parseWhisperJson(json: WhisperJson): { text: string; segments: Segment[] } {
  const segments: Segment[] = (json.transcription ?? [])
    .map((s) => ({
      start: (s.offsets?.from ?? 0) / 1000,
      end: (s.offsets?.to ?? 0) / 1000,
      text: String(s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0);
  const text = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, segments };
}

/** Map a non-zero exit + stderr to a typed error code (Appendix Q). Pure. */
export function classify(code: number | null, stderr: string): WhisperError {
  const s = stderr.toLowerCase();
  if (s.includes("failed to load model") || s.includes("no such file")) {
    return new WhisperError("engine_unavailable", stderr.slice(0, 300));
  }
  if (s.includes("out of memory") || s.includes("bad_alloc")) {
    return new WhisperError("engine_crashed", "out of memory");
  }
  return new WhisperError("engine_crashed", `exit ${code}: ${stderr.slice(0, 300)}`);
}

interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

function isSpawnBadFileDescriptor(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EBADF";
}

type SpawnAttempt = "direct" | "env" | "script";

interface SpawnTarget {
  command: string;
  args: string[];
  cleanup?: () => void;
}

export function shellQuote(value: string): string {
  const singleLine = value.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `'${singleLine.replace(/'/g, `'\\''`)}'`;
}

function spawnArgsForAttempt(attempt: SpawnAttempt, bin: string, args: string[]): SpawnTarget {
  if (attempt === "env") return { command: "/usr/bin/env", args: [bin, ...args] };
  if (attempt === "script") {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "rowboat-whisper-launch-"));
    const scriptPath = path.join(dir, "run.sh");
    const script = `#!/bin/sh\nexec ${[bin, ...args].map(shellQuote).join(" ")}\n`;
    fsSync.writeFileSync(scriptPath, script, { mode: 0o700 });
    return {
      command: "/bin/sh",
      args: [scriptPath],
      cleanup: () => fsSync.rmSync(dir, { recursive: true, force: true }),
    };
  }
  return { command: bin, args };
}

function nextSpawnAttempt(attempt: SpawnAttempt): SpawnAttempt | null {
  if (process.platform === "win32") return null;
  if (attempt === "direct") return "env";
  if (attempt === "env") return "script";
  return null;
}

function syncSpawnWhisper(bin: string, args: string[], timeoutMs: number): SpawnResult {
  let attempt: SpawnAttempt | null = "direct";
  let lastError: Error | null = null;

  while (attempt) {
    const spawnTarget = spawnArgsForAttempt(attempt, bin, args);
    try {
      const result = spawnSync(spawnTarget.command, spawnTarget.args, {
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 512 * 1024,
      });

      if (!result.error) {
        return {
          code: result.status,
          signal: result.signal,
          stderr: typeof result.stderr === "string" ? result.stderr : "",
        };
      }

      if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        return {
          code: result.status,
          signal: "SIGKILL",
          stderr: typeof result.stderr === "string" ? result.stderr : result.error.message,
        };
      }

      lastError = result.error;
      attempt = isSpawnBadFileDescriptor(result.error) ? nextSpawnAttempt(attempt) : null;
    } finally {
      spawnTarget.cleanup?.();
    }
  }

  throw lastError ?? new Error("spawn failed");
}

/**
 * Spawn a binary with a hard timeout (SIGKILL) and a bounded stderr buffer.
 * No shell, absolute path, arg array — spawn hardening per §21. Exported for tests.
 */
export function spawnWhisper(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let done = false;
    let child: ReturnType<typeof spawn> | null = null;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child?.kill("SIGKILL");
      // Settle on timeout immediately rather than waiting for 'close'. 'close' fires
      // only after every stdio stream reaches EOF, and a grandchild that inherited the
      // stderr pipe can hold it open long after we kill the parent — which would hang
      // run() (and the batch semaphore) indefinitely. Report SIGKILL → engine_timeout.
      resolve({ code: null, signal: "SIGKILL", stderr });
    }, timeoutMs);

    const settleWithSyncFallback = (attempt: SpawnAttempt) => {
      done = true;
      clearTimeout(timer);
      console.warn(
        `[voice] whisper spawn EBADF via ${attempt}; retrying via synchronous spawn fallback`,
      );
      try {
        resolve(syncSpawnWhisper(bin, args, timeoutMs));
      } catch (err) {
        reject(new WhisperError("engine_unavailable", (err as Error).message));
      }
    };

    const launch = (attempt: SpawnAttempt) => {
      if (done) return;
      const spawnTarget = spawnArgsForAttempt(attempt, bin, args);
      const options: { stdio: StdioOptions } = { stdio: ["ignore", "pipe", "pipe"] };
      try {
        child = spawn(spawnTarget.command, spawnTarget.args, options);
      } catch (err) {
        spawnTarget.cleanup?.();
        const next = isSpawnBadFileDescriptor(err) ? nextSpawnAttempt(attempt) : null;
        if (next) {
          console.warn(`[voice] whisper spawn EBADF via ${attempt}; retrying via ${next}`);
          launch(next);
          return;
        }
        if (isSpawnBadFileDescriptor(err)) {
          settleWithSyncFallback(attempt);
          return;
        }
        done = true;
        clearTimeout(timer);
        reject(new WhisperError("engine_unavailable", (err as Error).message));
        return;
      }
      const launchedChild = child;
      let superseded = false;

      launchedChild.stderr?.on("data", (d) => {
        if (stderr.length < 4096) stderr += d.toString();
      });
      launchedChild.stdout?.on("data", () => {});
      launchedChild.stdout?.on("error", () => {});
      // The stderr pipe can emit 'error' (e.g. EPIPE after we SIGKILL the child while a
      // grandchild still holds it). A Readable 'error' with no listener throws and could
      // crash the main process — swallow it; the spawn outcome is decided by exit/timeout.
      launchedChild.stderr?.on("error", () => {});
      launchedChild.on("error", (err) => {
        spawnTarget.cleanup?.();
        if (done) return;
        const next = isSpawnBadFileDescriptor(err) ? nextSpawnAttempt(attempt) : null;
        if (next) {
          superseded = true;
          console.warn(`[voice] whisper spawn EBADF via ${attempt}; retrying via ${next}`);
          launch(next);
          return;
        }
        if (isSpawnBadFileDescriptor(err)) {
          superseded = true;
          settleWithSyncFallback(attempt);
          return;
        }
        done = true;
        clearTimeout(timer);
        reject(new WhisperError("engine_unavailable", err.message));
      });
      launchedChild.on("close", (code, signal) => {
        spawnTarget.cleanup?.();
        if (superseded || child !== launchedChild) return;
        if (done) return; // already settled by the timeout or error path
        done = true;
        clearTimeout(timer);
        resolve({ code, signal, stderr });
      });
    };

    // Pipe and drain stdout instead of ignoring it. Electron's macOS main process
    // can hit EBADF failures around native child launch; launch() retries controlled
    // alternate exec paths and then a last-resort sync spawn before surfacing an
    // unavailable-engine error.
    launch("direct");
  });
}

/** Run `whisper-cli` against a WAV file and parse the result. */
export async function run(wavPath: string, o: RunOpts): Promise<RunResult> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-whisper-out-"));
  const outPrefix = path.join(outDir, "out");
  try {
    const args = buildArgs(wavPath, outPrefix, o);
    const timeoutMs = o.timeoutMs ?? timeoutFor(o.audioSeconds);

    const t0 = performance.now();
    const { code, signal, stderr } = await spawnWhisper(binaryPath(), args, timeoutMs);
    const durationMs = performance.now() - t0;

    if (signal === "SIGKILL")
      throw new WhisperError("engine_timeout", `killed after ${timeoutMs}ms`);
    if (code !== 0) throw classify(code, stderr);

    let json: WhisperJson;
    try {
      json = JSON.parse(await fs.readFile(`${outPrefix}.json`, "utf8"));
    } catch (e) {
      throw new WhisperError("engine_crashed", `no/invalid json: ${String(e)}`);
    }

    const { text, segments } = parseWhisperJson(json);
    return {
      text,
      segments,
      rtf: o.audioSeconds / (durationMs / 1000),
      durationMs,
      engineLog: stderr.slice(0, 2000),
    };
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Batch transcription is CPU/GPU-heavy → at most one at a time per process. */
class Semaphore {
  private queue: Array<() => void> = [];
  private taken = false;
  async acquire(): Promise<() => void> {
    if (!this.taken) {
      this.taken = true;
      return () => this.release();
    }
    return new Promise((resolve) => this.queue.push(() => resolve(() => this.release())));
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.taken = false;
  }
}
const batchSem = new Semaphore();

/**
 * Transcribe an int16 mono PCM buffer: write a 0600 temp WAV, run `whisper-cli`,
 * parse, and clean up in a `finally` (§21 temp-file hygiene). Serialized by the
 * batch semaphore; extra calls queue.
 */
export async function transcribePcm(pcm: Int16Array, opts: RunOpts): Promise<RunResult> {
  if (pcm.length === 0) throw new WhisperError("audio_invalid", "empty audio");
  const release = await batchSem.acquire();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-whisper-"));
  const wavPath = path.join(dir, "in.wav");
  try {
    const stats = pcmStats(pcm);
    const wav = pcm16ToWav(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), {
      sampleRate: 16000,
      channels: 1,
    });
    await fs.writeFile(wavPath, wav, { mode: 0o600 });
    const result = await run(wavPath, opts);
    if (opts.vadModelPath && result.text.length === 0 && shouldRetryWithoutVad(stats)) {
      console.warn("[voice] whisper returned empty text with VAD; retrying without VAD", {
        audioMs: Math.round(stats.audioSeconds * 1000),
        peak: stats.peak,
        rms: Number(stats.rms.toFixed(1)),
        activePct: Number((stats.activeRatio * 100).toFixed(1)),
      });
      // `await`, not a bare return: returning the promise from inside this `try`
      // lets the `finally` delete the temp WAV while whisper-cli is still starting,
      // so every retry died with "input file not found" — the rescue path for quiet
      // speech never actually worked.
      return await run(wavPath, { ...opts, vadModelPath: undefined });
    }
    return result;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    release();
  }
}
