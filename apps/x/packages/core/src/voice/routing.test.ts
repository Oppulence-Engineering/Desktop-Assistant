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
const relationshipEvidence = {
  enabled: false,
  location: "cloud" as const,
  destination: "Oppulence relationship state",
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
      relationshipEvidence: { ...relationshipEvidence, enabled: true },
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
