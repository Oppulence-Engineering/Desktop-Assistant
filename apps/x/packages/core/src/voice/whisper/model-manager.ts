import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CATALOG, VAD_MODEL_ID, type ModelEntry } from "./catalog.js";
import { WhisperError } from "./errors.js";
import type { WhisperModelHealth, WhisperModelProgress } from "@x/shared/dist/transcription.js";

/**
 * Model catalog manager (RFC 009 §9, Appendix P): resumable + checksum-verified
 * download, atomic install, disk guard, Core ML sidecar, concurrency coalescing,
 * retry/backoff, GC, and a self-healing on-disk ledger.
 *
 * Integrity invariant: a model is only ever installed after its bytes match the
 * **pinned** SHA-256 from the catalog. A model with no pinned checksum is refused
 * (the catalog's `sha256` is empty until `scripts/whisper-fetch-checksums.mjs`
 * populates it), so an unverified download can never reach disk.
 */

export type ModelProgress = WhisperModelProgress;

const VERIFY_TTL_MS = 30 * 24 * 3600 * 1000; // re-hash the active model at most monthly
const MAX_RETRIES = 4;
const LEDGER_FILE = ".catalog-state.json";
const COREML_MARKER_FILE = ".rowboat-coreml.json";
const PROGRESS_EVERY_MB = 2;

interface LedgerEntry {
  path: string;
  bytes: number;
  sha256: string;
  installedAt: string;
  lastVerifiedAt: string;
  coreml?: boolean;
  coremlSha256?: string;
}
interface Ledger {
  schemaVersion: 1;
  installed: Record<string, LedgerEntry>;
}
interface ArtifactHealth {
  ok: boolean;
  sizeBytes: number;
  actualChecksum?: string;
  expectedChecksum: string;
  reason?: string;
}
interface CoreMLMarker {
  sha256: string;
  installedAt: string;
}

/** Injectable dependencies (defaults are the real runtime; overridden in tests). */
export interface ModelManagerDeps {
  catalog?: ModelEntry[];
  fetchImpl?: typeof fetch;
  /** Free bytes available at `dir` (default: statfs). */
  freeBytes?: (dir: string) => Promise<number>;
  /** Clock, for the verify TTL (default: Date.now). */
  now?: () => number;
  /** Runtime platform; injectable so Core ML behavior is testable cross-platform. */
  platform?: NodeJS.Platform;
}

export class ModelManager {
  private ledger: Ledger | null = null;
  private readonly inflight = new Map<string, Promise<string>>(); // coalesce concurrent ensure()
  private readonly catalog: ModelEntry[];
  private readonly fetchImpl: typeof fetch;
  private readonly freeBytes: (dir: string) => Promise<number>;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;

  constructor(
    private readonly dir: string /* ~/.rowboat/models */,
    private readonly emit: (p: ModelProgress) => void,
    deps: ModelManagerDeps = {},
  ) {
    this.catalog = deps.catalog ?? CATALOG;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.freeBytes = deps.freeBytes ?? defaultFreeBytes;
    this.now = deps.now ?? Date.now;
    this.platform = deps.platform ?? process.platform;
  }

  // ---- public API ----

  async list(): Promise<Array<ModelEntry & { installed: boolean }>> {
    const led = await this.loadLedger();
    return Promise.all(
      this.catalog.map(async (m) => ({
        ...m,
        installed:
          !!led.installed[m.id] && (await exists(path.join(this.dir, path.basename(m.url)))),
      })),
    );
  }

  pathFor(id: string): string {
    const m = this.entry(id);
    return path.join(this.dir, path.basename(m.url)); // ggml-<name>.bin
  }

  /** Ensure a model (+ the VAD model when `withVad`) is present and verified. */
  async ensure(id: string, opts: { withVad?: boolean } = {}): Promise<string> {
    const existing = this.inflight.get(id);
    if (existing) return existing; // coalesce duplicate ensure() calls onto one promise
    const promise = this.ensureInner(id, opts).finally(() => this.inflight.delete(id));
    this.inflight.set(id, promise);
    return promise;
  }

  async remove(id: string): Promise<void> {
    const led = await this.loadLedger();
    const entry = led.installed[id];
    if (!entry) return;
    await rmQuiet(path.join(this.dir, entry.path));
    if (entry.coreml) {
      await rmQuiet(path.join(this.dir, coremlSidecarDirNameForModelFile(entry.path)), {
        recursive: true,
      });
    }
    delete led.installed[id];
    await this.saveLedger(led);
  }

