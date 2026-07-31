import { describe, expect, it } from "vitest";
import type { ConversationExtractionProvenance } from "@x/shared/dist/relationships.js";
import { normalizeTranscript } from "./conversation-evidence.js";
import { validateConversationCandidates } from "./conversation-validator.js";

const provenance: ConversationExtractionProvenance = {
  extractorVersion: "test-v1",
  promptVersion: "test-prompt-v1",
  provider: "fixture",
  model: "fixture",
  routing: "deterministic",
  startedAt: "2026-07-31T12:00:00.000Z",
  completedAt: "2026-07-31T12:00:00.010Z",
  durationMs: 10,
};

function envelope() {
  return normalizeTranscript({
    provider: "oppulence",
    sourceRecordId: "validator-meeting",
    title: "Acme review",
    occurredAt: "2026-07-31T12:00:00.000Z",
    segments: [
      {
        speakerId: "avery",
        speakerLabel: "Avery",
        speakerConfidence: 0.92,
        startMs: 1_000,
        endMs: 3_000,
        text: "Security is still a blocker, but",
      },
      {
        speakerId: "avery",
        speakerLabel: "Avery",
        speakerConfidence: 0.92,
        startMs: 3_000,
        endMs: 5_000,
        text: "we will send the questionnaire by Friday.",
      },
    ],
  });
}

describe("conversation candidate validator", () => {
  it("derives exact multi-segment evidence, stable ids, state dimensions, and due dates", () => {
    const result = validateConversationCandidates({
      envelope: envelope(),
      provenance,
      rawCandidates: [
        {
          kind: "risk",
          normalizedValue: { kind: "risk", text: "Security remains blocked." },
          evidence: [{ exactQuote: "Security is still a blocker" }],
          speakerRef: "avery",
          confidence: 0.91,
          caveats: [],
        },
        {
          kind: "commitment",
          normalizedValue: {
            kind: "commitment",
            action: "Send the security questionnaire.",
            ownerSpeakerId: "avery",
            acceptance: "explicit",
            duePhrase: "Friday",
          },
          evidence: [
            {
              exactQuote:
                "Security is still a blocker, but we will send the questionnaire by Friday.",
              speakerId: "avery",
            },
          ],
          speakerRef: "avery",
          confidence: 0.94,
          caveats: [],
        },
      ],
    });

    expect(result.rejectedCandidates).toEqual([]);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "risk", stateDimension: "risk" }),
        expect.objectContaining({
          kind: "commitment",
          stateDimension: "next_action",
          duePhrase: "Friday",
          dueAt: "2026-08-07T17:00:00.000Z",
          evidence: [
            expect.objectContaining({
              segmentIds: expect.arrayContaining([
                expect.stringContaining("segment:0"),
                expect.stringContaining("segment:1"),
              ]),
              startMs: 1_000,
              endMs: 5_000,
            }),
          ],
        }),
      ]),
    );
    expect(
      result.candidates.every((candidate) => candidate.candidateId.startsWith("candidate:")),
    ).toBe(true);
  });

  it("rejects fabricated evidence, unknown owners, model-resolved dates, and duplicates", () => {
    const valid = {
      kind: "commitment",
      normalizedValue: {
        kind: "commitment",
        action: "Send the questionnaire.",
        ownerSpeakerId: "avery",
        acceptance: "explicit",
        duePhrase: "Friday",
      },
      evidence: [{ exactQuote: "we will send the questionnaire by Friday" }],
      confidence: 0.9,
      caveats: [],
    } as const;
    const result = validateConversationCandidates({
      envelope: envelope(),
      provenance,
      rawCandidates: [
        { ...valid, evidence: [{ exactQuote: "we already signed the contract" }] },
        {
          ...valid,
          normalizedValue: { ...valid.normalizedValue, ownerSpeakerId: "missing-speaker" },
        },
        {
          ...valid,
          normalizedValue: { ...valid.normalizedValue, dueAt: "2026-08-08T17:00:00.000Z" },
        },
        valid,
        valid,
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.rejectedCandidates.map((item) => item.reason)).toEqual([
      "quote_missing",
      "owner_missing",
      "date_invalid",
      "duplicate",
    ]);
  });
});
