import { describe, expect, it } from "vitest";
import { buildTranscriptionRouting, providerDataLocation } from "./routing.js";

const enrichment = {
  provider: "openai",
  model: "gpt-5",
  location: "cloud" as const,
  summariesEnabled: true,
  commitmentsEnabled: true,
  liveQuestionsEnabled: false,
};
const noSharing = {
  meetingTranscripts: false,
  meetingAttendance: false,
  emailMetadata: false,
  signatureEnrichment: false,
  modelContactExtraction: false,
};
const relationshipEvidence = {
  enabled: false,
  location: "cloud" as const,
  destination: "Oppulence relationship state",
  sharing: noSharing,
};

describe("buildTranscriptionRouting", () => {
  it("describes an explicitly selected cloud route without treating it as a violation", () => {
    const result = buildTranscriptionRouting({
      localOnly: false,
      configuredVoiceProvider: "deepgram",
      effectiveVoiceProvider: "deepgram",
      configuredMeetingProvider: "deepgram",
      effectiveRendererMeetingProvider: "deepgram",
      captureEngine: "renderer",
      nativeTranscriptionEngine: "whisper",
      enrichment,
      relationshipEvidence,
    });

    expect(result.voice).toMatchObject({
      location: "cloud",
      audioLeavesDevice: true,
      cloudAllowedByUser: true,
    });
    expect(result.voiceMemo).toEqual(result.voice);
    expect(result.meeting).toMatchObject({
      location: "cloud",
      audioLeavesDevice: true,
      cloudAllowedByUser: true,
      captureEngine: "renderer",
    });
  });

  it("makes local-only a hard override even when cloud preferences are persisted", () => {
    const result = buildTranscriptionRouting({
      localOnly: true,
      configuredVoiceProvider: "deepgram",
      effectiveVoiceProvider: "whisper-local",
      configuredMeetingProvider: "deepgram",
      effectiveRendererMeetingProvider: "whisper-local",
      meetingProviderReason: "privacy",
      captureEngine: "renderer",
      nativeTranscriptionEngine: "whisper",
      enrichment,
      relationshipEvidence,
    });

    expect(result.voice).toMatchObject({
      configuredProvider: "deepgram",
      effectiveProvider: "whisper-local",
      audioLeavesDevice: false,
      cloudAllowedByUser: false,
    });
    expect(result.meeting).toMatchObject({
      effectiveProvider: "whisper-local",
      audioLeavesDevice: false,
      reason: "privacy",
    });
  });

  it("reports the native on-device route instead of the unused cloud preference", () => {
    const result = buildTranscriptionRouting({
      localOnly: false,
      configuredVoiceProvider: "whisper-local",
      effectiveVoiceProvider: "whisper-local",
      configuredMeetingProvider: "deepgram",
      effectiveRendererMeetingProvider: "deepgram",
      captureEngine: "native",
      nativeTranscriptionEngine: "parakeet",
      enrichment,
      relationshipEvidence,
    });

    expect(result.meeting).toMatchObject({
      configuredProvider: "deepgram",
      effectiveProvider: "whisper-local",
      engine: "parakeet",
      location: "device",
      audioLeavesDevice: false,
      cloudAllowedByUser: false,
      reason: "native_capture_overrides_cloud_preference",
    });
  });

  it("separates local audio transcription from cloud transcript enrichment", () => {
    const result = buildTranscriptionRouting({
      localOnly: false,
      configuredVoiceProvider: "whisper-local",
      effectiveVoiceProvider: "whisper-local",
      configuredMeetingProvider: "whisper-local",
      effectiveRendererMeetingProvider: "whisper-local",
      captureEngine: "native",
      nativeTranscriptionEngine: "whisper",
      enrichment,
      // Expressed through the flag that actually turns sharing on; `enabled`
      // is derived and no longer settable by the caller.
      relationshipEvidence: {
        ...relationshipEvidence,
        sharing: { ...noSharing, meetingTranscripts: true },
      },
    });

    expect(result.meeting.audioLeavesDevice).toBe(false);
    expect(result.enrichment.transcriptTextMayLeaveDevice).toBe(true);
    expect(result.relationshipEvidence.transcriptTextMayLeaveDevice).toBe(true);
  });
});

