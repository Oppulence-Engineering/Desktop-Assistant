import { describe, expect, it } from "vitest";
import type { MeetingSessionMeta, MeetingTranscript } from "@x/shared/dist/meetings.js";
import type { LedgerCommitment } from "../meetings/meetings.js";
import {
  confirmedCommitmentObservation,
  meetingTranscriptObservation,
} from "./meeting-evidence.js";

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
  it("preserves transcript provenance without creating inferred assertions", () => {
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
      externalId: "session-1",
      eventType: "meeting_transcribed",
    });
    expect(result.assertions).toBeUndefined();
    expect(result.normalizedFacts).toMatchObject({
      session_id: "session-1",
      transcript_segments: 1,
      transcription_engine: "whisper.cpp",
    });
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
      }),
    ]);

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
});
