import type {
  ConversationExtractionProvenance,
  ConversationExtractionRequest,
  ConversationExtractionResult,
  ConversationNormalizedValue,
} from "@x/shared/dist/relationships.js";
import type { ConversationExtractor } from "../conversation-extractor.js";
import { duePhrase } from "../conversation-dates.js";
import { validateConversationCandidates } from "../conversation-validator.js";
import type { ConversationEvalCase, ConversationEvalExpected } from "./fixtures.js";

function normalizedValue(
  expected: ConversationEvalExpected,
  ownerSpeakerId: string,
): ConversationNormalizedValue {
  switch (expected.kind) {
    case "risk":
    case "objection":
    case "decision":
    case "milestone":
      return { kind: expected.kind, text: expected.displayValue };
    case "sentiment":
      return {
        kind: "sentiment",
        sentiment: expected.displayValue as "positive" | "neutral" | "negative" | "mixed",
      };
    case "lifecycle":
      return {
        kind: "lifecycle",
        lifecycle: expected.displayValue as
          | "prospecting"
          | "evaluation"
          | "contracting"
          | "onboarding"
          | "active_customer"
          | "renewal"
          | "churned"
          | "former_customer",
      };
    case "stakeholder": {
      const [displayName, role] = expected.displayValue.split(" · ");
      return {
        kind: "stakeholder",
        displayName,
        ...(role
          ? {
              role: role as
                | "contact"
                | "primary_contact"
                | "champion"
                | "decision_maker"
                | "blocker"
                | "executive_sponsor"
                | "owner"
                | "former_contact",
            }
          : {}),
      };
    }
    case "commitment":
      return {
        kind: "commitment",
        action: expected.displayValue,
        ownerSpeakerId,
        acceptance: "explicit",
        ...(duePhrase(expected.exactQuote) ? { duePhrase: duePhrase(expected.exactQuote) } : {}),
        dependencyCandidateIds: [],
      };
  }
}

/** Label-backed adapter used only to prove the evaluation/validation gate in CI. */
export class FixtureConversationExtractor implements ConversationExtractor {
  readonly version = "conversation-fixture-v1";
  private readonly fixtures: Map<string, ConversationEvalCase>;

  constructor(
    cases: ConversationEvalCase[],
    private readonly now = () => new Date(0),
  ) {
    this.fixtures = new Map(cases.map((testCase) => [testCase.id, testCase]));
  }

  async extract(request: ConversationExtractionRequest): Promise<ConversationExtractionResult> {
    const testCase = this.fixtures.get(request.envelope.sourceRecordId);
    if (!testCase) throw new Error("fixture extractor received an unknown source record");
    const started = this.now();
    const provenance: ConversationExtractionProvenance = {
      extractorVersion: this.version,
      promptVersion: "labeled-fixture-v1",
      provider: "fixture",
      model: "golden-labels",
      routing: "deterministic",
      startedAt: started.toISOString(),
      completedAt: started.toISOString(),
      durationMs: 0,
    };
    return validateConversationCandidates({
      envelope: request.envelope,
      requestedKinds: new Set(request.requestedClaimKinds),
      provenance,
      rawCandidates: testCase.expected.map((expected) => {
        const segment = request.envelope.segments.find((item) =>
          item.text.includes(expected.exactQuote),
        );
        const ownerSpeakerId = segment?.speakerId ?? request.envelope.segments[0].speakerId;
        return {
          kind: expected.kind,
          normalizedValue: normalizedValue(expected, ownerSpeakerId),
          evidence: [{ exactQuote: expected.exactQuote, speakerId: ownerSpeakerId }],
          speakerRef: ownerSpeakerId,
          confidence: 1,
          caveats: [],
        };
      }),
    });
  }
}
