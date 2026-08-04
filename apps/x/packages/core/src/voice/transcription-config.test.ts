import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { TranscriptionConfig } from "@x/shared/dist/transcription.js";
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
  await fs
    .rm(path.join(tmpDir, "config", "whisper-benchmarks.json"), { force: true })
    .catch(() => {});
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
    expect(cfg.dictation).toEqual({
      shortcut: "control-option",
      flowBarDock: "bottom",
      showFlowBar: false,
      transformsEnabled: false,
      transforms: [
        {
          id: "polish",
          name: "Polish",
          instruction:
            "Fix grammar and spelling, improve clarity and readability, add useful structure, and preserve the original meaning, tone, names, technical terms, and URLs.",
          shortcut: "option-1",
        },
        {
          id: "prompt-engineer",
          name: "Prompt Engineer",
          instruction:
            "Rewrite this as a precise, well-structured prompt for an AI assistant. Preserve every requirement, constraint, and concrete detail.",
          shortcut: "option-2",
        },
      ],
      language: "auto",
      commandModeEnabled: true,
      retryFailedAudio: true,
      historyRetention: "forever",
      contextEnabled: true,
      cleanupLevel: "medium",
      microphonePriority: [],
      styles: {
        email: "formal",
        workMessaging: "casual",
        personalMessaging: "casual",
        other: "formal",
      },
      dictionary: [],
      snippets: [],
    });
  });

  it("persists and re-reads a partial update (merging the whisper block)", async () => {
    await voice.setTranscriptionConfig({ voiceProvider: "deepgram" });
    await voice.setTranscriptionConfig({ whisper: { model: "small.en-q5_1" } });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.voiceProvider).toBe("deepgram"); // preserved across the second write
    expect(cfg?.whisper.model).toBe("small.en-q5_1");
    expect(cfg?.whisper.vad).toBe(true); // untouched fields keep their defaults
  });

  it("does not reset the other provider when a patch leaves fields undefined", async () => {
    // Mirrors the transcription:setConfig handler, which always materializes
    // voiceProvider/meetingProvider keys (undefined when the UI didn't change them).
    await voice.setTranscriptionConfig({
      voiceProvider: "deepgram",
      meetingProvider: "whisper-local",
    });
    // A model-only change arrives with both provider keys present-but-undefined.
    await voice.setTranscriptionConfig({
      voiceProvider: undefined,
      meetingProvider: undefined,
      whisper: { model: "small.en-q5_1" },
    });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.voiceProvider).toBe("deepgram"); // preserved, not re-defaulted
    expect(cfg?.meetingProvider).toBe("whisper-local"); // preserved, not reset to deepgram
    expect(cfg?.whisper.model).toBe("small.en-q5_1");
  });

  it("ignores unknown fields and tolerates partial files", async () => {
    const file = path.join(tmpDir, "config", "transcription.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ voiceProvider: "whisper-local", unknownField: 42 }));
    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.voiceProvider).toBe("whisper-local");
    expect(cfg?.whisper.model).toBe("base.en-q5_1"); // nested default filled in
  });

  it("persists local dictation context, styles, dictionary, and snippets", async () => {
    await voice.setTranscriptionConfig({
      dictation: {
        shortcut: "control-fn",
        flowBarDock: "right",
        showFlowBar: false,
        transformsEnabled: true,
        transforms: [
          {
            id: "polish",
            name: "Polish",
            instruction: "Fix grammar without changing URLs.",
            shortcut: "option-1",
          },
        ],
        language: "fr",
        commandModeEnabled: false,
        retryFailedAudio: false,
        historyRetention: "24-hours",
        contextEnabled: false,
        cleanupLevel: "high",
        microphonePriority: [
          { deviceId: "studio-mic", label: "Studio Microphone" },
          { deviceId: "built-in-mic", label: "MacBook Microphone" },
        ],
        styles: {
          email: "formal",
          workMessaging: "very-casual",
          personalMessaging: "casual",
          other: "excited",
        },
        dictionary: [{ term: "Oppulence", replacementFor: "opulence", starred: true }],
        snippets: [{ trigger: "my signature", expansion: "Best,\nDan" }],
      },
    });
    await voice.setTranscriptionConfig({ privacy: { localOnly: true } });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.dictation.contextEnabled).toBe(false);
    expect(cfg?.dictation.cleanupLevel).toBe("high");
    expect(cfg?.dictation.shortcut).toBe("control-fn");
    expect(cfg?.dictation.flowBarDock).toBe("right");
    expect(cfg?.dictation.showFlowBar).toBe(false);
    expect(cfg?.dictation.transformsEnabled).toBe(true);
    expect(cfg?.dictation.transforms).toEqual([
      {
        id: "polish",
        name: "Polish",
        instruction: "Fix grammar without changing URLs.",
        shortcut: "option-1",
      },
    ]);
    expect(cfg?.dictation.language).toBe("fr");
    expect(cfg?.dictation.retryFailedAudio).toBe(false);
    expect(cfg?.dictation.historyRetention).toBe("24-hours");
    expect(cfg?.dictation.commandModeEnabled).toBe(false);
    expect(cfg?.dictation.microphonePriority).toEqual([
      { deviceId: "studio-mic", label: "Studio Microphone" },
      { deviceId: "built-in-mic", label: "MacBook Microphone" },
    ]);
    expect(cfg?.dictation.styles.workMessaging).toBe("very-casual");
    expect(cfg?.dictation.dictionary[0]).toEqual({
      term: "Oppulence",
      replacementFor: "opulence",
      starred: true,
    });
    expect(cfg?.dictation.snippets[0]).toEqual({
      trigger: "my signature",
      expansion: "Best,\nDan",
    });
  });
});

