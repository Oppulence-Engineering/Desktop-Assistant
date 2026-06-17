import { describe, expect, it } from "vitest";
import {
  buildDiarizationProvenance,
  meetingDiarizationState,
  provenanceNoteHeader,
  provenanceToFrontmatter,
} from "./provenance.js";

describe("buildDiarizationProvenance", () => {
  it("records local beta diarization (audio stays on device, meeting-scoped identity)", () => {
    const p = buildDiarizationProvenance({
      transcriptionProvider: "whisper-local",
      transcriptionModel: "base.en-q5_1",
      diarizationMode: "beta",
      diarizationModel: "speaker-embedding-v1",
    });
    expect(p).toEqual({
      transcription_provider: "whisper.cpp",
      transcription_model: "base.en-q5_1",
      diarization_provider: "local",
      diarization_model: "speaker-embedding-v1",
      diarization_mode: "beta",
      audio_uploaded: false,
      speaker_identity_persistence: "meeting_only",
    });
  });

  it("records cloud diarization for a Deepgram meeting", () => {
    const p = buildDiarizationProvenance({
      transcriptionProvider: "deepgram",
      transcriptionModel: "nova-3",
      diarizationMode: "default",
    });
    expect(p.diarization_provider).toBe("deepgram");
    expect(p.audio_uploaded).toBe(true);
    expect(p.speaker_identity_persistence).toBe("none");
    expect(p.diarization_model).toBeUndefined();
  });

  it("records local transcript with no diarization", () => {
    const p = buildDiarizationProvenance({
      transcriptionProvider: "whisper-local",
      transcriptionModel: "base.en-q5_1",
      diarizationMode: "off",
    });
    expect(p.diarization_provider).toBe("none");
    expect(p.audio_uploaded).toBe(false);
    expect(p.speaker_identity_persistence).toBe("none");
  });
});

describe("meetingDiarizationState", () => {
  it("maps provider + active flag to the three user states", () => {
    expect(meetingDiarizationState("deepgram", false)).toBe("cloud_meetings_default");
    expect(meetingDiarizationState("whisper-local", true)).toBe("local_diarization_beta");
    expect(meetingDiarizationState("whisper-local", false)).toBe("local_transcript_no_diarization");
  });
});

describe("provenance presentation", () => {
  it("flattens to frontmatter keys", () => {
    const fm = provenanceToFrontmatter(
      buildDiarizationProvenance({
        transcriptionProvider: "whisper-local",
        transcriptionModel: "base.en-q5_1",
        diarizationMode: "beta",
        diarizationModel: "speaker-embedding-v1",
      }),
    );
    expect(fm.transcription_provider).toBe("whisper.cpp");
    expect(fm.audio_uploaded).toBe(false);
    expect(fm.diarization_model).toBe("speaker-embedding-v1");
  });

  it("renders the two-line note header", () => {
    const local = provenanceNoteHeader(
      buildDiarizationProvenance({
        transcriptionProvider: "whisper-local",
        transcriptionModel: "base.en-q5_1",
        diarizationMode: "beta",
        diarizationModel: "speaker-embedding-v1",
      }),
    );
    expect(local).toBe("Transcription: Local\nDiarization: Local beta");
    const cloud = provenanceNoteHeader(
      buildDiarizationProvenance({
        transcriptionProvider: "deepgram",
        transcriptionModel: "nova-3",
        diarizationMode: "default",
      }),
    );
    expect(cloud).toBe("Transcription: Cloud\nDiarization: Cloud");
  });
});
