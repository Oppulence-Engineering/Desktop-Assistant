import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { transcribeSession } from "./transcribe.js";
import {
  fakeTranscriber,
  SAMPLE_RATE,
  nearSilence,
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
    // Two full chunks plus a little, all loud, so nothing is skipped as silence. A
    // small chunk size keeps the fixture cheap; the arithmetic under test is the same.
    const chunkSeconds = 2;
    const seconds = chunkSeconds * 2 + 1;
    await writeWav(path.join(dirPath, "mic.wav"), tone(seconds, 0.4, 8));

    const transcriber = fakeTranscriber(() => [{ start: 1, end: 2, text: "x" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        chunkSeconds,
        meta: sessionMeta({
          tracks: [trackMeta({ frames: seconds * SAMPLE_RATE })],
        }),
      }),
    );

    expect(transcriber.calls).toHaveLength(3);
    expect(transcriber.calls[0].samples).toBe(chunkSeconds * SAMPLE_RATE);
    expect(transcriber.calls[2].samples).toBe(1 * SAMPLE_RATE);
    // Each chunk's segment lands one second into that chunk.
    expect(transcript.segments.map((s) => s.start_ms)).toEqual([
      1000,
      (chunkSeconds + 1) * 1000,
      (chunkSeconds * 2 + 1) * 1000,
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
    const chunkSeconds = 2;
    const loud = tone(2, 0.4, 8);
    const quiet = silence(chunkSeconds);
    const samples = new Int16Array(quiet.length + loud.length);
    samples.set(quiet, 0);
    samples.set(loud, quiet.length);
    await writeWav(path.join(dirPath, "mic.wav"), samples);

    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "speech" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        chunkSeconds,
        meta: sessionMeta({ tracks: [trackMeta({ frames: samples.length })] }),
      }),
    );

    expect(transcriber.calls).toHaveLength(1);
    // Still shifted by the skipped chunk — a skipped window is not a shorter track.
    expect(transcript.segments[0].start_ms).toBe(chunkSeconds * 1000);
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

/**
 * The regression this exists for: no language reached the engine, and the whisper runner
 * turned that into `-l en`. Every meeting was transcribed as English whatever was spoken,
 * and nothing in the note said so.
 */
