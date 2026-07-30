import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app, systemPreferences } from "electron";
import type {
  MeetingCaptureState,
  MeetingDoctorReport,
  MeetingResolvedEngine,
  MeetingTrackId,
} from "@x/shared/dist/meetings.js";

/**
 * Supervising the `oppulence-audiocap` sidecar (`vendor/audiocap`).
 *
 * This lives in main rather than core because it is the Electron-shaped part:
 * resolving a packaged resource path, prompting for microphone access, and
 * finalizing on app quit. Core owns everything durable — sessions, the transcription
 * queue, notes, retention — and never learns that a sidecar exists.
 */

/** Core Audio process taps (`AudioHardwareCreateProcessTap`) land in macOS 14.2. */
const MIN_DARWIN_MAJOR = 23; // Darwin 23.2 == macOS 14.2
const MIN_DARWIN_MINOR = 2;

export interface CaptureEvents {
  onLevel?: (peaks: Partial<Record<MeetingTrackId, number>>) => void;
  onWarning?: (code: string, message: string) => void;
  onError?: (code: string, message: string) => void;
  /** The sidecar finished — cleanly or not. `metaPath` is present only when it wrote
   *  one, which is what tells the caller the session is safe to enqueue. */
  onStopped?: (result: { metaPath?: string; durationSeconds?: number; crashed: boolean }) => void;
}

export interface StartCaptureArgs extends CaptureEvents {
  dir: string;
  voiceProcessing: boolean;
}

/**
 * Absolute path to the per-arch sidecar. Same resolution order as
 * `whisperBinaryPath()` in ipc.ts: env override for dev and tests, the packaged
 * extraResource, then the vendor tree.
 */
export function audiocapBinaryPath(): string {
  const exe = "oppulence-audiocap";
  if (process.env.ROWBOAT_AUDIOCAP_BIN) return process.env.ROWBOAT_AUDIOCAP_BIN;
  if (process.env.ROWBOAT_AUDIOCAP_DIR) return path.join(process.env.ROWBOAT_AUDIOCAP_DIR, exe);
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "audiocap", exe); // → Resources/audiocap/
  }
  return path.join(
    app.getAppPath(),
    "..",
    "..",
    "vendor",
    "audiocap",
    `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`,
    exe,
  );
}

/** macOS 14.2+ is required for process taps; below that there is nothing to run. */
export function osSupportsNativeCapture(): boolean {
  if (process.platform !== "darwin") return false;
  const [major, minor] = os.release().split(".").map(Number);
  if (!Number.isFinite(major)) return false;
  return major > MIN_DARWIN_MAJOR || (major === MIN_DARWIN_MAJOR && minor >= MIN_DARWIN_MINOR);
}

