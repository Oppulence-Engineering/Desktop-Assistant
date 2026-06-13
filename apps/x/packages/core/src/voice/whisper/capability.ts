import * as os from "node:os";
import { spawn } from "node:child_process";
import { binaryPath } from "./bin.js";
import type { WhisperAccel, WhisperCapability } from "@x/shared/dist/transcription.js";

/**
 * Detect the hardware acceleration backend and decide local eligibility
 * (RFC 009 §13, Appendix U). Cached after the first probe so we don't spawn the
 * binary on every launch; `force` re-runs it.
 *
 * Strategy: run `whisper-cli --help` briefly and parse the `system_info:` line it
 * prints (which lists the compiled backends). If the binary is missing or the
 * probe fails, we report `cpu` and let the per-platform heuristic decide support.
 */

export type Accel = WhisperAccel;
export type Capability = WhisperCapability;

let cached: Capability | null = null;

export async function probe(force = false): Promise<Capability> {
  if (cached && !force) return cached;

  const cores = os.cpus()?.length || 4; // `|| 4`: an empty cpus() array (0) must fall back, not gate as <4
  let info: string;
  try {
    info = await systemInfo();
    if (process.platform === "darwin" && !/\bCOREML\s*=/i.test(info)) {
      info += await linkedFrameworkInfo();
    }
  } catch {
    return cache({
      supported: false,
      accel: "cpu",
      cores,
      reason: "whisper-cli unavailable",
    });
  }

  return cache(capabilityFromSystemInfo(info, cores));
}

export function capabilityFromSystemInfo(
  systemInfoText: string,
  cores: number,
  platform = process.platform,
  arch = process.arch,
): Capability {
  const accel = parseAccel(systemInfoText);

  // Apple Silicon always has Metal in practice. Core ML is reported only when
  // the probe finds explicit evidence (system_info or a linked CoreML framework).
  // Short-circuit so the generic CPU gate below isn't dead code here.
  if (platform === "darwin" && arch === "arm64") {
    return { supported: true, accel: accel === "cpu" ? "metal" : accel, cores };
  }

  // Everyone else: a parsed GPU backend is fine; CPU-only is gated on core count.
  let supported = true;
  let reason: string | undefined;
  if (accel === "cpu") {
    if (cores < 4) {
      supported = false;
      reason = "CPU-only with <4 cores — too slow for on-device transcription";
    } else {
      reason = "CPU only — may be slow and use battery";
    }
  }

  return { supported, accel, cores, reason };
}

function cache(c: Capability): Capability {
  cached = c;
  return c;
}

/** Reset the memoized probe (used by "Test device" in settings). */
export function resetCapabilityCache(): void {
  cached = null;
}

/** Parse the whisper.cpp `system_info` line for the active backend (Appendix F). */
export function parseAccel(systemInfo: string): Accel {
  const on = (k: string) => new RegExp(`${k}\\s*=\\s*1`, "i").test(systemInfo);
  if (on("COREML") || /CoreML\.framework/i.test(systemInfo)) return "coreml";
  if (on("METAL") || /\bMetal\s*:/i.test(systemInfo)) return "metal";
  if (on("CUDA")) return "cuda";
  if (on("VULKAN")) return "vulkan";
  return "cpu";
}

/**
 * Run the binary briefly to capture its `system_info:` line (stdout or stderr).
 *
 * KNOWN LIMITATION: whisper.cpp prints `system_info` at the start of *inference*,
 * not on `--help`, so on non-Apple-Silicon hosts this usually yields no backend
 * tokens and {@link parseAccel} falls back to `cpu` — a pessimistic accel/UI label
 * (local still works; `supported` is gated on core count, not the parsed backend).
 * A precise probe would run a sub-second fixture inference once a model is present
 * (RFC §13, Appendix F) — deferred until the eval corpus lands.
 */
function systemInfo(): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(out);
      }
    };
    const child = spawn(binaryPath(), ["--help"], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString())); // system_info often on stderr
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("close", finish);
    setTimeout(() => {
      child.kill();
      finish();
    }, 3000);
  });
}

function linkedFrameworkInfo(): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(out);
      }
    };
    const child = spawn("otool", ["-L", binaryPath()], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("error", finish);
    child.on("close", finish);
    setTimeout(() => {
      child.kill();
      finish();
    }, 3000);
  });
}