describe("session language", () => {
  const twoTracks = (over?: { micPeak?: number; systemPeak?: number }) =>
    sessionMeta({
      tracks: [
        trackMeta({
          file: "mic.wav",
          speaker: "me",
          frames: SAMPLE_RATE,
          peak: over?.micPeak ?? 9000,
        }),
        trackMeta({
          file: "system.wav",
          speaker: "them",
          frames: SAMPLE_RATE,
          peak: over?.systemPeak ?? 20000,
        }),
      ],
    });

  it("passes an explicit language through to every window", async () => {
    const dirPath = await session("lang-explicit");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await writeWav(path.join(dirPath, "system.wav"), tone(1));

    const transcriber = fakeTranscriber(
      () => [{ start: 0, end: 1, text: "bonjour" }],
      () => ({ language: "fr", multilingualModel: true }),
    );
    const transcript = await transcribeSession(
      args({ dir: dirPath, transcriber, meta: twoTracks(), lang: "fr" }),
    );

    expect(transcriber.calls.map((c) => c.lang)).toEqual(["fr", "fr"]);
    expect(transcript.language).toBe("fr");
    expect(transcript.language_detected).toBe(false);
  });

  it("detects once on the loudest track and reuses it for the other", async () => {
    const dirPath = await session("lang-auto");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await writeWav(path.join(dirPath, "system.wav"), tone(1));

    // Only the first call reports a language, as a real detection pass would.
    const transcriber = fakeTranscriber(
      () => [{ start: 0, end: 1, text: "hola" }],
      (call) => (call === 0 ? { language: "es", multilingualModel: true } : {}),
    );
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        // The system track carries more signal, so it is the one worth detecting on.
        meta: twoTracks({ micPeak: 3000, systemPeak: 25000 }),
        lang: "auto",
      }),
    );

    // First window asks the engine to detect; every window after it is told the answer,
    // so one quiet track cannot drag half the meeting into another language.
    expect(transcriber.calls.map((c) => c.lang)).toEqual(["auto", "es"]);
    expect(transcript.language).toBe("es");
    expect(transcript.language_detected).toBe(true);
  });

  it("treats a missing language as detection, never as English", async () => {
    const dirPath = await session("lang-absent");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

    const transcriber = fakeTranscriber(
      () => [{ start: 0, end: 1, text: "x" }],
      () => ({ language: "de", multilingualModel: true }),
    );
    await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: SAMPLE_RATE })] }),
        // No `lang` at all — the exact shape of the bug.
      }),
    );

    expect(transcriber.calls[0].lang).toBe("auto");
  });

  it("records the effective language when an English-only model ignores the request", async () => {
    const dirPath = await session("lang-mismatch");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

    // What whisper.cpp actually does with `-l fr` on a `.en` model: warns, transcribes
    // as English, and reports `en`.
    const transcriber = fakeTranscriber(
      () => [{ start: 0, end: 1, text: "the quick brown fox" }],
      () => ({ language: "en", multilingualModel: false }),
    );
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: SAMPLE_RATE })] }),
        lang: "fr",
      }),
    );

    // The transcript must not claim French when nothing French happened.
    expect(transcript.language).toBe("en");
    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("English-only");
  });

  it("says so in the log when detection reports nothing", async () => {
    const dirPath = await session("lang-undetected");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "something" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: SAMPLE_RATE })] }),
        lang: "auto",
      }),
    );

    expect(transcript.language).toBeUndefined();
    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("detection reported nothing");
  });
});

describe("non-speech filtering", () => {
  it("drops whisper's annotations for near-silence instead of attributing them to a speaker", async () => {
    const dirPath = await session("non-speech");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

    // What a real quiet track produced: whisper's guess at the noise.
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(() => [
          { start: 0, end: 1, text: " [Music]" },
          { start: 1, end: 2, text: "♪♪" },
          { start: 2, end: 3, text: " We agreed on Friday." },
        ]),
        meta: sessionMeta({ tracks: [trackMeta()] }),
      }),
    );

    expect(transcript.segments.map((s) => s.text)).toEqual(["We agreed on Friday."]);
  });
});

describe("compressed tracks", () => {
  it("decodes before transcribing and cleans the scratch file up", async () => {
    const dirPath = await session("compressed");
    // A "compressed" track: the codec here just copies, but the pipeline cannot tell.
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await fs.rename(path.join(dirPath, "mic.wav"), path.join(dirPath, "mic.m4a"));

    const decoded: string[] = [];
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(() => [{ start: 0, end: 1, text: "from compressed" }]),
        meta: sessionMeta({ tracks: [trackMeta({ file: "mic.m4a" })] }),
        codec: {
          async compress() {},
          async decode(input: string, out: string) {
            decoded.push(path.basename(input));
            await fs.copyFile(input, out);
          },
        },
      }),
    );

    expect(decoded).toEqual(["mic.m4a"]);
    expect(transcript.segments.map((s) => s.text)).toEqual(["from compressed"]);
    // The scratch decode must not be left behind doubling the session's disk use.
    expect(await fs.readdir(dirPath)).not.toContain("mic.decoded.wav");
  });

  it("fails the session with a clear reason when nothing can decode it", async () => {
    const dirPath = await session("compressed-nodecoder");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await fs.rename(path.join(dirPath, "mic.wav"), path.join(dirPath, "mic.m4a"));

    // Must fail, not return empty: an empty transcript would mark this done and let
    // retention delete the only copy of the meeting.
    await expect(
      transcribeSession(
        args({
          dir: dirPath,
          transcriber: fakeTranscriber(),
          meta: sessionMeta({ tracks: [trackMeta({ file: "mic.m4a" })] }),
        }),
      ),
    ).rejects.toThrow(/no track could be transcribed/);

    const log = await fs.readFile(path.join(dirPath, "transcribe.log"), "utf8");
    expect(log).toContain("no decoder is available");
  });
});

