import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CHUNK_SECONDS, transcribeSession } from "./transcribe.js";
import {
  fakeTranscriber,
  SAMPLE_RATE,
  sessionMeta,
  silence,
  tone,
  trackMeta,
  writeWav,
} from "./factories.testkit.js";

/**
 * Two tracks become one transcript. The load-bearing behaviour is the clock: segment
 * times come back relative to the chunk that produced them, and have to be shifted by
 * both the chunk's position in the track and the track's own start offset — get either
 * wrong and speakers appear to talk in the wrong order.
 */

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-transcribe-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function session(name: string): Promise<string> {
  const sessionDir = path.join(dir, name);
  await fs.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

const args = (over: Partial<Parameters<typeof transcribeSession>[0]>) =>
  ({
    engine: "whisper.cpp",
    model: "base.en-q5_1",
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    ...over,
  }) as Parameters<typeof transcribeSession>[0];

describe("transcribeSession", () => {
  it("tags each track with its own speaker and merges by time", async () => {
    const dirPath = await session("merge");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await writeWav(path.join(dirPath, "system.wav"), tone(1));

    // mic speaks at 2s, system at 1s — so the merged order must be system first.
    const transcriber = fakeTranscriber((call) =>
      call === 0 ? [{ start: 2, end: 3, text: "mine" }] : [{ start: 1, end: 2, text: "theirs" }],
    );

    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({
          tracks: [
            trackMeta({ id: "mic", speaker: "me", file: "mic.wav" }),
            trackMeta({ id: "system", speaker: "them", file: "system.wav" }),
          ],
        }),
      }),
    );

    expect(transcript.segments).toEqual([
      { speaker: "them", start_ms: 1000, end_ms: 2000, text: "theirs" },
      { speaker: "me", start_ms: 2000, end_ms: 3000, text: "mine" },
    ]);
    expect(transcript.engine).toBe("whisper.cpp");
    expect(transcript.created_at).toBe("2026-07-29T12:00:00.000Z");
  });

  it("shifts a track by its start offset so both share one clock", async () => {
    const dirPath = await session("offset");
    await writeWav(path.join(dirPath, "system.wav"), tone(1));

    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(() => [{ start: 0.5, end: 1, text: "late" }]),
        meta: sessionMeta({
          tracks: [
            trackMeta({ id: "system", speaker: "them", file: "system.wav", offset_ms: 250 }),
          ],
        }),
      }),
    );

    expect(transcript.segments[0].start_ms).toBe(750);
    expect(transcript.segments[0].end_ms).toBe(1250);
  });

  it("shifts by chunk position across a chunk boundary", async () => {
    const dirPath = await session("chunks");
    // Two full chunks plus a little, all loud, so nothing is skipped as silence.
    const seconds = CHUNK_SECONDS * 2 + 5;
    await writeWav(path.join(dirPath, "mic.wav"), tone(seconds, 0.4, 8));

    const transcriber = fakeTranscriber(() => [{ start: 1, end: 2, text: "x" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({
          tracks: [trackMeta({ frames: seconds * SAMPLE_RATE })],
        }),
      }),
    );

    expect(transcriber.calls).toHaveLength(3);
    expect(transcriber.calls[0].samples).toBe(CHUNK_SECONDS * SAMPLE_RATE);
    expect(transcriber.calls[2].samples).toBe(5 * SAMPLE_RATE);
    // Each chunk's segment lands one second into that chunk.
    expect(transcript.segments.map((s) => s.start_ms)).toEqual([
      1000,
      (CHUNK_SECONDS + 1) * 1000,
      (CHUNK_SECONDS * 2 + 1) * 1000,
    ]);
  });

  it("skips a track the sidecar flagged silent without calling the transcriber", async () => {
    const dirPath = await session("silent-track");
    await writeWav(path.join(dirPath, "mic.wav"), silence(2));

    const transcriber = fakeTranscriber();
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ silent: true, peak: 0 })] }),
      }),
    );

    expect(transcriber.calls).toHaveLength(0);
    expect(transcript.segments).toHaveLength(0);
    // The reason is recorded on the session, not just dropped.
    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("recorded silence");
  });

  it("skips silent windows so the model is not asked to transcribe nothing", async () => {
    const dirPath = await session("silent-window");
    // Quiet for the first chunk, loud for the second.
    const loud = tone(5, 0.4, 8);
    const quiet = silence(CHUNK_SECONDS);
    const samples = new Int16Array(quiet.length + loud.length);
    samples.set(quiet, 0);
    samples.set(loud, quiet.length);
    await writeWav(path.join(dirPath, "mic.wav"), samples);

    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "speech" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: samples.length })] }),
      }),
    );

    expect(transcriber.calls).toHaveLength(1);
    // Still shifted by the skipped chunk — a skipped window is not a shorter track.
    expect(transcript.segments[0].start_ms).toBe(CHUNK_SECONDS * 1000);
  });

  it("keeps one track's transcript when the other is unreadable", async () => {
    const dirPath = await session("half-broken");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    // system.wav is never written.

    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(() => [{ start: 0, end: 1, text: "mine" }]),
        meta: sessionMeta({
          tracks: [
            trackMeta({ id: "mic", speaker: "me", file: "mic.wav" }),
            trackMeta({ id: "system", speaker: "them", file: "system.wav" }),
          ],
        }),
      }),
    );

    expect(transcript.segments).toEqual([
      { speaker: "me", start_ms: 0, end_ms: 1000, text: "mine" },
    ]);
    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("skipping system.wav");
  });

  it("recovers an unfinalized track before reading it", async () => {
    const dirPath = await session("unfinalized");
    await writeWav(path.join(dirPath, "mic.wav"), tone(2), { unfinalized: true });

    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "survived" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: 2 * SAMPLE_RATE })] }),
      }),
    );

    expect(transcript.segments).toHaveLength(1);
    expect(transcriber.calls[0].samples).toBe(2 * SAMPLE_RATE);
    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("recovered an unfinalized WAV header");
  });

  it("drops blank segments and reports progress to 1", async () => {
    const dirPath = await session("blanks");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

    const fractions: number[] = [];
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(() => [
          { start: 0, end: 1, text: "   " },
          { start: 1, end: 2, text: " kept " },
        ]),
        meta: sessionMeta({ tracks: [trackMeta({ frames: SAMPLE_RATE })] }),
        onProgress: (f) => fractions.push(f),
      }),
    );

    expect(transcript.segments).toEqual([
      { speaker: "me", start_ms: 1000, end_ms: 2000, text: "kept" },
    ]);
    expect(fractions.at(-1)).toBe(1);
  });
});
