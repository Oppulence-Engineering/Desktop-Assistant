// Provisioning and lifecycle for a managed Ollama, so on-device embeddings work
// without the user installing anything.
//
// Follows the whisper model-manager's integrity rule (RFC 009 §9): bytes only
// reach their install path after matching a checksum pinned in this file. An
// unverified runtime binary is worse than no local embeddings — it is arbitrary
// code we then execute.
//
// Deliberately macOS-only for the download. Ollama publishes one darwin archive
// at 145MB, but the Linux and Windows builds are 1.4GB because they carry CUDA
// and ROCm runners we would never load for a 137M-parameter embedding model.
// Pulling 1.4GB in the background to avoid a fraction of a cent of embedding
// spend is not a trade worth making silently, so elsewhere we use a daemon the
// user already runs, or stay hosted.
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { WorkDir } from "../config/config.js";
import { loadMemoryConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * The pinned runtime. `sha256` was verified by downloading this exact asset and
 * hashing it, and matches the digest GitHub publishes for the release.
 *
 * Bumping the version means re-pinning the checksum. Do not take the digest on
 * faith from a changelog — download and hash it, because this value is the only
 * thing standing between a compromised mirror and code we spawn.
 */
const RUNTIME = {
  version: "0.32.6",
  url: "https://github.com/ollama/ollama/releases/download/v0.32.6/ollama-darwin.tgz",
  sha256: "c256147703b0b24a9871ec9f94fc108f18cf87ff043aebd6f7e4a95fcfb4f042",
  archiveBytes: 145_435_565,
  /** Extracted tree is ~463MB; the guard needs room for both at once. */
  installedBytes: 485_000_000,
} as const;

/** The port a managed daemon listens on. 11434 is Ollama's own default and is
 *  left alone so a user's existing daemon is never fought over. */
const MANAGED_PORT = 11435;
const SYSTEM_HOST = "http://127.0.0.1:11434";
const HEALTH_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 1_500;

function runtimeDir(): string {
  return path.join(WorkDir, "runtime", "ollama", RUNTIME.version);
}

/** Model blobs live under WorkDir with everything else we manage, not in ~/.ollama. */
function modelsDir(): string {
  return path.join(WorkDir, "models", "ollama");
}

function binaryPath(): string {
  return path.join(runtimeDir(), "ollama");
}

/** True when this platform gets an auto-provisioned runtime. See the file header. */
export function canProvisionRuntime(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Answers /api/version at `baseURL` within the probe timeout. */
export async function daemonResponds(baseURL: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseURL}/api/version`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- install -----------------------------------------------------------------

let installInFlight: Promise<boolean> | null = null;

async function freeBytes(dir: string): Promise<number> {
  try {
    const st = await fs.statfs(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return Number.POSITIVE_INFINITY; // don't block on an unmeasurable volume
  }
}

/**
 * Download, verify and install the runtime. Single-flight; resolves false on any
 * failure, because a missing local runtime is a degraded mode, not an error the
 * user needs to act on — the hosted path still works.
 */
export async function installRuntime(): Promise<boolean> {
  if (installInFlight) return installInFlight;
  installInFlight = (async () => {
    const dest = runtimeDir();
    if (await exists(binaryPath())) return true;

    const parent = path.dirname(dest);
    await fs.mkdir(parent, { recursive: true });

    const needed = RUNTIME.archiveBytes + RUNTIME.installedBytes;
    if ((await freeBytes(parent)) < needed) {
      console.log(
        `[Memory] Not enough disk for the local embedding runtime (~${Math.round(needed / 1e6)}MB); staying on the hosted provider.`,
      );
      return false;
    }

    const staging = `${dest}.tmp-${process.pid}`;
    const archive = `${staging}.tgz`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });

    try {
      console.log(`[Memory] Downloading the local embedding runtime (~146MB, once)…`);
      const res = await fetch(RUNTIME.url);
      if (!res.ok || !res.body) throw new Error(`runtime download → ${res.status}`);

      const hash = createHash("sha256");
      const out = createWriteStream(archive);
      const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      body.on("data", (chunk: Buffer) => hash.update(chunk));
      await pipeline(body, out);

      const actual = hash.digest("hex");
      if (actual !== RUNTIME.sha256) {
        // Never install unverified bytes we are about to execute.
        throw new Error(`checksum mismatch: got ${actual}, expected ${RUNTIME.sha256}`);
      }

      // System tar rather than a new dependency; darwin always has /usr/bin/tar,
      // and this path is darwin-only by construction.
      await execFileAsync("/usr/bin/tar", ["-xzf", archive, "-C", staging]);
      await fs.chmod(path.join(staging, "ollama"), 0o755);

      // Atomic swap: a half-extracted tree must never be visible at `dest`.
      await fs.rename(staging, dest);
      console.log(`[Memory] Local embedding runtime installed.`);
      return true;
    } catch (error) {
      console.log(
        `[Memory] Could not install the local embedding runtime:`,
        error instanceof Error ? error.message : error,
      );
      await fs.rm(staging, { recursive: true, force: true });
      return false;
    } finally {
      await fs.rm(archive, { force: true });
    }
  })().finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}

// --- serve -------------------------------------------------------------------

let child: ChildProcess | null = null;
let startInFlight: Promise<boolean> | null = null;
let exitHookInstalled = false;

/** Stops a managed daemon. Safe to call when none is running. */
export function stopOllamaRuntime(): void {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
  child = null;
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // A daemon outliving the app would hold RAM and a port with nothing to serve.
  process.once("exit", stopOllamaRuntime);
  process.once("SIGINT", stopOllamaRuntime);
  process.once("SIGTERM", stopOllamaRuntime);
}

async function startManaged(): Promise<boolean> {
  if (startInFlight) return startInFlight;
  startInFlight = (async () => {
    const managedURL = `http://127.0.0.1:${MANAGED_PORT}`;
    if (await daemonResponds(managedURL)) return true; // ours from a previous tick

    if (!(await exists(binaryPath()))) return false;
    // Everything from here can throw — mkdir on a full disk, spawn on a
    // corrupt binary — and this module promises the caller a boolean, not an
    // exception. A rejection propagates through ensureOllamaRuntime and
    // localEmbedModelReady into resolveEmbedModel and fails the whole index
    // pass, when the correct outcome is simply "no local runtime, stay hosted".
    try {
      await fs.mkdir(modelsDir(), { recursive: true });

      child = spawn(binaryPath(), ["serve"], {
        env: {
          ...process.env,
          OLLAMA_HOST: `127.0.0.1:${MANAGED_PORT}`,
          OLLAMA_MODELS: modelsDir(),
          // One small embedding model, unloaded promptly. Without these an idle
          // daemon sits on hundreds of MB of RSS for a feature the user is not
          // actively using.
          OLLAMA_MAX_LOADED_MODELS: "1",
          OLLAMA_KEEP_ALIVE: "60s",
        },
        stdio: "ignore",
        detached: false,
      });
      child.once("exit", () => {
        child = null;
      });
      // spawn reports failure asynchronously, on the child, not by throwing: a
      // non-executable or missing binary arrives here as EACCES/ENOENT. With no
      // listener Node promotes it to an uncaught exception — in the Electron
      // main process, a crash — and the try/catch around this block never sees
      // it, because it is not on the promise at all.
      let spawnFailed = false;
      child.once("error", (error) => {
        console.log("[Memory] Local embedding runtime failed to start:", error.message);
        spawnFailed = true;
        child = null;
      });
      installExitHook();

      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        // Fail fast rather than waiting out the health timeout for a process we
        // already know never started.
        if (spawnFailed) return false;
        if (await daemonResponds(managedURL)) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log("[Memory] Local embedding runtime did not become healthy; staying hosted.");
      stopOllamaRuntime();
      return false;
    } catch (error) {
      console.log(
        "[Memory] Could not start the local embedding runtime:",
        error instanceof Error ? error.message : error,
      );
      stopOllamaRuntime();
      return false;
    }
  })().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