describe("transcription privacy config", () => {
  it("defaults to local Whisper with cloud fallback allowed", () => {
    const parsed = TranscriptionConfig.parse({});
    expect(parsed.voiceProvider).toBe("whisper-local");
    expect(parsed.privacy).toEqual({
      localOnly: false,
      retainRawAudio: false,
      retainDiagnostics: false,
      redactTranscriptsInLogs: true,
    });
  });

  it("accepts local-only privacy mode", () => {
    const parsed = TranscriptionConfig.parse({
      privacy: { localOnly: true, retainRawAudio: false },
    });
    expect(parsed.privacy.localOnly).toBe(true);
    expect(parsed.privacy.retainRawAudio).toBe(false);
  });
});

describe("whisper benchmark profile I/O", () => {
  const validProfile = {
    deviceId: "darwin-arm64-test",
    model: "base.en-q5_1",
    accel: "coreml" as const,
    sampleSeconds: 10,
    durationMs: 1250,
    rtf: 8,
    measuredAt: "2026-06-12T12:00:00.000Z",
  };

  it("reads versioned envelopes and filters invalid profile entries", async () => {
    const file = path.join(tmpDir, "config", "whisper-benchmarks.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        $schemaVersion: 1,
        profiles: [validProfile, { ...validProfile, model: 42 }],
      }),
    );

    expect(await voice.readWhisperBenchmarks()).toEqual([validProfile]);
  });

  it("reads legacy bare arrays while filtering invalid profile entries", async () => {
    const file = path.join(tmpDir, "config", "whisper-benchmarks.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify([validProfile, { ...validProfile, rtf: "fast" }]));

    expect(await voice.readWhisperBenchmarks()).toEqual([validProfile]);
  });

  it("writes a versioned envelope and replaces prior measurements for the same device/model/accel", async () => {
    await voice.writeWhisperBenchmark(validProfile);
    await voice.writeWhisperBenchmark({
      ...validProfile,
      durationMs: 2000,
      rtf: 5,
      measuredAt: "2026-06-12T12:01:00.000Z",
    });

    const file = path.join(tmpDir, "config", "whisper-benchmarks.json");
    const persisted = JSON.parse(await fs.readFile(file, "utf8"));
    expect(persisted).toEqual({
      $schemaVersion: 1,
      profiles: [
        {
          ...validProfile,
          durationMs: 2000,
          rtf: 5,
          measuredAt: "2026-06-12T12:01:00.000Z",
        },
      ],
    });
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

  it("refuses to route to cloud when local-only privacy mode is unsupported", async () => {
    expect(
      voice.resolveVoiceProvider({
        userOverride: "deepgram",
        remoteDefault: "solomon",
        signedIn: true,
        localSupported: false,
        localOnly: true,
      }),
    ).toBe("none");
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

  it("falls back to local when cloud transport is unavailable", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      cloudAvailable: false,
    });
    expect(r).toEqual({ provider: "whisper-local", reason: "fallback" });
  });

  it("stays cloud when no transport is available but local is unsupported", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      localSupported: false,
      cloudAvailable: false,
    });
    expect(r.provider).toBe("deepgram");
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

  it("marks local-only meeting transcription unavailable when local is unsupported", async () => {
    const r = voice.resolveMeetingProvider({
      ...base,
      userOverride: "deepgram",
      remoteDefault: "solomon",
      localSupported: false,
      meetingMinutesRemaining: 0,
      localOnly: true,
    });
    expect(r).toEqual({ provider: "none", reason: "local_unavailable" });
  });
});

