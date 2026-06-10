import { describe, it, expect } from "vitest";
import { pcm16ToWav, deinterleaveStereoI16, concatI16, f32ToI16 } from "./wav.js";

describe("pcm16ToWav", () => {
  it("writes a correct 44-byte canonical WAV header", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768]);
    const wav = pcm16ToWav(samples.buffer, { sampleRate: 16000, channels: 1 });

    // Header (44 bytes) + data (5 samples × 2 bytes)
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");

    expect(wav.readUInt32LE(4)).toBe(36 + samples.length * 2); // RIFF chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(16000 * 2); // byte rate (mono, 16-bit)
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(samples.length * 2); // data size
  });

  it("reflects stereo channel count and byte rate in the header", () => {
    const wav = pcm16ToWav(new Int16Array(8).buffer, { sampleRate: 16000, channels: 2 });
    expect(wav.readUInt16LE(22)).toBe(2); // channels
    expect(wav.readUInt32LE(28)).toBe(16000 * 4); // byte rate (stereo, 16-bit)
    expect(wav.readUInt16LE(32)).toBe(4); // block align
  });

  it("round-trips the PCM payload after the header", () => {
    const samples = new Int16Array([100, -200, 300]);
    const wav = pcm16ToWav(samples.buffer);
    const payload = new Int16Array(wav.buffer, wav.byteOffset + 44, samples.length);
    expect(Array.from(payload)).toEqual(Array.from(samples));
  });
});

describe("deinterleaveStereoI16", () => {
  it("splits L/R interleaved samples into mic (ch0) and sys (ch1)", () => {
    const interleaved = new Int16Array([10, 20, 11, 21, 12, 22]); // (mic,sys) pairs
    const { mic, sys } = deinterleaveStereoI16(interleaved);
    expect(Array.from(mic)).toEqual([10, 11, 12]);
    expect(Array.from(sys)).toEqual([20, 21, 22]);
  });
});

describe("concatI16", () => {
  it("concatenates frames in order", () => {
    const out = concatI16([new Int16Array([1, 2]), new Int16Array([3]), new Int16Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("f32ToI16", () => {
  it("maps full-scale floats with asymmetric scaling and clamps overflow", () => {
    const i16 = f32ToI16(new Float32Array([0, 1, -1, 2, -2]));
    expect(i16[0]).toBe(0);
    expect(i16[1]).toBe(32767); // +1 → +0x7fff
    expect(i16[2]).toBe(-32768); // -1 → -0x8000
    expect(i16[3]).toBe(32767); // clamped, not wrapped
    expect(i16[4]).toBe(-32768);
  });
});
