import { describe, expect, it } from "vitest";
import type { MeetingSessionMeta, MeetingTranscript } from "@x/shared/meetings";
import type { LedgerCommitment } from "../meetings/meetings.js";
import {
  commitmentStatusObservation,
  confirmedCommitmentObservation,
  meetingTranscriptObservation,
  meetingTranscriptObservationWithExtraction,
} from "./meeting-evidence.js";
import { DeterministicConversationExtractor } from "./conversation-extractor.js";

const meta: MeetingSessionMeta = {
  schema: 1,
  started: "2026-07-31T12:00:00.000Z",
  ended: "2026-07-31T12:30:00.000Z",
  duration_seconds: 1_800,
  audio: {
    sample_rate: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    container: "wav",
  },
  tracks: [
    {
      id: "mic",
      speaker: "me",
      file: "mic.wav",
      offset_ms: 0,
      frames: 28_800_000,
      duration_ms: 1_800_000,
      peak: 0.5,
      silent: false,
    },
  ],
  warnings: [],
  calendar_event: JSON.stringify({
    summary: "Acme check-in",
  }),
};

const transcript: MeetingTranscript = {
  schema: 1,
  engine: "whisper.cpp",
  model: "base.en",
  created_at: "2026-07-31T12:31:00.000Z",
  segments: [{ speaker: "me", start_ms: 0, end_ms: 2_000, text: "I will send the proposal." }],
};

const counterparty = {
  label: "Avery",
  email: "avery@acme.example",
  organization: "Acme",
  role: "VP Sales",
};