describe("providerDataLocation", () => {
  it("recognizes loopback Ollama and OpenAI-compatible endpoints as on-device", () => {
    expect(providerDataLocation({ flavor: "ollama" })).toBe("device");
    expect(
      providerDataLocation({
        flavor: "openai-compatible",
        baseURL: "http://127.0.0.1:1234/v1",
      }),
    ).toBe("device");
    expect(
      providerDataLocation({
        flavor: "openai-compatible",
        baseURL: "http://[::1]:1234/v1",
      }),
    ).toBe("device");
  });

  it("does not describe remote or malformed compatible endpoints as local", () => {
    expect(
      providerDataLocation({
        flavor: "openai-compatible",
        baseURL: "https://models.example.com/v1",
      }),
    ).toBe("cloud");
    expect(providerDataLocation({ flavor: "openai-compatible", baseURL: "not a url" })).toBe(
      "unknown",
    );
  });
});

describe("relationship evidence receipt", () => {
  const base = {
    localOnly: false,
    configuredVoiceProvider: "deepgram" as const,
    effectiveVoiceProvider: "deepgram" as const,
    configuredMeetingProvider: "deepgram" as const,
    effectiveRendererMeetingProvider: "deepgram" as const,
    meetingProviderReason: null,
    captureEngine: "native" as const,
    nativeTranscriptionEngine: "whisper" as const,
    enrichment,
  };

  it("carries each consent flag through to the receipt", () => {
    // The receipt used to read a single deprecated flag that no UI wrote, so a
    // user sharing email metadata was told their data stayed local. Each switch
    // has to be independently visible or the receipt can describe the wrong one.
    const result = buildTranscriptionRouting({
      ...base,
      relationshipEvidence: {
        ...relationshipEvidence,
        enabled: true,
        sharing: { ...noSharing, emailMetadata: true },
      },
    });
    expect(result.relationshipEvidence.sharing).toEqual({
      ...noSharing,
      emailMetadata: true,
    });
  });

  it("reports transcripts as not shared when only email metadata is on", () => {
    // The exact false statement the old receipt made.
    const result = buildTranscriptionRouting({
      ...base,
      relationshipEvidence: {
        ...relationshipEvidence,
        enabled: true,
        sharing: { ...noSharing, emailMetadata: true },
      },
    });
    expect(result.relationshipEvidence.sharing.meetingTranscripts).toBe(false);
    expect(result.relationshipEvidence.enabled).toBe(true);
  });

  it("ignores a caller that claims enabled while sharing nothing", () => {
    // The receipt's original failure was `enabled` and the shared set
    // disagreeing. Deriving one from the other makes a lying receipt
    // unrepresentable rather than merely discouraged.
    const result = buildTranscriptionRouting({
      ...base,
      relationshipEvidence: { ...relationshipEvidence, enabled: true, sharing: noSharing },
    });
    expect(result.relationshipEvidence.enabled).toBe(false);
    expect(result.relationshipEvidence.transcriptTextMayLeaveDevice).toBe(false);
  });

  it("ignores a caller that claims disabled while sharing something", () => {
    const result = buildTranscriptionRouting({
      ...base,
      relationshipEvidence: {
        ...relationshipEvidence,
        enabled: false,
        sharing: { ...noSharing, emailMetadata: true },
      },
    });
    expect(result.relationshipEvidence.enabled).toBe(true);
  });

  it("says nothing leaves the device when every flag is off", () => {
    const result = buildTranscriptionRouting({ ...base, relationshipEvidence });
    expect(result.relationshipEvidence.enabled).toBe(false);
    expect(result.relationshipEvidence.transcriptTextMayLeaveDevice).toBe(false);
    expect(Object.values(result.relationshipEvidence.sharing)).not.toContain(true);
  });
});
