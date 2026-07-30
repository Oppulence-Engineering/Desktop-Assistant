import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sessionMeta, tone, trackMeta, writeWav } from "./factories.testkit.js";

/**
 * Retention is a privacy control, so the interesting cases are the ones where audio
 * must *survive*: `untilTranscribed` keeps the recording when transcription failed,
 * because deleting it there would throw the meeting away with nothing to show for it.
 */

let tmpDir: string;
let root: string;
let retention: typeof import("./retention.js");
let session: typeof import("./session.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-retention-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  retention = await import("./retention.js");
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

async function twoTrackSession() {
  const dir = path.join(root, "2026.07.29-1000");
  await fs.mkdir(dir, { recursive: true });
  await writeWav(path.join(dir, "mic.wav"), tone(1));
  await writeWav(path.join(dir, "system.wav"), tone(1));
  const meta = sessionMeta({
    tracks: [
      trackMeta({ id: "mic", speaker: "me", file: "mic.wav" }),
      trackMeta({ id: "system", speaker: "them", file: "system.wav" }),
    ],
  });
  await session.writeJsonAtomic(path.join(dir, "meta.json"), meta);
  return { dir, meta };
}

describe("applyRetention", () => {
  it("keeps audio forever in `always` mode", async () => {
    const { dir, meta } = await twoTrackSession();
    expect(await retention.applyRetention({ dir, meta, mode: "always", transcribed: true })).toBe(
      false,
    );
    expect(await retention.hasAudio(dir, meta)).toBe(true);
  });

  it("deletes every track once a transcript exists", async () => {
    const { dir, meta } = await twoTrackSession();
    expect(
      await retention.applyRetention({ dir, meta, mode: "untilTranscribed", transcribed: true }),
    ).toBe(true);

    expect(await session.exists(path.join(dir, "mic.wav"))).toBe(false);
    expect(await session.exists(path.join(dir, "system.wav"))).toBe(false);
    expect(await retention.hasAudio(dir, meta)).toBe(false);
  });

  it("keeps audio when transcription failed, so a retry is still possible", async () => {
    const { dir, meta } = await twoTrackSession();
    expect(
      await retention.applyRetention({ dir, meta, mode: "untilTranscribed", transcribed: false }),
    ).toBe(false);
    expect(await retention.hasAudio(dir, meta)).toBe(true);
  });

  it("deletes even without a transcript in `never` mode", async () => {
    const { dir, meta } = await twoTrackSession();
    expect(await retention.applyRetention({ dir, meta, mode: "never", transcribed: false })).toBe(
      true,
    );
    expect(await retention.hasAudio(dir, meta)).toBe(false);
  });

  it("records the deletion in meta so the UI can explain the missing audio", async () => {
    const { dir, meta } = await twoTrackSession();
    await retention.applyRetention({ dir, meta, mode: "untilTranscribed", transcribed: true });

    const updated = await session.readMeta(dir);
    expect(updated?.audio_deleted_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(updated!.audio_deleted_at!))).toBe(false);
  });

  it("is a no-op once audio is already deleted", async () => {
    const { dir, meta } = await twoTrackSession();
    await retention.applyRetention({ dir, meta, mode: "untilTranscribed", transcribed: true });
    const after = (await session.readMeta(dir))!;

    expect(
      await retention.applyRetention({
        dir,
        meta: after,
        mode: "untilTranscribed",
        transcribed: true,
      }),
    ).toBe(false);
  });
});

describe("hasAudio", () => {
  it("is false when only some tracks survive", async () => {
    const { dir, meta } = await twoTrackSession();
    await fs.rm(path.join(dir, "system.wav"));
    expect(await retention.hasAudio(dir, meta)).toBe(false);
  });

  it("is false for a session with no tracks at all", async () => {
    const { dir } = await twoTrackSession();
    expect(await retention.hasAudio(dir, sessionMeta({ tracks: [] }))).toBe(false);
  });
});