describe("meeting relationship evidence", () => {
  it("uses an explicit relationship selection as the authoritative destination", async () => {
    const result = await meetingTranscriptObservationWithExtraction({
      sessionId: "session-explicit-account",
      meta,
      transcript,
      counterparty: {
        label: "Acme",
        relationshipId: "2875f11c-76cb-49b7-8e9d-8d865da1aa83",
        accountDomain: "acme.example",
      },
      extractor: new DeterministicConversationExtractor(() => new Date("2026-07-31T12:31:00.000Z")),
    });

    expect(result).toMatchObject({
      relationshipId: "2875f11c-76cb-49b7-8e9d-8d865da1aa83",
      displayName: "Acme",
      accountDomain: "acme.example",
    });
    expect(result.assertions).toEqual([]);
    expect(result.normalizedFacts.action_pack).toEqual([]);
  });

  it("attaches validated hybrid candidates without publishing unreviewed assertions", async () => {
    const result = await meetingTranscriptObservationWithExtraction({
      sessionId: "session-shadow",
      meta,
      transcript,
      counterparty,
      extractor: new DeterministicConversationExtractor(() => new Date("2026-07-31T12:31:00.000Z")),
    });

    expect(result.assertions).toEqual([]);
    expect(result.normalizedFacts.action_pack).toEqual([]);
    expect(result.normalizedFacts.legacy_shadow_action_pack).toEqual(
      expect.arrayContaining([expect.objectContaining({ actionType: "meeting_recap" })]),
    );
    expect(result.normalizedFacts).toMatchObject({
      conversation_extraction: {
        schema_version: 2,
        candidate_count: 1,
        rejected_candidate_count: 0,
        provenance: expect.objectContaining({
          extractorVersion: "conversation-deterministic-v1",
        }),
      },
      conversation_claim_candidates: [
        expect.objectContaining({
          kind: "commitment",
          caveats: expect.arrayContaining(["deterministic fallback candidate requires review"]),
        }),
      ],
    });
  });

  it("compiles quote-backed claims, actions, speaker caveats, and governance", () => {
    const result = meetingTranscriptObservation({
      sessionId: "session-1",
      meta,
      transcript,
      counterparty,
    });

    expect(result).toMatchObject({
      displayName: "Acme",
      primaryEmail: "avery@acme.example",
      accountDomain: "acme.example",
      source: "meeting",
      externalId: "oppulence:session-1",
      eventType: "conversation_evidence_compiled",
    });
    expect(result.assertions).toEqual([
      expect.objectContaining({
        dimension: "next_action",
        sourceType: "ai_inference",
      }),
    ]);
    expect(result.normalizedFacts).toMatchObject({
      session_id: "session-1",
      transcript_segments: 1,
      transcription_engine: "whisper.cpp",
      governance_receipt: expect.objectContaining({
        region: "local_device",
        evidenceClip: "not_retained",
      }),
      conversation_claims: [
        expect.objectContaining({
          kind: "commitment",
          exactQuote: "I will send the proposal.",
          startMs: 0,
          endMs: 2_000,
          speakerConfidence: 1,
        }),
      ],
    });
    expect(result.normalizedFacts.action_pack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "email" }),
        expect.objectContaining({ channel: "slack" }),
        expect.objectContaining({ channel: "crm" }),
        expect.objectContaining({ channel: "task" }),
      ]),
    );
  });

  it("uses the resolved 1:1 calendar attendee only as a meeting-scoped speaker", () => {
    const result = meetingTranscriptObservation({
      sessionId: "session-2",
      meta,
      transcript: {
        ...transcript,
        segments: [
          {
            speaker: "them",
            start_ms: 1_000,
            end_ms: 3_000,
            text: "We are concerned about the renewal timing.",
          },
        ],
      },
      counterparty,
    });

    expect(result.normalizedFacts.conversation_claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "risk",
          exactQuote: "We are concerned about the renewal timing.",
          speakerLabel: "Avery",
          speakerConfidence: 0.9,
        }),
        expect.objectContaining({
          kind: "lifecycle",
          speakerLabel: "Avery",
          speakerConfidence: 0.9,
        }),
      ]),
    );
    expect(result.normalizedFacts.participant_resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Avery",
          scope: "meeting",
          persistent_voiceprint: false,
        }),
      ]),
    );
    expect(JSON.stringify(result)).toContain("resolved from the 1:1 calendar attendee");
  });

  it("projects only a user-confirmed promise by me into next action", () => {
    const base: LedgerCommitment = {
      id: "session-1:0-2000",
      owner: "me",
      text: "Send the proposal",
      status: "open",
      confirmed_at: "2026-07-31T12:35:00.000Z",
      session_id: "session-1",
      evidence: "I will send the proposal.",
      start_ms: 0,
      end_ms: 2_000,
      note_path: "/Users/alice/Relationships/Acme/private-meeting.md",
      due_phrase: "tomorrow",
    };
    const mine = confirmedCommitmentObservation({ commitment: base, counterparty });
    expect(JSON.stringify(mine)).not.toContain("/Users/alice");
    expect(JSON.stringify(mine)).not.toContain("note_path");
    expect(mine.assertions).toEqual([
      expect.objectContaining({
        dimension: "next_action",
        value: "Send the proposal",
        sourceType: "source_fact",
        confidence: 1,
        userConfirmed: true,
      }),
    ]);
    expect(mine.normalizedFacts.commitment_due_at).toBe("2026-08-01T17:00:00.000Z");

    const theirs = confirmedCommitmentObservation({
      commitment: { ...base, owner: "them" },
      counterparty,
    });
    expect(theirs.assertions).toEqual([]);
    expect(theirs.normalizedFacts).toMatchObject({
      commitment_direction: "promised_by_them",
      user_confirmed: true,
    });
  });

  it("publishes fulfillment as an idempotent commitment update", () => {
    const commitment: LedgerCommitment = {
      id: "session-1:0-2000",
      owner: "me",
      text: "Send the proposal",
      status: "done",
      confirmed_at: "2026-07-31T12:35:00.000Z",
      session_id: "session-1",
      evidence: "I will send the proposal.",
      start_ms: 0,
      end_ms: 2_000,
    };
    const result = commitmentStatusObservation({
      commitment,
      status: "done",
      counterparty,
      occurredAt: "2026-08-01T10:00:00.000Z",
    });
    expect(result).toMatchObject({
      externalId: "commitment-update:session-1:0-2000:fulfilled",
      eventType: "commitment_status_changed",
      normalizedFacts: {
        commitment_updates: [
          expect.objectContaining({ commitmentId: "session-1:0-2000", status: "fulfilled" }),
        ],
      },
    });
  });
});