describe("silence gate units", () => {
  it("skips a quiet-but-nonzero window, not just a perfectly zero one", async () => {
    // The gate compares against `pcmStats.peak`, which is int16 (0…32767). Expressing
    // the threshold as 0…1 made this fire only on digital silence, so every window of
    // room tone was still sent to the model.
    const dirPath = await session("near-silence");
    await writeWav(path.join(dirPath, "mic.wav"), nearSilence(2));

    const transcriber = fakeTranscriber();
    await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: 2 * SAMPLE_RATE, peak: 0.002 })] }),
        chunkSeconds: 1,
      }),
    );

    expect(transcriber.calls).toHaveLength(0);
  });

  it("still transcribes quiet speech above the gate", async () => {
    const dirPath = await session("quiet-speech");
    // 0.02 full scale — quiet, but well above room tone.
    await writeWav(path.join(dirPath, "mic.wav"), tone(1, 0.02));

    const transcriber = fakeTranscriber(() => [{ start: 0, end: 1, text: "quiet but real" }]);
    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber,
        meta: sessionMeta({ tracks: [trackMeta({ frames: SAMPLE_RATE })] }),
      }),
    );

    expect(transcript.segments.map((s) => s.text)).toEqual(["quiet but real"]);
  });
});

describe("total failure", () => {
  it("throws rather than returning an empty transcript when no track could be read", async () => {
    // The dangerous case: an empty transcript looks like success, so the queue would
    // mark the session done, blank its note, and let retention delete the audio. A
    // missing whisper binary alone is enough to get here.
    const dirPath = await session("all-failed");
    // Neither track file exists.
    await expect(
      transcribeSession(
        args({
          dir: dirPath,
          transcriber: fakeTranscriber(),
          meta: sessionMeta({
            tracks: [
              trackMeta({ id: "mic", speaker: "me", file: "mic.wav" }),
              trackMeta({ id: "system", speaker: "them", file: "system.wav" }),
            ],
          }),
        }),
      ),
    ).rejects.toThrow(/no track could be transcribed \(2\/2\)/);
  });

  it("still succeeds when one track works", async () => {
    const dirPath = await session("one-failed");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));

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
    expect(transcript.segments).toHaveLength(1);
  });

  it("does not throw for a session whose tracks are all legitimately silent", async () => {
    // Silence is a successful transcription of nothing, not a failure.
    const dirPath = await session("all-silent");
    await writeWav(path.join(dirPath, "mic.wav"), silence(1));

    const transcript = await transcribeSession(
      args({
        dir: dirPath,
        transcriber: fakeTranscriber(),
        meta: sessionMeta({ tracks: [trackMeta({ silent: true })] }),
      }),
    );
    expect(transcript.segments).toEqual([]);
  });

  it("cleans up the scratch file when decoding fails", async () => {
    const dirPath = await session("decode-fails");
    await writeWav(path.join(dirPath, "mic.wav"), tone(1));
    await fs.rename(path.join(dirPath, "mic.wav"), path.join(dirPath, "mic.m4a"));

    await expect(
      transcribeSession(
        args({
          dir: dirPath,
          transcriber: fakeTranscriber(),
          meta: sessionMeta({ tracks: [trackMeta({ file: "mic.m4a" })] }),
          codec: {
            async compress() {},
            async decode(_input: string, out: string) {
              // Half-written, then fail — exactly what an interrupted decode leaves.
              await fs.writeFile(out, Buffer.alloc(1024));
              throw new Error("decoder died");
            },
          },
        }),
      ),
    ).rejects.toThrow(/no track could be transcribed/);

    expect(await fs.readdir(dirPath)).not.toContain("mic.decoded.wav");
  });
});