describe("meetings settings block", () => {
  it("defaults to auto capture, whisper, and delete-after-transcribe", async () => {
    const cfg = await voice.getTranscriptionConfig();
    expect(cfg.meetings).toEqual({
      captureEngine: "auto",
      micVoiceProcessing: false,
      // RFC 035: raw audio is not retained by default.
      keepAudio: "untilTranscribed",
      compressRetainedAudio: true,
      // whisper by default: parakeet is faster but needs a 600 MB download first.
      transcriptionEngine: "whisper",
      parakeetModel: "v3",
      // Detect rather than assume. The old behaviour was no language at all, which the
      // whisper runner turned into `-l en` — so a meeting held in any other language was
      // transcribed as English with nothing to say it had happened.
      language: "auto",
      transcribeOnStop: true,
      // Prompt, never silent: recording people is consent-shaped, and the notification
      // you can act on or ignore *is* the consent step. `always` has to be chosen.
      autoStart: "prompt",
      autoStartSilentOrganizers: [],
      preflightNotifications: true,
      // Bounded on purpose: "we hold the last five minutes" is checkable, and it caps
      // what standby could ever retain at roughly 20 MB across both tracks.
      standbySeconds: 300,
      // Off by default: arming a microphone is the one thing here that happens *to* a
      // user rather than because of them.
      standbyBeforeMeetings: false,
      // Off by default: a second transcription pass during a call is cheap on the
      // Neural Engine but not free, and not something to spend a battery on unasked.
      liveTranscript: false,
      liveCoachingFrequency: "off",
      // On by default: gated by a keyword pre-filter, runs once per meeting, and it is
      // the thing that turns a transcript into something you act on.
      extractCommitments: true,
      // Transcript text only joins the shared relationship model after opt-in.
      syncRelationshipEvidence: false,
    });
  });

  it("keeps the fast engine off until it is explicitly chosen", async () => {
    // Turning it on must not silently change anything else about capture.
    await voice.setTranscriptionConfig({ meetings: { transcriptionEngine: "parakeet" } });
    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.meetings.transcriptionEngine).toBe("parakeet");
    expect(cfg?.meetings.captureEngine).toBe("auto");
    expect(cfg?.meetings.keepAudio).toBe("untilTranscribed");
  });

  it("persists the meeting language and keeps it independent of dictation's", async () => {
    // The two are separate on purpose: the language you dictate notes in and the one
    // your meetings are held in are routinely different. A shared value would have made
    // the meeting setting change under the user whenever they touched dictation.
    await voice.setTranscriptionConfig({ meetings: { language: "fr" } });
    await voice.setTranscriptionConfig({ dictation: { language: "de" } as never });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.meetings.language).toBe("fr");
    expect(cfg?.meetings.captureEngine).toBe("auto");
  });

  it("merges a partial meetings patch without clobbering its siblings", async () => {
    await voice.setTranscriptionConfig({ meetings: { keepAudio: "always" } });
    await voice.setTranscriptionConfig({ meetings: { micVoiceProcessing: true } });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.meetings.keepAudio).toBe("always"); // preserved across the second write
    expect(cfg?.meetings.micVoiceProcessing).toBe(true);
    expect(cfg?.meetings.captureEngine).toBe("auto"); // untouched keeps its default
  });

  it("does not disturb the meetings block when an unrelated setting changes", async () => {
    await voice.setTranscriptionConfig({ meetings: { captureEngine: "renderer" } });
    await voice.setTranscriptionConfig({ whisper: { model: "small.en-q5_1" } });

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.meetings.captureEngine).toBe("renderer");
  });

  it("reads a config file written before the meetings block existed", async () => {
    // Forward-compat with installed users: an older transcription.json has no
    // `meetings` key at all, and must parse rather than throw.
    const legacy = { $schemaVersion: 1, voiceProvider: "whisper-local" };
    await fs.mkdir(path.join(tmpDir, "config"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "config", "transcription.json"),
      JSON.stringify(legacy),
      "utf8",
    );

    const cfg = await voice.readTranscriptionConfig();
    expect(cfg?.meetings.keepAudio).toBe("untilTranscribed");
  });
});