  async verifyModel(id: string): Promise<WhisperModelHealth> {
    const m = this.entry(id);
    const led = await this.loadLedger();
    const rec = led.installed[id];
    let repairable = false;
    let reason: string | undefined;
    const markIssue = (message: string, canRepair: boolean) => {
      reason ??= message;
      repairable ||= canRepair;
    };

    const gguf = m.sha256
      ? await this.verifyArtifact(this.pathFor(id), m.sha256)
      : ({
          ok: false,
          sizeBytes: 0,
          expectedChecksum: "",
          reason: "missing_checksum",
        } satisfies ArtifactHealth);
    if (!m.sha256) {
      markIssue(`No pinned checksum for ${id}.`, false);
    } else if (!gguf.ok) {
      markIssue(
        gguf.reason === "missing" ? "Model file is missing." : "Model checksum mismatch.",
        true,
      );
    }

    let vadOk = true;
    // Only transcription models carry a companion VAD; VAD/speaker-embedding
    // assets verify on their own (RFC 017).
    const vad =
      m.kind !== "transcription" || id === VAD_MODEL_ID ? undefined : this.findEntry(VAD_MODEL_ID);
    if (vad) {
      if (!vad.sha256) {
        vadOk = false;
        markIssue("No pinned checksum for the VAD model.", false);
      } else {
        const vadHealth = await this.verifyArtifact(this.pathFor(VAD_MODEL_ID), vad.sha256);
        vadOk = vadHealth.ok;
        if (!vadHealth.ok) {
          markIssue(
            vadHealth.reason === "missing" ? "VAD model is missing." : "VAD checksum mismatch.",
            true,
          );
        }
      }
    }

    let coremlOk: boolean | undefined;
    if (m.coreml) {
      const sidecarName = coremlSidecarDirNameForModelFile(rec?.path ?? path.basename(m.url));
      const sidecar = path.join(this.dir, sidecarName);
      const zip = path.join(this.dir, path.basename(m.coreml.url));
      const [hasSidecar, hasZip] = await Promise.all([isDirectory(sidecar), exists(zip)]);
      const shouldCheckCoreML =
        this.platform === "darwin" || hasSidecar || hasZip || !!rec?.coreml || !!rec?.coremlSha256;

      if (shouldCheckCoreML) {
        if (!m.coreml.sha256) {
          coremlOk = false;
          markIssue("No pinned checksum for the Core ML sidecar.", false);
        } else if (!hasSidecar) {
          coremlOk = false;
          if (hasZip) {
            const zipHealth = await this.verifyArtifact(zip, m.coreml.sha256);
            markIssue(
              zipHealth.ok
                ? "Core ML sidecar is missing or needs extraction."
                : "Core ML sidecar is missing and cached archive checksum mismatch.",
              true,
            );
          } else {
            markIssue("Core ML sidecar is missing.", true);
          }
        } else {
          const marker = await this.readCoreMLMarker(sidecar);
          coremlOk = marker?.sha256 === m.coreml.sha256;
          if (!coremlOk) {
            markIssue("Core ML sidecar install marker is missing or checksum mismatch.", true);
          }
        }
      }
    }

    return {
      id,
      installed: gguf.ok,
      ggufOk: gguf.ok,
      vadOk,
      ...(coremlOk === undefined ? {} : { coremlOk }),
      sizeMb: bytesToMb(gguf.sizeBytes),
      expectedSizeMb: m.sizeMb,
      ...(gguf.actualChecksum ? { checksum: gguf.actualChecksum } : {}),
      ...(m.sha256 ? { expectedChecksum: m.sha256 } : {}),
      repairable,
      ...(reason ? { reason } : {}),
    };
  }

  async repairModel(id: string): Promise<WhisperModelHealth> {
    const health = await this.verifyModel(id);
    if (!health.repairable) return health;

    const m = this.entry(id);
    await this.remove(id);
    await rmQuiet(this.pathFor(id));
    if (m.coreml) {
      await rmQuiet(path.join(this.dir, coremlSidecarDirNameForModelFile(path.basename(m.url))), {
        recursive: true,
      });
      await rmQuiet(path.join(this.dir, path.basename(m.coreml.url)));
    }
    const hasVad = this.hasEntry(VAD_MODEL_ID);
    if (hasVad && id !== VAD_MODEL_ID && !health.vadOk) {
      await this.remove(VAD_MODEL_ID);
      await rmQuiet(this.pathFor(VAD_MODEL_ID));
    }
    await this.ensure(id, { withVad: hasVad });
    return this.verifyModel(id);
  }

