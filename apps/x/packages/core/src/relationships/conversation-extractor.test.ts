import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "./conversation-evidence.js";
import {
  DeterministicConversationExtractor,
  HybridConversationExtractor,
  redactConversationModelInput,
  StructuredConversationExtractor,
} from "./conversation-extractor.js";

function request() {
  return {
    envelope: normalizeTranscript({
      provider: "upload" as const,
      sourceRecordId: "extractor-meeting",
      title: "Renewal call",
      occurredAt: "2026-07-31T14:00:00.000Z",
      segments: [
        {
          speakerId: "customer",
          speakerLabel: "Customer",
          speakerConfidence: 0.9,
          startMs: 0,
          endMs: 2_000,
          text: "We decided to renew for another year.",
        },
      ],
    }),
    extractorVersion: "conversation-semantic-v1",
    requestedClaimKinds: ["decision", "lifecycle"] as ("decision" | "lifecycle")[],
  };
}

describe("structured conversation extractor", () => {
  it("guards the prompt and validates injected structured output", async () => {
    const messages: string[] = [];
    const times = [new Date("2026-07-31T14:01:00.000Z"), new Date("2026-07-31T14:01:00.025Z")];
    const extractor = new StructuredConversationExtractor({
      now: () => times.shift()!,
      generate: async (next) => {
        messages.push(...next.map((message) => message.content));
        return {
          candidates: [
            {
              kind: "decision",
              normalizedValue: { kind: "decision", text: "Renew for another year." },
              evidence: [{ exactQuote: "We decided to renew for another year." }],
              speakerRef: "customer",
              confidence: 0.96,
              caveats: [],
            },
            {
              kind: "lifecycle",
              normalizedValue: { kind: "lifecycle", lifecycle: "renewal" },
              evidence: [{ exactQuote: "We decided to renew for another year." }],
              speakerRef: "customer",
              confidence: 0.94,
              caveats: [],
            },
          ],
        };
      },
    });

    const result = await extractor.extract(request());
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual(["decision", "lifecycle"]);
    expect(result.provenance).toMatchObject({
      extractorVersion: "conversation-semantic-v1",
      promptVersion: "conversation-claims-v1",
      routing: "deterministic",
      durationMs: 25,
    });
    expect(messages[0]).toContain("untrusted evidence");
    expect(messages[0]).toContain("A request is not a commitment");
  });

  it("records invalid model output as a rejected candidate instead of throwing", async () => {
    const extractor = new StructuredConversationExtractor({
      generate: async () => ({ candidates: [{ kind: "decision", evidence: [] }] }),
    });
    const result = await extractor.extract(request());
    expect(result.candidates).toEqual([]);
    expect(result.rejectedCandidates).toEqual([
      expect.objectContaining({ reason: "schema_invalid" }),
    ]);
  });

  it("redacts cloud-bound sensitive text and restores exact quotes for validation", () => {
    const sensitive = request();
    sensitive.envelope.segments[0].text =
      "Email person@example.com and use api key: abc123 for account 4111 1111 1111 1111.";
    const outbound = redactConversationModelInput(sensitive);
    const serialized = JSON.stringify(outbound.request);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("4111 1111 1111 1111");
    expect(serialized).toContain("REDACTED_CREDENTIAL");
    expect(
      outbound.restore({
        candidates: [{ evidence: [{ exactQuote: outbound.request.envelope.segments[0].text }] }],
      }),
    ).toEqual({
      candidates: [{ evidence: [{ exactQuote: sensitive.envelope.segments[0].text }] }],
    });
  });

  it("falls back only when semantic extraction fails and labels every rule candidate", async () => {
    const semantic = {
      version: "broken-semantic",
      extract: async () => {
        throw new Error("model unavailable");
      },
    };
    const fallback = new DeterministicConversationExtractor(
      () => new Date("2026-07-31T14:01:00.000Z"),
    );
    const extractor = new HybridConversationExtractor(semantic, fallback);
    const result = await extractor.extract(request());

    expect(result.provenance).toMatchObject({
      extractorVersion: "conversation-deterministic-v1",
      routing: "deterministic",
    });
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decision",
          caveats: expect.arrayContaining(["deterministic fallback candidate requires review"]),
        }),
        expect.objectContaining({ kind: "lifecycle" }),
      ]),
    );
  });
});