/**
 * The base URL of a usable Ollama, or null.
 *
 * Order matters. An explicitly configured OLLAMA_HOST or an already-running
 * daemon is the user's, and we use it as-is — starting a second copy of a
 * process they are already running (and duplicating its model store on disk)
 * would be rude and confusing. Only when neither exists do we manage our own.
 *
 * @returns Base URL when local embedding can run now; null when it cannot
 *          (this pass falls back to the hosted provider).
 */
export async function ensureOllamaRuntime(): Promise<string | null> {
  const mode = loadMemoryConfig().localEmbeddings;
  if (mode === "off") return null;

  // An explicit OLLAMA_HOST is a deployment decision; never second-guess it.
  if (process.env.OLLAMA_HOST) {
    const raw = process.env.OLLAMA_HOST.trim();
    const url = (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
    return (await daemonResponds(url)) ? url : null;
  }

  if (await daemonResponds(SYSTEM_HOST)) return SYSTEM_HOST;
  if (mode === "system") return null;

  if (await startManaged()) return `http://127.0.0.1:${MANAGED_PORT}`;

  if (canProvisionRuntime()) {
    // Fire-and-forget: a 146MB download must not hold up an index pass. This
    // pass stays hosted and a later tick picks the runtime up.
    void installRuntime().then((ok) => {
      if (ok) void startManaged();
    });
  }
  return null;
}
