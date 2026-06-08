import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Tests for the transcription config I/O + the pure provider resolvers (RFC 009 §12).
 * Uses an isolated WorkDir so config round-trips don't touch the real home dir. The
 * (heavy) core module graph is imported once; each I/O test resets just the config file.
 */

let tmpDir: string;
let voice: typeof import("./voice.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-transcription-test-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  voice = await import("./voice.js");
}, 30000);

afterAll(async () => {
  // Importing voice.js kicks off async workspace/git init under the temp WorkDir,
  // which can race rmdir → ENOTEMPTY. Temp-dir cleanup is best-effort.
  await fs
    .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(() => {});
  delete process.env.SOLOMON_WORKDIR;
});

beforeEach(async () => {
  // Each config I/O test starts from a clean slate (no transcription.json).
  await fs.rm(path.join(tmpDir, "config", "transcription.json"), { force: true }).catch(() => {});
});

describe("transcription config I/O", () => {
  it("returns null when no config file exists", async () => {
    expect(await voice.readTranscriptionConfig()).toBeNull();
  });

  it("synthesizes tiering defaults for display when absent", async () => {
    const cfg = await voice.getTranscriptionConfig();
    expect(cfg.voiceProvider).toBe("whisper-local"); // voice defaults local
    expect(cfg.meetingProvider).toBe("deepgram"); // meetings default cloud
    expect(cfg.whisper.model).toBe("base.en-q5_1");
    expect(cfg.whisper.vad).toBe(true);
  });

  it("persists and re-reads a partial update (merging the whisper block)", async () => {
    await voice.setTranscriptionConfig({ voiceProvider: "deepgram" });
    await voice.setTranscriptionConfig({ whisper: { model: "small.en-q5_1" } });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.voiceProvider).toBe("deepgram"); // preserved across the second write
    expect(cfg?.whisper.model).toBe("small.en-q5_1");
    expect(cfg?.whisper.vad).toBe(true); // untouched fields keep their defaults
  });

  it("ignores unknown fields and tolerates partial files", async () => {
    const file = path.join(tmpDir, "config", "transcription.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ voiceProvider: "whisper-local", unknownField: 42 }));
    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.voiceProvider).toBe("whisper-local");
    expect(cfg?.whisper.model).toBe("base.en-q5_1"); // nested default filled in
  });
});

describe("resolveVoiceProvider", () => {
  it("defaults to local when supported and no override", async () => {
    expect(voice.resolveVoiceProvider({ signedIn: true, localSupported: true })).toBe(
      "whisper-local",
    );
  });

  it("honors a user override over the remote default", async () => {
    expect(
      voice.resolveVoiceProvider({
        userOverride: "deepgram",
        remoteDefault: "whisper-local",
        signedIn: false,
        localSupported: true,
      }),
    ).toBe("deepgram");
  });

  it("falls back to the proxy when signed in but local is unsupported", async () => {
    expect(voice.resolveVoiceProvider({ signedIn: true, localSupported: false })).toBe("solomon");
  });

  it("falls back to direct Deepgram when signed out and local is unsupported", async () => {
    expect(voice.resolveVoiceProvider({ signedIn: false, localSupported: false })).toBe("deepgram");
  });

  it("uses the remote default when no user override", async () => {
    expect(
      voice.resolveVoiceProvider({
        remoteDefault: "solomon",
        signedIn: true,
        localSupported: true,
      }),
    ).toBe("solomon");
  });
});

describe("resolveMeetingProvider", () => {
  const base = { signedIn: true, localSupported: true, hasOwnDeepgramKey: false } as const;

  it("defaults to cloud (deepgram)", async () => {
    expect(voice.resolveMeetingProvider({ ...base }).provider).toBe("deepgram");
  });

  it('switches to local with reason "quota" when free minutes are exhausted', async () => {
    const r = voice.resolveMeetingProvider({ ...base, meetingMinutesRemaining: 0 });
    expect(r).toEqual({ provider: "whisper-local", reason: "quota" });
  });

  it("does NOT apply the quota gate for BYOK users (direct, unmetered)", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      hasOwnDeepgramKey: true,
      meetingMinutesRemaining: 0,
    });
    expect(r.provider).toBe("deepgram");
  });

  it("keeps cloud when minutes remain", async () => {
    expect(voice.resolveMeetingProvider({ ...base, meetingMinutesRemaining: 30 }).provider).toBe(
      "deepgram",
    );
  });

  it("downgrades an explicit local choice to cloud when local is unsupported", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      userOverride: "whisper-local",
      localSupported: false,
    });
    expect(r).toEqual({ provider: "solomon", reason: "capability" });
  });

  it("cannot fall back to local on quota exhaustion if local is unsupported", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      localSupported: false,
      meetingMinutesRemaining: 0,
    });
    expect(r.provider).toBe("deepgram"); // stays cloud; surfaced upstream
  });
});