  /**
   * Free space for everything except the active model and the shared non-
   * transcription assets (VAD + speaker embedding), which are reused across
   * models and must survive GC (RFC 017).
   */
  async gc(activeId: string): Promise<number> {
    const led = await this.loadLedger();
    let freed = 0;
    for (const id of Object.keys(led.installed)) {
      if (id === activeId) continue;
      const entry = this.findEntry(id);
      if (entry && entry.kind !== "transcription") continue; // keep vad + embedding
      freed += led.installed[id].bytes;
      await this.remove(id);
    }
    return freed;
  }

  // ---- internals ----

  private findEntry(id: string): ModelEntry | undefined {
    return this.catalog.find((x) => x.id === id);
  }

  private hasEntry(id: string): boolean {
    return !!this.findEntry(id);
  }

  private entry(id: string): ModelEntry {
    const m = this.findEntry(id);
    if (!m) throw new WhisperError("model_not_installed", `unknown model ${id}`);
    return m;
  }

  private async ensureInner(id: string, opts: { withVad?: boolean }): Promise<string> {
    const m = this.entry(id);
    const dest = this.pathFor(id);
    const led = await this.loadLedger();

    // Every success path returns through here so the companion VAD model is ensured
    // even when the main model was already installed — otherwise a VAD that failed to
    // download (or was removed) after the main model is recorded never self-heals, and
    // buildArgs keeps passing `--vad-model <missing>`, failing every transcription.
    const finish = async (): Promise<string> => {
      if (await this.ensureCoreMLForInstalled(m, led)) await this.saveLedger(led);
      if (opts.withVad && id !== VAD_MODEL_ID && this.hasEntry(VAD_MODEL_ID)) {
        await this.ensure(VAD_MODEL_ID); // coalesced
      }
      return dest;
    };

    // Already installed? Re-confirm lazily past the TTL — but with a CHEAP size check,
    // not a full sha256 re-hash: ensure() is on the user-facing hot path (every voice
    // submit / meeting start) and the active model can be ~1 GB. The authoritative hash
    // ran at install time (recorded as `bytes`); a size match re-confirms integrity
    // here, and a mismatch falls through to re-download.
    const rec = led.installed[id];
    if (rec && (await exists(dest))) {
      if (this.now() - Date.parse(rec.lastVerifiedAt) > VERIFY_TTL_MS) {
        let sizeOk = false;
        try {
          sizeOk = (await fs.stat(dest)).size === rec.bytes;
        } catch {
          sizeOk = false;
        }
        if (sizeOk) {
          rec.lastVerifiedAt = new Date(this.now()).toISOString();
          await this.saveLedger(led);
          return finish();
        }
        await rmQuiet(dest);
        delete led.installed[id];
        await this.saveLedger(led);
      } else {
        return finish();
      }
    }

    if (!m.sha256) {
      // No pinned checksum → refuse rather than trust an unverified download.
      throw new WhisperError(
        "download_failed",
        `no pinned checksum for ${id}; run scripts/whisper-fetch-checksums.mjs`,
      );
    }

    await fs.mkdir(this.dir, { recursive: true });
    await this.assertDisk(m.sizeMb);
    await this.downloadWithResume(m, dest);
    if (!(await this.verify(dest, m.sha256, id))) {
      await rmQuiet(dest);
      throw new WhisperError("checksum_mismatch", `sha256 mismatch for ${id}`);
    }

    const coreml = await this.tryDownloadCoreML(m);

    const bytes = (await fs.stat(dest)).size;
    led.installed[id] = {
      path: path.basename(dest),
      bytes,
      sha256: m.sha256,
      installedAt: new Date(this.now()).toISOString(),
      lastVerifiedAt: new Date(this.now()).toISOString(),
      coreml,
      coremlSha256: coreml ? m.coreml?.sha256 : undefined,
    };
    await this.saveLedger(led);

    return finish();
  }

