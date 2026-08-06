import type {
  EffectiveTranscriptionRoute,
  TranscriptEnrichmentRoute,
  TranscriptionDataLocation,
  TranscriptionProvider,
  TranscriptionRouting,
} from "@x/shared/dist/transcription.js";
import type { MeetingResolvedEngine, MeetingTranscriptionEngine } from "@x/shared/dist/meetings.js";
import { isCloudProvider } from "@x/shared/dist/transcription.js";

/**
 * Data-routing truth for speech features.
 *
 * Provider selection, capability fallback, native capture, and the language-model
 * enrichment route used to be described independently by several renderer components.
 * This module collapses them into one pure result so settings, privacy copy, provenance,
 * and tests all answer the same question: what leaves the device if the user starts now?
 */

export interface BuildRoutingInput {
  localOnly: boolean;
  configuredVoiceProvider: TranscriptionProvider;
  effectiveVoiceProvider: TranscriptionProvider;
  configuredMeetingProvider: TranscriptionProvider;
  effectiveRendererMeetingProvider: TranscriptionProvider;
  meetingProviderReason?: string;
  captureEngine: MeetingResolvedEngine;
  nativeTranscriptionEngine: MeetingTranscriptionEngine;
  enrichment: {
    provider: string;
    model: string;
    location: TranscriptionDataLocation;
    summariesEnabled: boolean;
    commitmentsEnabled: boolean;
    liveQuestionsEnabled: boolean;
  };
  relationshipEvidence: {
    enabled: boolean;
    location: TranscriptionDataLocation;
    destination: string;
    sharing: {
      meetingTranscripts: boolean;
      meetingAttendance: boolean;
      emailMetadata: boolean;
      signatureEnrichment: boolean;
      modelContactExtraction: boolean;
    };
  };
}

function providerLocation(provider: TranscriptionProvider): TranscriptionDataLocation {
  if (provider === "whisper-local") return "device";
  if (provider === "none") return "unavailable";
  return "cloud";
}

function route(args: {
  configuredProvider: TranscriptionProvider;
  effectiveProvider: TranscriptionProvider;
  localOnly: boolean;
  reason?: string;
  engine?: string;
}): EffectiveTranscriptionRoute {
  const location = providerLocation(args.effectiveProvider);
  return {
    configuredProvider: args.configuredProvider,
    effectiveProvider: args.effectiveProvider,
    location,
    audioLeavesDevice: location === "cloud",
    cloudAllowedByUser:
      !args.localOnly &&
      isCloudProvider(args.configuredProvider) &&
      isCloudProvider(args.effectiveProvider),
    ...(args.reason ? { reason: args.reason } : {}),
    ...(args.engine ? { engine: args.engine } : {}),
  };
}

export function buildTranscriptionRouting(input: BuildRoutingInput): TranscriptionRouting {
  const voice = route({
    configuredProvider: input.configuredVoiceProvider,
    effectiveProvider: input.effectiveVoiceProvider,
    localOnly: input.localOnly,
  });

  const meeting =
    input.captureEngine === "native"
      ? {
          ...route({
            configuredProvider: input.configuredMeetingProvider,
            // Native capture deliberately transcribes the files on-device. The engine
            // field distinguishes Parakeet from Whisper without pretending Parakeet is
            // a cloud/provider enum value.
            effectiveProvider: "whisper-local",
            localOnly: input.localOnly,
            reason:
              input.configuredMeetingProvider === "whisper-local"
                ? "native_on_device"
                : "native_capture_overrides_cloud_preference",
            engine: input.nativeTranscriptionEngine,
          }),
          captureEngine: "native" as const,
        }
      : {
          ...route({
            configuredProvider: input.configuredMeetingProvider,
            effectiveProvider: input.effectiveRendererMeetingProvider,
            localOnly: input.localOnly,
            reason: input.meetingProviderReason,
            engine:
              input.effectiveRendererMeetingProvider === "whisper-local"
                ? "whisper"
                : input.effectiveRendererMeetingProvider,
          }),
          captureEngine: "renderer" as const,
        };

  const enrichment: TranscriptEnrichmentRoute = {
    provider: input.enrichment.provider,
    model: input.enrichment.model,
    location: input.enrichment.location,
    // Unknown is treated conservatively: the UI says the text may leave rather than
    // making a local-only promise it cannot prove.
    transcriptTextMayLeaveDevice:
      input.enrichment.location === "cloud" || input.enrichment.location === "unknown",
    summariesEnabled: input.enrichment.summariesEnabled,
    commitmentsEnabled: input.enrichment.commitmentsEnabled,
    liveQuestionsEnabled: input.enrichment.liveQuestionsEnabled,
  };

  const relationshipEvidenceEnabled = Object.values(input.relationshipEvidence.sharing).some(
    Boolean,
  );

  return {
    localOnly: input.localOnly,
    voice,
    // Voice memos use the exact same capture/transcription service as push-to-talk.
    voiceMemo: { ...voice },
    meeting,
    enrichment,
    relationshipEvidence: {
      // Derived, never taken from the caller. "Enabled" and "what is shared"
      // are the same fact, and the receipt's original bug was exactly these two
      // disagreeing: `enabled` read a deprecated flag no UI wrote, so it said
      // off while email metadata shipped. Computing it here makes that
      // inconsistency unrepresentable rather than merely tested for.
      enabled: relationshipEvidenceEnabled,
      location: input.relationshipEvidence.location,
      transcriptTextMayLeaveDevice:
        relationshipEvidenceEnabled &&
        (input.relationshipEvidence.location === "cloud" ||
          input.relationshipEvidence.location === "unknown"),
      destination: input.relationshipEvidence.destination,
      sharing: input.relationshipEvidence.sharing,
    },
  };
}

/** Only loopback endpoints are safe to describe as on-device. */
export function providerDataLocation(args: {
  flavor: string;
  baseURL?: string;
}): TranscriptionDataLocation {
  const baseURL = args.baseURL?.trim();
  if (args.flavor === "ollama" && !baseURL) return "device";
  if (args.flavor !== "ollama" && args.flavor !== "openai-compatible") return "cloud";
  if (!baseURL) return args.flavor === "ollama" ? "device" : "unknown";

  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
      ? "device"
      : "cloud";
  } catch {
    return "unknown";
  }
}
