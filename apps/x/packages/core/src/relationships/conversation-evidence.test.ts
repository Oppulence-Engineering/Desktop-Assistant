import { describe, expect, it } from "vitest";
import {
  canonicalTranscriptObservation,
  compileConversationEvidence,
  normalizeTranscript,
  resolveSpokenDueAt,
  type TranscriptProvider,
} from "./conversation-evidence.js";

const occurredAt = "2026-07-31T14:00:00.000Z";

function source(provider: TranscriptProvider = "oppulence") {
  return {
    provider,
    sourceRecordId: "meeting-42",
    title: "Acme renewal",
    occurredAt,
    participants: [{ displayName: "Avery", email: "avery@acme.example", role: "champion" }],
    segments: [
      {
        speakerId: "anonymous:remote-1",
        speakerLabel: "Speaker 1",
        speakerConfidence: 0.5,
        startMs: 1_000,
        endMs: 4_000,
        text: "We are concerned that security could delay the renewal.",
      },
      {
        speakerId: "local-user",
        speakerLabel: "You",
        speakerConfidence: 1,
        startMs: 5_000,
        endMs: 8_000,
        text: "I will send the security packet by Friday.",
      },
      {
        speakerId: "anonymous:remote-1",
        speakerLabel: "Speaker 1",
        speakerConfidence: 0.5,
        startMs: 9_000,
        endMs: 12_000,
        text: "We decided to move forward with the renewal.",
      },
    ],
    captureCaveats: ["remote speaker labels are meeting-scoped"],
  } as const;
}

describe("canonical conversation evidence", () => {
  it("normalizes every supported recorder into one deterministic envelope", () => {
    const providers: TranscriptProvider[] = [
      "oppulence",
      "upload",
      "fireflies",
      "granola",
      "zoom",
      "teams",
      "fathom",
      "crm",
    ];
    for (const provider of providers) {
      const first = normalizeTranscript(source(provider));
      const replay = normalizeTranscript(source(provider));
      expect(first.provider).toBe(provider);
      expect(first.fingerprint).toBe(replay.fingerprint);
      expect(first.segments[0]).toMatchObject({
        speakerId: "anonymous:remote-1",
        speakerConfidence: 0.5,
      });
      expect(first.governance.evidenceClip).toBe("not_retained");
    }
    expect(normalizeTranscript(source("zoom")).fingerprint).not.toBe(
      normalizeTranscript(source("teams")).fingerprint,
    );

    const unlabeled = {
      ...source("zoom"),
      segments: source("zoom").segments.map((segment, index) =>
        index === 0 ? { ...segment, speakerId: undefined } : segment,
      ),
    };
    const nextMeeting = { ...unlabeled, sourceRecordId: "meeting-43" };
    expect(normalizeTranscript(unlabeled).segments[0].speakerId).not.toBe(
      normalizeTranscript(nextMeeting).segments[0].speakerId,
    );
  });

  it("compiles exact quoted claims and all five independently approvable action channels", () => {
    const result = compileConversationEvidence(source());
    expect(result.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "risk",
          exactQuote: "We are concerned that security could delay the renewal.",
          startMs: 1_000,
          endMs: 4_000,
          speakerConfidence: 0.5,
        }),
        expect.objectContaining({
          kind: "commitment",
          exactQuote: "I will send the security packet by Friday.",
        }),
        expect.objectContaining({ kind: "decision" }),
        expect.objectContaining({ kind: "lifecycle", value: "renewal" }),
      ]),
    );
    expect(new Set(result.actions.map((action) => action.channel))).toEqual(
      new Set(["email", "slack", "crm", "task", "calendar"]),
    );
    for (const action of result.actions) {
      expect(action.evidenceClaimIds.length).toBeGreaterThan(0);
    }
    expect(result.actions.find((action) => action.channel === "calendar")?.dueAt).toBe(
      "2026-08-07T17:00:00.000Z",
    );
  });

  it("builds a deduplicated append-only observation with no persistent voiceprint", () => {
    const observation = canonicalTranscriptObservation({
      source: source("fathom"),
      identity: {
        displayName: "Acme",
        primaryEmail: "avery@acme.example",
        accountDomain: "acme.example",
      },
    });
    expect(observation).toMatchObject({
      source: "meeting",
      sourceAccountId: "fathom",
      externalId: "fathom:meeting-42",
      eventType: "conversation_evidence_compiled",
    });
    expect(observation.sourceVersion).toHaveLength(16);
    expect(observation.normalizedFacts.participant_resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "meeting", persistent_voiceprint: false }),
      ]),
    );
  });

  it("resolves spoken due dates deterministically relative to the conversation", () => {
    expect(resolveSpokenDueAt("tomorrow", occurredAt)).toBe("2026-08-01T17:00:00.000Z");
    expect(resolveSpokenDueAt("in 2 weeks", occurredAt)).toBe("2026-08-14T17:00:00.000Z");
    expect(resolveSpokenDueAt("2026-09-10", occurredAt)).toBe("2026-09-10T17:00:00.000Z");
  });

  it("bounds note-style transcripts and records every lossy normalization caveat", () => {
    const normalized = normalizeTranscript({
      ...source("upload"),
      segments: [
        {
          speakerLabel: "Imported notes",
          speakerConfidence: 0.25,
          startMs: 0,
          endMs: 0,
          text: `risk ${"context ".repeat(40_000)}`,
        },
      ],
    });
    expect(
      Math.max(...normalized.segments.map((segment) => segment.text.length)),
    ).toBeLessThanOrEqual(4_000);
    expect(
      normalized.segments.reduce((total, segment) => total + segment.text.length, 0),
    ).toBeLessThanOrEqual(250_000);
    expect(normalized.captureCaveats).toEqual(
      expect.arrayContaining([
        "long source segments were split into bounded evidence excerpts",
        "transcript was truncated at the canonical evidence size limit",
      ]),
    );
  });
});