  /** Resumable download to `<dest>.part` with backoff; atomic rename on success. */
  private async downloadWithResume(m: ModelEntry, dest: string): Promise<void> {
    const part = `${dest}.part`;
    for (let attempt = 0; ; attempt++) {
      let from = 0;
      try {
        from = (await fs.stat(part)).size;
      } catch {
        /* no partial */
      }
      try {
        const res = await this.fetchImpl(m.url, {
          headers: from > 0 ? { Range: `bytes=${from}-` } : {},
        });
        // 416 on a resume means the .part is already >= the full length (e.g. a complete
        // file left by a crash before rename, or a stale/oversized partial). Discard it and
        // restart from scratch instead of retrying the same unsatisfiable Range forever.
        if (res.status === 416 && from > 0) {
          await rmQuiet(part);
          // Only restart (a fresh from=0 download) once the stale partial is actually gone;
          // a `continue` here can't re-hit 416 because the next request sends no Range. If the
          // file couldn't be removed (locked / read-only), fall into the BOUNDED retry path
          // below rather than spinning on the same unsatisfiable Range forever.
          if (!(await exists(part))) continue;
          throw new WhisperError(
            "download_failed",
            "stale partial (HTTP 416) could not be cleared",
          );
        }
        if (!res.ok || !res.body) throw new WhisperError("download_failed", `HTTP ${res.status}`);
        if (from > 0 && res.status !== 206) {
          await rmQuiet(part); // server ignored Range → restart from scratch
          from = 0;
        }
        const out = createWriteStream(part, { flags: from > 0 ? "a" : "w" });
        let received = from;
        let lastEmitMb = 0;
        const emit = this.emit;
        const id = m.id;
        const totalMb = m.sizeMb;
        await pipeline(
          Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
          async function* (source: AsyncIterable<Buffer>) {
            for await (const chunk of source) {
              received += chunk.length;
              const mb = received / (1024 * 1024);
              if (mb - lastEmitMb >= PROGRESS_EVERY_MB) {
                lastEmitMb = mb;
                emit({ id, phase: "download", receivedMb: Math.round(mb), totalMb });
              }
              yield chunk;
            }
          },
          out,
        );
        await fs.rename(part, dest); // atomic install
        emit({ id, phase: "download", receivedMb: totalMb, totalMb });
        return;
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          throw err instanceof WhisperError
            ? err
            : new WhisperError("download_failed", String(err));
        }
        await sleep(backoff(attempt));
      }
    }
  }

  /** Download + unzip the macOS Core ML encoder sidecar next to the model. */
  private async tryDownloadCoreML(m: ModelEntry): Promise<boolean> {
    if (this.platform !== "darwin" || !m.coreml) return false;
    try {
      await this.downloadCoreML(m);
      return true;
    } catch {
      // Best-effort: a CoreML-capable binary built with fallback still works via
      // Metal/CPU when the sidecar is unavailable or corrupt.
      return false;
    }
  }

  private async ensureCoreMLForInstalled(m: ModelEntry, led: Ledger): Promise<boolean> {
    const rec = led.installed[m.id];
    if (this.platform !== "darwin" || !m.coreml || !rec) return false;

    const sidecar = path.join(this.dir, coremlSidecarDirNameForModelFile(path.basename(m.url)));
    const hasSidecar = await isDirectory(sidecar);
    const marker = hasSidecar ? await this.readCoreMLMarker(sidecar) : null;
    const sidecarCurrent = marker?.sha256 === m.coreml.sha256;
    if (sidecarCurrent && rec.coreml && rec.coremlSha256 === m.coreml.sha256) return false;
    if (sidecarCurrent) {
      rec.coreml = true;
      rec.coremlSha256 = m.coreml.sha256;
      return true;
    }

    const previousCoreML = rec.coreml;
    const previousCoreMLSha256 = rec.coremlSha256;
    rec.coreml = await this.tryDownloadCoreML(m);
    rec.coremlSha256 = rec.coreml ? m.coreml.sha256 : undefined;
    return previousCoreML !== rec.coreml || previousCoreMLSha256 !== rec.coremlSha256;
  }

  private async downloadCoreML(m: ModelEntry): Promise<void> {
    if (!m.coreml) return;
    const zip = path.join(this.dir, path.basename(m.coreml.url));
    const sidecar = path.join(this.dir, coremlSidecarDirNameForModelFile(path.basename(m.url)));
    let sidecarTouched = false;
    let installed = false;
    try {
      await this.assertDisk(m.coreml.sizeMb);
      await this.downloadWithResume(
        { ...m, url: m.coreml.url, sha256: m.coreml.sha256, sizeMb: m.coreml.sizeMb },
        zip,
      );
      if (!(await this.verify(zip, m.coreml.sha256, `${m.id}-coreml`))) {
        await rmQuiet(zip);
        throw new WhisperError("checksum_mismatch");
      }
      await rmQuiet(sidecar, { recursive: true });
      sidecarTouched = true;
      await unzipInto(zip, this.dir);
      if (!(await isDirectory(sidecar))) {
        throw new WhisperError("download_failed", `Core ML sidecar did not extract to ${sidecar}`);
      }
      await this.writeCoreMLMarker(sidecar, m.coreml.sha256);
      installed = true;
    } finally {
      if (sidecarTouched && !installed) await rmQuiet(sidecar, { recursive: true });
      await rmQuiet(zip);
    }
  }

  private async verify(file: string, sha256: string, id: string): Promise<boolean> {
    this.emit({ id, phase: "verify", receivedMb: 0, totalMb: 0 });
    const hash = createHash("sha256");
    await pipeline(createReadStream(file), hash);
    return hash.digest("hex") === sha256;
  }

  private async verifyArtifact(filePath: string, expectedSha256: string): Promise<ArtifactHealth> {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return {
        ok: false,
        sizeBytes: 0,
        expectedChecksum: expectedSha256,
        reason: "missing",
      };
    }
    if (!stat.isFile()) {
      return {
        ok: false,
        sizeBytes: stat.size,
        expectedChecksum: expectedSha256,
        reason: "not_file",
      };
    }

    try {
      const hash = createHash("sha256");
      await pipeline(createReadStream(filePath), hash);
      const actualChecksum = hash.digest("hex");
      return {
        ok: actualChecksum === expectedSha256,
        sizeBytes: stat.size,
        actualChecksum,
        expectedChecksum: expectedSha256,
        ...(actualChecksum === expectedSha256 ? {} : { reason: "checksum_mismatch" }),
      };
    } catch {
      return {
        ok: false,
        sizeBytes: stat.size,
        expectedChecksum: expectedSha256,
        reason: "read_failed",
      };
    }
  }

  private async readCoreMLMarker(sidecarDir: string): Promise<CoreMLMarker | null> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(sidecarDir, COREML_MARKER_FILE), "utf8"),
      ) as Partial<CoreMLMarker>;
      if (typeof parsed.sha256 === "string" && typeof parsed.installedAt === "string") {
        return { sha256: parsed.sha256, installedAt: parsed.installedAt };
      }
    } catch {
      /* missing or invalid marker */
    }
    return null;
  }

  private async writeCoreMLMarker(sidecarDir: string, sha256: string): Promise<void> {
    await fs.writeFile(
      path.join(sidecarDir, COREML_MARKER_FILE),
      JSON.stringify({ sha256, installedAt: new Date(this.now()).toISOString() }, null, 2),
    );
  }

  private async assertDisk(sizeMb: number): Promise<void> {
    const free = await this.freeBytes(this.dir);
    if (free < sizeMb * 1024 * 1024 * 1.2) {
      throw new WhisperError("insufficient_disk", `need ~${Math.ceil(sizeMb * 1.2)}MB`);
    }
  }

  // ---- ledger (self-healing: the filesystem is the source of truth) ----

  private async loadLedger(): Promise<Ledger> {
    if (this.ledger) return this.ledger;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, LEDGER_FILE), "utf8")) as Ledger;
      if (raw.schemaVersion === 1) {
        this.ledger = raw;
        return raw;
      }
    } catch {
      /* missing/corrupt → rescan from disk */
    }
    this.ledger = await this.rescan();
    await this.saveLedger(this.ledger);
    return this.ledger;
  }

  private async saveLedger(led: Ledger): Promise<void> {
    this.ledger = led;
    const dest = path.join(this.dir, LEDGER_FILE);
    const tmp = `${dest}.tmp`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(led, null, 2));
    await fs.rename(tmp, dest); // atomic
  }

  /** Rebuild the ledger by re-hashing present files (drops anything corrupt). */
  private async rescan(): Promise<Ledger> {
    const led: Ledger = { schemaVersion: 1, installed: {} };
    let files: string[] = [];
    try {
      files = await fs.readdir(this.dir);
    } catch {
      return led;
    }
    for (const m of this.catalog) {
      const base = path.basename(m.url);
      if (!files.includes(base) || !m.sha256) continue;
      const full = path.join(this.dir, base);
      if (!(await this.verify(full, m.sha256, m.id))) {
        await rmQuiet(full); // drop corrupt
        continue;
      }
      const coremlMarker = m.coreml
        ? await this.readCoreMLMarker(path.join(this.dir, coremlSidecarDirNameForModelFile(base)))
        : null;
      const coreml = !!m.coreml && coremlMarker?.sha256 === m.coreml.sha256;
      led.installed[m.id] = {
        path: base,
        bytes: (await fs.stat(full)).size,
        sha256: m.sha256,
        installedAt: new Date(this.now()).toISOString(),
        lastVerifiedAt: new Date(this.now()).toISOString(),
        coreml,
        coremlSha256: coreml ? m.coreml?.sha256 : undefined,
      };
    }
    return led;
  }
}

