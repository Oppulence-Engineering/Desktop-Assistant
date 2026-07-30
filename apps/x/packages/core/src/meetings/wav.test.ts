import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readPcmChunk, readWavInfo, recoverWavHeader, WavError } from "./wav.js";
import { SAMPLE_RATE, silence, tone, writeWav } from "./factories.testkit.js";

/**
 * The capture files. The interesting cases are all about the crash path: the sidecar
 * appends samples under a header whose size fields are only patched on clean stop, so
 * reading has to work when those fields are stale.
 */

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meetings-wav-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("readWavInfo", () => {
  it("reads a finalized header", async () => {
    const file = path.join(dir, "ok.wav");
    await writeWav(file, tone(2));

    const info = await readWavInfo(file);
    expect(info.sampleRate).toBe(SAMPLE_RATE);
    expect(info.channels).toBe(1);
    expect(info.frames).toBe(2 * SAMPLE_RATE);
    expect(info.dataOffset).toBe(44);
    expect(info.headerTruncated).toBe(false);
  });

  it("derives the length from the file when the writer never finalized", async () => {
    const file = path.join(dir, "killed.wav");
    await writeWav(file, tone(3), { unfinalized: true });

    const info = await readWavInfo(file);
    // The header says zero bytes of audio; every sample is still on disk.
    expect(info.frames).toBe(3 * SAMPLE_RATE);
    expect(info.headerTruncated).toBe(true);
  });

  it("clamps a declared size that overruns the file", async () => {
    const file = path.join(dir, "overrun.wav");
    await writeWav(file, tone(1));
    // Claim twice as much audio as was written — a torn final patch.
    const handle = await fs.open(file, "r+");
    const size = Buffer.alloc(4);
    size.writeUInt32LE(SAMPLE_RATE * 2 * 2, 0);
    await handle.write(size, 0, 4, 40);
    await handle.close();

    const info = await readWavInfo(file);
    expect(info.frames).toBe(SAMPLE_RATE);
    expect(info.headerTruncated).toBe(true);
  });

  it("skips chunks it does not care about", async () => {
    // A LIST chunk between fmt and data — legal, and present in files from other tools.
    const samples = tone(1);
    const list = Buffer.alloc(8 + 8);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(8, 4);
    list.write("INFOxxxx", 8, "ascii");

    const file = path.join(dir, "list.wav");
    await writeWav(file, samples);
    const original = await fs.readFile(file);
    await fs.writeFile(
      file,
      Buffer.concat([original.subarray(0, 36), list, original.subarray(36)]),
    );

    const info = await readWavInfo(file);
    expect(info.dataOffset).toBe(44 + list.length);
    expect(info.frames).toBe(samples.length);
  });

  it("rejects a non-WAV file", async () => {
    const file = path.join(dir, "nope.wav");
    await fs.writeFile(file, Buffer.from("this is not audio at all, really"));
    await expect(readWavInfo(file)).rejects.toBeInstanceOf(WavError);
  });
});

describe("recoverWavHeader", () => {
  it("patches an unfinalized header so the file reads as finalized", async () => {
    const file = path.join(dir, "recover.wav");
    await writeWav(file, tone(2), { unfinalized: true });

    expect(await recoverWavHeader(file)).toBe(true);
    const info = await readWavInfo(file);
    expect(info.headerTruncated).toBe(false);
    expect(info.frames).toBe(2 * SAMPLE_RATE);

    const raw = await fs.readFile(file);
    expect(raw.readUInt32LE(4)).toBe(36 + 2 * SAMPLE_RATE * 2);
    expect(raw.readUInt32LE(40)).toBe(2 * SAMPLE_RATE * 2);
  });

  it("is a no-op on a healthy file", async () => {
    const file = path.join(dir, "healthy.wav");
    await writeWav(file, tone(1));
    expect(await recoverWavHeader(file)).toBe(false);
  });

  it("is idempotent", async () => {
    const file = path.join(dir, "twice.wav");
    await writeWav(file, tone(1), { unfinalized: true });
    expect(await recoverWavHeader(file)).toBe(true);
    expect(await recoverWavHeader(file)).toBe(false);
  });
});

describe("readPcmChunk", () => {
  it("reads a window at the right offset", async () => {
    const samples = new Int16Array(1000);
    for (let i = 0; i < samples.length; i++) samples[i] = i;
    const file = path.join(dir, "ramp.wav");
    await writeWav(file, samples);
    const info = await readWavInfo(file);

    const chunk = await readPcmChunk(file, info, 100, 50);
    expect(chunk.length).toBe(50);
    expect(chunk[0]).toBe(100);
    expect(chunk[49]).toBe(149);
  });

  it("clamps a read past the end instead of returning garbage", async () => {
    const file = path.join(dir, "short.wav");
    await writeWav(file, silence(1));
    const info = await readWavInfo(file);

    const chunk = await readPcmChunk(file, info, info.frames - 10, 1000);
    expect(chunk.length).toBe(10);
    expect(await readPcmChunk(file, info, info.frames, 100)).toHaveLength(0);
  });

  it("does not alias pooled buffer memory across reads", async () => {
    // Node pools small Buffer allocations; a chunk that viewed pooled memory would be
    // silently rewritten by the next read.
    const samples = new Int16Array(400);
    for (let i = 0; i < samples.length; i++) samples[i] = i + 1;
    const file = path.join(dir, "alias.wav");
    await writeWav(file, samples);
    const info = await readWavInfo(file);

    const first = await readPcmChunk(file, info, 0, 100);
    const firstCopy = Int16Array.from(first);
    await readPcmChunk(file, info, 200, 100);
    expect(Array.from(first)).toEqual(Array.from(firstCopy));
  });
});