export function nativeCaptureAvailable(): boolean {
  if (!osSupportsNativeCapture()) return false;
  try {
    fs.accessSync(audiocapBinaryPath(), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the configured engine against reality. `auto` prefers native; an explicit
 * `native` that isn't available still falls back rather than failing, because a
 * missing dev binary should not mean no meeting recording at all.
 */
export function resolveCaptureEngine(configured: string): MeetingResolvedEngine {
  if (configured === "renderer") return "renderer";
  return nativeCaptureAvailable() ? "native" : "renderer";
}

/**
 * The native path never calls `getUserMedia`, so nothing else in the app would ever
 * trigger the microphone prompt. Ask explicitly before the first spawn — otherwise
 * the sidecar records a silent track and the user is told after the meeting.
 */
export async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") return true;
  if (status === "denied" || status === "restricted") return false;
  return systemPreferences.askForMediaAccess("microphone");
}

export class MeetingCaptureSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stopping = false;
  private events: CaptureEvents = {};
  private startedTracks: MeetingTrackId[] = [];
  private warnings: string[] = [];
  private metaPath: string | undefined;
  private sessionDir: string | null = null;

  get running(): boolean {
    return this.child !== null;
  }

  get tracks(): MeetingTrackId[] {
    return [...this.startedTracks];
  }

  get sessionWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Spawn the sidecar and resolve once it reports `started` — so a caller knows
   * whether capture actually began before it tells the user it did.
   */
  start(args: StartCaptureArgs): Promise<{ tracks: MeetingTrackId[]; warnings: string[] }> {
    if (this.child) throw new Error("capture already running");
    this.events = args;
    this.stdoutBuffer = "";
    this.stopping = false;
    this.startedTracks = [];
    this.warnings = [];
    this.metaPath = undefined;
    this.sessionDir = args.dir;

    const bin = audiocapBinaryPath();
    const argv = ["record", "--out", args.dir];
    if (args.voiceProcessing) argv.push("--voice-processing");

    const child = spawn(bin, argv, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      child.on("error", (err) => {
        this.child = null;
        fail(new Error(`could not start audiocap: ${err.message}`));
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.stdoutBuffer += chunk;
        // NDJSON: one event per line, and a chunk can split a line anywhere.
        let newline: number;
        while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
          const line = this.stdoutBuffer.slice(0, newline).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
          if (!line) continue;
          const event = this.handleLine(line);
          if (event === "started" && !settled) {
            settled = true;
            resolve({ tracks: this.tracks, warnings: this.sessionWarnings });
          }
          if (event === "error" && !settled) {
            settled = true;
            reject(new Error(this.warnings.at(-1) ?? "audiocap failed to start"));
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (text) console.log(`[meeting] audiocap: ${text}`);
      });

      child.on("exit", (code, signal) => {
        this.child = null;
        // An exit we did not ask for, with no meta.json, means whatever is on disk is
        // all there is — the caller still enqueues it, because a partially recorded
        // meeting is worth transcribing.
        const crashed = !this.stopping && code !== 0;
        if (crashed) {
          console.warn(`[meeting] audiocap exited unexpectedly (code ${code}, signal ${signal})`);
        }
        this.events.onStopped?.({
          metaPath: this.metaPath,
          crashed,
        });
        fail(new Error(`audiocap exited before starting (code ${code})`));
      });
    });
  }

  /**
   * Ask the sidecar to finalize. Resolves once the process is gone, so the caller can
   * read `meta.json` immediately afterwards without racing the writer.
   */
  async stop(timeoutMs = 15_000): Promise<{ metaPath?: string }> {
    const child = this.child;
    if (!child) return { metaPath: this.metaPath };
    this.stopping = true;

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      child.stdin.write("stop\n");
    } catch {
      // Pipe already gone — SIGTERM below is the fallback.
    }

    const timer = setTimeout(() => {
      if (!this.child) return;
      // Finalizing should take milliseconds. If it hasn't, the header patch is the
      // only thing at stake and core can rebuild it from the file length.
      console.warn("[meeting] audiocap did not stop in time — sending SIGTERM");
      child.kill("SIGTERM");
    }, timeoutMs);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
    return { metaPath: this.metaPath };
  }

  /** Best-effort synchronous stop for `before-quit`, where async has no time to run. */
  killForQuit(): void {
    if (!this.child) return;
    this.stopping = true;
    this.child.kill("SIGTERM");
  }

  get dir(): string | null {
    return this.sessionDir;
  }

  private handleLine(line: string): string | undefined {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      console.warn(`[meeting] unparseable audiocap event: ${line.slice(0, 200)}`);
      return undefined;
    }

    switch (event.type) {
      case "started": {
        const tracks = Array.isArray(event.tracks) ? event.tracks : [];
        this.startedTracks = tracks
          .map((t) => (t as { id?: string }).id)
          .filter((id): id is MeetingTrackId => id === "mic" || id === "system");
        if (Array.isArray(event.warnings)) {
          this.warnings.push(...event.warnings.map(String));
        }
        return "started";
      }
      case "level": {
        this.events.onLevel?.((event.peaks ?? {}) as Partial<Record<MeetingTrackId, number>>);
        return "level";
      }
      case "warning": {
        const message = `${event.code}: ${event.message}`;
        this.warnings.push(message);
        console.warn(`[meeting] ${message}`);
        this.events.onWarning?.(String(event.code), String(event.message));
        return "warning";
      }
      case "error": {
        const message = `${event.code}: ${event.message}`;
        this.warnings.push(message);
        console.error(`[meeting] ${message}`);
        this.events.onError?.(String(event.code), String(event.message));
        return "error";
      }
      case "stopped": {
        this.metaPath = typeof event.metaPath === "string" ? event.metaPath : undefined;
        return "stopped";
      }
      default:
        return undefined;
    }
  }
}

/**
 * Run `audiocap doctor --json`. Reports `nativeAvailable: false` (with the reason as
 * a check) rather than throwing, so the UI can always render something actionable.
 */
export async function runCaptureDoctor(recordingsRoot: string): Promise<MeetingDoctorReport> {
  if (!osSupportsNativeCapture()) {
    return {
      ok: true,
      nativeAvailable: false,
      checks: [
        {
          name: "native capture",
          status: "warn",
          detail:
            process.platform === "darwin"
              ? "macOS 14.2 or later is required for system-audio capture"
              : `native capture is macOS-only (this is ${process.platform})`,
          remediation: "meetings will record through the in-app pipeline instead",
        },
      ],
    };
  }
  if (!nativeCaptureAvailable()) {
    return {
      ok: true,
      nativeAvailable: false,
      checks: [
        {
          name: "native capture",
          status: "warn",
          detail: "the audiocap helper is not installed in this build",
          remediation: "meetings will record through the in-app pipeline instead",
        },
      ],
    };
  }

  return new Promise((resolve) => {
    const child = spawn(audiocapBinaryPath(), ["doctor", "--json", "--out", recordingsRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", (err) =>
      resolve({
        ok: false,
        nativeAvailable: false,
        checks: [
          {
            name: "native capture",
            status: "fail",
            detail: `could not run the audiocap helper: ${err.message}`,
          },
        ],
      }),
    );
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout) as {
          ok: boolean;
          sidecarVersion?: string;
          checks?: MeetingDoctorReport["checks"];
        };
        resolve({
          ok: parsed.ok,
          nativeAvailable: true,
          sidecarVersion: parsed.sidecarVersion,
          checks: parsed.checks ?? [],
        });
      } catch {
        resolve({
          ok: false,
          nativeAvailable: true,
          checks: [
            {
              name: "native capture",
              status: "fail",
              detail: "the audiocap helper returned unreadable output",
            },
          ],
        });
      }
    });
  });
}

export type { MeetingCaptureState };