// ---- small helpers ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(8000, 500 * 2 ** n) + Math.random() * 250;
const bytesToMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Delete `.part` files left behind by downloads that were never finished.
 *
 * Partials are how resume works, so they cannot be reaped eagerly — but nothing
 * reaped them at all. `remove()` and `gc()` both iterate the ledger, and a
 * partial is only written there once it completes, which makes an abandoned
 * download invisible to both. Found on a real install: a 913MB
 * `ggml-large-v3-q5_0.bin.part`, larger than every model actually in use put
 * together.
 *
 * A free function on a directory rather than a ModelManager method: this is
 * startup housekeeping, it needs no ledger, and putting it in the constructor
 * broke every partially-stubbed ModelManager in the test suite.
 *
 * A week is far longer than any real resume window and short enough that a
 * cancelled download does not outlive the decision to cancel it.
 *
 * @param dir - The models directory.
 * @param maxAgeMs - Age past which a partial counts as abandoned.
 * @param now - Injectable clock.
 * @returns Bytes reclaimed.
 */
export async function reapStalePartials(
  dir: string,
  maxAgeMs: number = 7 * 24 * 3600 * 1000,
  now: number = Date.now(),
): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }

  let freed = 0;
  for (const name of names.filter((n) => n.endsWith(".part"))) {
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs <= maxAgeMs) continue;
      await rmQuiet(full);
      freed += stat.size;
    } catch {
      // Unreadable or already gone — nothing to reclaim.
    }
  }
  return freed;
}

