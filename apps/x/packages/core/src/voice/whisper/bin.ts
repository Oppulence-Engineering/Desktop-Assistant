import * as fs from "node:fs";
import * as path from "node:path";
import { WhisperError } from "./errors.js";
import { VAD_FILE_NAME } from "./catalog.js";

/**
 * Resolve the per-arch `whisper-cli` binary (RFC 009 §20, Appendix W.1).
 *
 * Core stays Electron-free, so the main process injects the resolved path via
 * {@link configureWhisperBinary} at startup (it knows `app.isPackaged` /
 * `process.resourcesPath`). For dev, tests, and the spike script — which run
 * outside Electron — `ROWBOAT_WHISPER_BIN` (absolute path) or `ROWBOAT_WHISPER_DIR`
 * (directory containing the exe) provide the path. If none resolve to an existing
 * file, `binaryPath()` throws `engine_unavailable`, which the provider resolver
 * turns into a graceful cloud fallback.
 */

const EXE = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

let injectedPath: string | null = null;
let resolved: string | null = null;

/** Called once by the main process with the absolute path to the bundled binary. */
export function configureWhisperBinary(absolutePath: string): void {
  injectedPath = absolutePath;
  resolved = null; // re-resolve on next access
}

function candidatePath(): string | null {
  if (injectedPath) return injectedPath;
  if (process.env.ROWBOAT_WHISPER_BIN) return process.env.ROWBOAT_WHISPER_BIN;
  if (process.env.ROWBOAT_WHISPER_DIR) return path.join(process.env.ROWBOAT_WHISPER_DIR, EXE);
  return null;
}

/** Absolute path to a runnable `whisper-cli`. Throws `engine_unavailable` if absent. */
export function binaryPath(): string {
  if (resolved) return resolved;
  const candidate = candidatePath();
  if (!candidate || !fs.existsSync(candidate)) {
    throw new WhisperError(
      "engine_unavailable",
      `whisper-cli not found${candidate ? ` at ${candidate}` : ""}`,
    );
  }
  try {
    fs.chmodSync(candidate, 0o755); // ensure the exec bit (lost on asar extraction / fresh DL)
  } catch {
    /* not permitted on Windows / read-only fs — ignore */
  }
  resolved = candidate;
  return candidate;
}

/** Whether a runnable binary is present (cheap check; no throw). */
export function binaryAvailable(): boolean {
  try {
    binaryPath();
    return true;
  } catch {
    return false;
  }
}

/** Path to the Silero VAD model within the given models directory. */
export function vadModelPath(modelsDir: string): string {
  return path.join(modelsDir, VAD_FILE_NAME);
}
