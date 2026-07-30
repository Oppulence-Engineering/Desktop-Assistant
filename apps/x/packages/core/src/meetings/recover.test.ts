import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SAMPLE_RATE, sessionMeta, silence, tone, writeWav } from "./factories.testkit.js";

/**
 * Recovering a session whose recorder was hard-killed. This path exists because a
 * SIGKILL leaves track files and no `meta.json`, and without a meta the recording is
 * invisible to both the pending predicate and the sessions list — it would survive the
 * crash and then never be looked at. Found by actually killing the sidecar.
 */

let tmpDir: string;
let root: string;
let recover: typeof import("./recover.js");
let session: typeof import("./session.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-recover-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  recover = await import("./recover.js");
  session = await import("./session.js");
}, 30000);

afterAll(async () => {
  await fs
    .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(() => {});
  delete process.env.SOLOMON_WORKDIR;
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpDir, "sessions-"));
});

/** What a `kill -9` leaves behind: unfinalized tracks, no meta.json. */
async function killedSession(name: string, seconds = 3) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await writeWav(path.join(dir, "mic.wav"), tone(seconds, 0.3), { unfinalized: true });
  await writeWav(path.join(dir, "system.wav"), tone(seconds, 0.5), { unfinalized: true });
  return dir;
}

describe("recoverSessionMeta", () => {
  it("rebuilds meta from the track files, and repairs their headers", async () => {
    const dir = await killedSession("2026.07.29-1000", 4);

    const meta = await recover.recoverSessionMeta(dir);
    expect(meta).not.toBeNull();
    expect(meta!.tracks.map((t) => t.id)).toEqual(["mic", "system"]);
    expect(meta!.duration_seconds).toBe(4);
    expect(meta!.tracks[0].frames).toBe(4 * SAMPLE_RATE);
    // Peaks are measured, so a silent track is still detectable after recovery.
    expect(meta!.tracks[0].peak).toBeGreaterThan(0.2);
    expect(meta!.tracks[1].peak).toBeGreaterThan(0.4);
    expect(meta!.tracks.every((t) => !t.silent)).toBe(true);

    // Written to disk, so the session is now ordinary pending work.
    expect(await session.exists(path.join(dir, "meta.json"))).toBe(true);
    expect((await session.readMeta(dir))?.duration_seconds).toBe(4);
  });

  it("says the offsets are unknown rather than inventing them", async () => {
    const dir = await killedSession("2026.07.29-1100");
    const meta = await recover.recoverSessionMeta(dir);

    // The offsets only exist as each track's first-buffer wall clock, which died with
    // the process. Zero plus a warning beats a guess.
    expect(meta!.tracks.every((t) => t.offset_ms === 0)).toBe(true);
    expect(meta!.warnings).toContain(recover.RECOVERED_WARNING);
  });

  it("recovers a single surviving track", async () => {
    const dir = path.join(root, "2026.07.29-1200");
    await fs.mkdir(dir, { recursive: true });
    await writeWav(path.join(dir, "mic.wav"), tone(2), { unfinalized: true });

    const meta = await recover.recoverSessionMeta(dir);
    expect(meta!.tracks).toHaveLength(1);
    expect(meta!.tracks[0].id).toBe("mic");
  });

  it("flags a recovered track that holds only silence", async () => {
    const dir = path.join(root, "2026.07.29-1300");
    await fs.mkdir(dir, { recursive: true });
    await writeWav(path.join(dir, "mic.wav"), silence(2), { unfinalized: true });

    const meta = await recover.recoverSessionMeta(dir);
    expect(meta!.tracks[0].silent).toBe(true);
    expect(meta!.tracks[0].peak).toBe(0);
  });

  it("ignores a session that already has meta.json", async () => {
    const dir = await killedSession("2026.07.29-1400");
    await session.writeJsonAtomic(path.join(dir, "meta.json"), sessionMeta());
    expect(await recover.recoverSessionMeta(dir)).toBeNull();
  });

  it("returns null for a directory with nothing to recover", async () => {
    const dir = path.join(root, "2026.07.29-1500");
    await fs.mkdir(dir, { recursive: true });
    expect(await recover.recoverSessionMeta(dir)).toBeNull();

    // A header-only file (the recorder died before its first buffer) is not a recording.
    await writeWav(path.join(dir, "mic.wav"), new Int16Array(0), { unfinalized: true });
    expect(await recover.recoverSessionMeta(dir)).toBeNull();
  });

  it("derives a start time from the recording length", async () => {
    const dir = await killedSession("2026.07.29-1600", 5);
    const meta = await recover.recoverSessionMeta(dir);

    const started = Date.parse(meta!.started);
    const ended = Date.parse(meta!.ended);
    expect(ended - started).toBe(5000);
  });
});

describe("recoverOrphanedSessions", () => {
  it("recovers every orphan and leaves finished sessions alone", async () => {
    await killedSession("2026.07.29-1700");
    await killedSession("2026.07.29-1800");
    const finished = await killedSession("2026.07.29-1900");
    await session.writeJsonAtomic(path.join(finished, "meta.json"), sessionMeta());

    const recovered = await recover.recoverOrphanedSessions(root);
    expect(recovered.map((d) => path.basename(d))).toEqual(["2026.07.29-1700", "2026.07.29-1800"]);
  });

  it("makes an orphan discoverable as pending work", async () => {
    const { pendingSessions } = await import("./queue.js");
    const dir = await killedSession("2026.07.29-2000");

    // The whole point: invisible before recovery, ordinary pending work after.
    expect(await pendingSessions(root)).toEqual([]);
    await recover.recoverOrphanedSessions(root);
    expect(await pendingSessions(root)).toEqual([dir]);
  });

  it("survives a missing root and an unreadable session", async () => {
    expect(await recover.recoverOrphanedSessions(path.join(root, "nope"))).toEqual([]);

    const broken = path.join(root, "2026.07.29-2100");
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, "mic.wav"), Buffer.from("not audio"));
    const ok = await killedSession("2026.07.29-2200");

    const recovered = await recover.recoverOrphanedSessions(root);
    expect(recovered).toEqual([ok]);
  });
});