async function rmQuiet(p: string, opts: { recursive?: boolean } = {}): Promise<void> {
  try {
    await fs.rm(p, { force: true, ...opts });
  } catch {
    /* ignore */
  }
}

export function coremlSidecarDirNameForModelFile(fileName: string): string {
  let stem = path.basename(fileName);
  const dot = stem.lastIndexOf(".");
  if (dot !== -1) stem = stem.slice(0, dot);
  stem = stem.replace(/-q[0-9]_[0-9]$/, "");
  return `${stem}-encoder.mlmodelc`;
}

/** Default free-space probe via statfs, walking up to the nearest existing dir. */
async function defaultFreeBytes(dir: string): Promise<number> {
  let target = dir;
  for (let i = 0; i < 6; i++) {
    try {
      const s = await fs.statfs(target);
      return s.bavail * s.bsize;
    } catch {
      const parent = path.dirname(target);
      if (parent === target) break;
      target = parent;
    }
  }
  return Number.MAX_SAFE_INTEGER; // can't determine → don't block (best-effort guard)
}

/** Extract a .zip into a directory (macOS Core ML sidecar). Uses ditto, then unzip. */
function unzipInto(zip: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryUnzip = () => {
      const u = spawn("unzip", ["-o", zip, "-d", destDir], { stdio: "ignore" });
      u.on("error", reject);
      u.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`))));
    };
    const ditto = spawn("ditto", ["-x", "-k", zip, destDir], { stdio: "ignore" });
    ditto.on("error", tryUnzip); // ditto absent (non-mac) → fall back to unzip
    ditto.on("close", (code) => (code === 0 ? resolve() : tryUnzip()));
  });
}
