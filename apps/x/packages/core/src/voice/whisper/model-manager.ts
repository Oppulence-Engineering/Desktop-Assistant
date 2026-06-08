import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CATALOG, VAD_MODEL_ID, type ModelEntry } from "./catalog.js";
import { WhisperError } from "./errors.js";
import type { WhisperModelProgress } from "@x/shared/dist/transcription.js";

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
const PROGRESS_EVERY_MB = 2;

interface LedgerEntry {
  path: string;
  bytes: number;
  sha256: string;
  installedAt: string;
  lastVerifiedAt: string;
  coreml?: boolean;
}
interface Ledger {
  schemaVersion: 1;
  installed: Record<string, LedgerEntry>;
}

/** Injectable dependencies (defaults are the real runtime; overridden in tests). */
export interface ModelManagerDeps {
  catalog?: ModelEntry[];
  fetchImpl?: typeof fetch;
  /** Free bytes available at `dir` (default: statfs). */
  freeBytes?: (dir: string) => Promise<number>;
  /** Clock, for the verify TTL (default: Date.now). */
  now?: () => number;
}

export class ModelManager {
  private ledger: Ledger | null = null;
  private readonly inflight = new Map<string, Promise<string>>(); // coalesce concurrent ensure()
  private readonly catalog: ModelEntry[];
  private readonly fetchImpl: typeof fetch;
  private readonly freeBytes: (dir: string) => Promise<number>;
  private readonly now: () => number;

  constructor(
    private readonly dir: string /* ~/.rowboat/models */,
    private readonly emit: (p: ModelProgress) => void,
    deps: ModelManagerDeps = {},
  ) {
    this.catalog = deps.catalog ?? CATALOG;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.freeBytes = deps.freeBytes ?? defaultFreeBytes;
    this.now = deps.now ?? Date.now;
  }

  // ---- public API ----

  async list(): Promise<Array<ModelEntry & { installed: boolean }>> {
    const led = await this.loadLedger();
    return this.catalog.map((m) => ({ ...m, installed: !!led.installed[m.id] }));
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
      await rmQuiet(path.join(this.dir, entry.path.replace(/\.bin$/, "-encoder.mlmodelc")), {
        recursive: true,
      });
    }
    delete led.installed[id];
    await this.saveLedger(led);
  }

  /** Free space for everything except the active model and the VAD model. */
  async gc(activeId: string): Promise<number> {
    const led = await this.loadLedger();
    let freed = 0;
    for (const id of Object.keys(led.installed)) {
      if (id === activeId || id === VAD_MODEL_ID) continue;
      freed += led.installed[id].bytes;
      await this.remove(id);
    }
    return freed;
  }

  // ---- internals ----

  private entry(id: string): ModelEntry {
    const m = this.catalog.find((x) => x.id === id);
    if (!m) throw new WhisperError("model_not_installed", `unknown model ${id}`);
    return m;
  }

  private async ensureInner(id: string, opts: { withVad?: boolean }): Promise<string> {
    const m = this.entry(id);
    const dest = this.pathFor(id);
    const led = await this.loadLedger();

    // Already installed? Re-verify lazily past the TTL.
    const rec = led.installed[id];
    if (rec && (await exists(dest))) {
      if (this.now() - Date.parse(rec.lastVerifiedAt) > VERIFY_TTL_MS) {
        if (await this.verify(dest, m.sha256, id)) {
          rec.lastVerifiedAt = new Date(this.now()).toISOString();
          await this.saveLedger(led);
          return dest;
        }
        await rmQuiet(dest);
        delete led.installed[id];
        await this.saveLedger(led);
      } else {
        return dest;
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

    let coreml = false;
    if (process.platform === "darwin" && m.coreml) {
      try {
        await this.downloadCoreML(m);
        coreml = true;
      } catch {
        /* best-effort: Metal/CPU still works without the Core ML sidecar */
      }
    }

    const bytes = (await fs.stat(dest)).size;
    led.installed[id] = {
      path: path.basename(dest),
      bytes,
      sha256: m.sha256,
      installedAt: new Date(this.now()).toISOString(),
      lastVerifiedAt: new Date(this.now()).toISOString(),
      coreml,
    };
    await this.saveLedger(led);

    if (opts.withVad && id !== VAD_MODEL_ID) await this.ensure(VAD_MODEL_ID); // coalesced recursion
    return dest;
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
  private async downloadCoreML(m: ModelEntry): Promise<void> {
    if (!m.coreml) return;
    const zip = path.join(this.dir, path.basename(m.coreml.url));
    await this.downloadWithResume({ ...m, url: m.coreml.url, sha256: m.coreml.sha256 }, zip);
    if (!(await this.verify(zip, m.coreml.sha256, `${m.id}-coreml`))) {
      await rmQuiet(zip);
      throw new WhisperError("checksum_mismatch");
    }
    await unzipInto(zip, this.dir);
    await rmQuiet(zip);
  }

  private async verify(file: string, sha256: string, id: string): Promise<boolean> {
    this.emit({ id, phase: "verify", receivedMb: 0, totalMb: 0 });
    const hash = createHash("sha256");
    await pipeline(createReadStream(file), hash);
    return hash.digest("hex") === sha256;
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
      led.installed[m.id] = {
        path: base,
        bytes: (await fs.stat(full)).size,
        sha256: m.sha256,
        installedAt: new Date(this.now()).toISOString(),
        lastVerifiedAt: new Date(this.now()).toISOString(),
        coreml: files.includes(base.replace(/\.bin$/, "-encoder.mlmodelc")),
      };
    }
    return led;
  }
}

// ---- small helpers ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(8000, 500 * 2 ** n) + Math.random() * 250;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmQuiet(p: string, opts: { recursive?: boolean } = {}): Promise<void> {
  try {
    await fs.rm(p, { force: true, ...opts });
  } catch {
    /* ignore */
  }
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
