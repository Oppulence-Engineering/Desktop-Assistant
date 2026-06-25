import {
  type DiarizationMode,
  type DiarizationProvenance,
  type MeetingDiarizationState,
  type TranscriptionProvider,
} from "@x/shared/dist/diarization.js";

/**
 * Diarization provenance (RFC 017 §"Provenance"): the trust-surface record that
 * states which transcription/diarization provider produced a meeting note and
 * whether it was the local beta. Visible in the same surface as RFC 014.
 */

export interface ProvenanceInput {
  /** Resolved transcription provider for the session. */
  transcriptionProvider: TranscriptionProvider;
  /** Transcription model id (e.g. "base.en-q5_1" locally, "nova-3" for Deepgram). */
  transcriptionModel: string;
  /** Diarization mode actually used (off when no/failed diarization). */
  diarizationMode: DiarizationMode;
  /** Speaker-embedding model id when local diarization ran. */
  diarizationModel?: string;
}

/** Map a transcription provider to the provenance `transcription_provider` value. */
function transcriptionProviderLabel(p: TranscriptionProvider): string {
  return p === "whisper-local" ? "whisper.cpp" : p;
}

/** Build the provenance record for a meeting note. */
export function buildDiarizationProvenance(input: ProvenanceInput): DiarizationProvenance {
  const local = input.transcriptionProvider === "whisper-local";
  const diarized = input.diarizationMode !== "off";

  const diarizationProvider: DiarizationProvenance["diarization_provider"] = !diarized
    ? "none"
    : local
      ? "local"
      : "deepgram";

  return {
    transcription_provider: transcriptionProviderLabel(input.transcriptionProvider),
    transcription_model: input.transcriptionModel,
    diarization_provider: diarizationProvider,
    ...(diarized && diarizationProvider === "local" && input.diarizationModel
      ? { diarization_model: input.diarizationModel }
      : {}),
    diarization_mode: input.diarizationMode,
    // Audio leaves the device only for cloud transcription.
    audio_uploaded: !local,
    // No cross-meeting voice identity in v1 (meeting-scoped only, and only when
    // local diarization ran).
    speaker_identity_persistence: diarizationProvider === "local" ? "meeting_only" : "none",
  };
}

/**
 * Derive the user-facing meeting state (RFC 017 §"User-facing behavior") from the
 * resolved provider + whether local diarization is active.
 */
export function meetingDiarizationState(
  provider: TranscriptionProvider,
  localDiarizationActive: boolean,
): MeetingDiarizationState {
  if (provider !== "whisper-local") return "cloud_meetings_default";
  return localDiarizationActive ? "local_diarization_beta" : "local_transcript_no_diarization";
}

/** Flatten provenance into note frontmatter keys (strings/booleans for YAML). */
export function provenanceToFrontmatter(
  p: DiarizationProvenance,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {
    transcription_provider: p.transcription_provider,
    transcription_model: p.transcription_model,
    diarization_provider: p.diarization_provider,
    diarization_mode: p.diarization_mode,
    audio_uploaded: p.audio_uploaded,
    speaker_identity_persistence: p.speaker_identity_persistence,
  };
  if (p.diarization_model) out.diarization_model = p.diarization_model;
  return out;
}

/** The two-line note header (RFC 017 §"User-facing behavior"). */
export function provenanceNoteHeader(p: DiarizationProvenance): string {
  const transcription = p.transcription_provider === "whisper.cpp" ? "Local" : "Cloud";
  let diarization: string;
  switch (p.diarization_provider) {
    case "local":
      diarization = p.diarization_mode === "beta" ? "Local beta" : "Local";
      break;
    case "deepgram":
      diarization = "Cloud";
      break;
    default:
      diarization = "None";
  }
  return `Transcription: ${transcription}\nDiarization: ${diarization}`;
}
