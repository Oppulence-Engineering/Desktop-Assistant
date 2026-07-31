import { describe, expect, it } from "vitest";
import type { ConversationEvalPrediction } from "./runner.js";
import { compileConversationEvidence } from "../conversation-evidence.js";
import { duePhrase, resolveSpokenDueAt } from "../conversation-dates.js";
import { loadConversationEvalCorpus } from "./fixtures.js";
import { CONVERSATION_EVAL_MINIMUM_CASES } from "./fixtures.js";
import { FixtureConversationExtractor } from "./fixture-extractor.js";
import { normalizeTranscript } from "../conversation-evidence.js";
import { conversationEvaluationSummary } from "./metrics.js";
import { assertConversationEvaluationGates, runConversationEvaluation } from "./runner.js";

const corpus = loadConversationEvalCorpus();

describe("conversation extraction evaluation", () => {
  it("ships the required synthetic corpus floor and validates it through the fixture adapter", async () => {
    expect(corpus.length).toBeGreaterThanOrEqual(CONVERSATION_EVAL_MINIMUM_CASES);
    const extractor = new FixtureConversationExtractor(corpus);
    const report = await runConversationEvaluation(corpus, async (testCase) => {
      const result = await extractor.extract({
        envelope: normalizeTranscript({
          provider: "upload",
          sourceRecordId: testCase.id,
          title: testCase.title,
          occurredAt: testCase.occurredAt,
          segments: testCase.segments,
        }),
        extractorVersion: extractor.version,
        requestedClaimKinds: [
          "risk",
          "objection",
          "decision",
          "milestone",
          "sentiment",
          "stakeholder",
          "lifecycle",
          "commitment",
        ],
      });
      return result.candidates.map((candidate) => ({
        kind: candidate.kind,
        exactQuote: candidate.evidence[0].exactQuote,
        displayValue: candidate.displayValue,
        ...(candidate.dueAt ? { dueAt: candidate.dueAt } : {}),
      }));
    });
    expect(() => assertConversationEvaluationGates(report)).not.toThrow();
    expect(conversationEvaluationSummary(report)).not.toHaveProperty("transcript");
  });

  it("measures the compatibility regex baseline and exposes its hard-negative gap", async () => {
    const report = await runConversationEvaluation(corpus, async (testCase) => {
      const compiled = compileConversationEvidence({
        provider: "upload",
        sourceRecordId: testCase.id,
        title: testCase.title,
        occurredAt: testCase.occurredAt,
        segments: testCase.segments,
      });
      return compiled.claims.map((claim) => ({
        kind: claim.kind,
        exactQuote: claim.exactQuote,
        displayValue: claim.value,
        ...(claim.kind === "commitment"
          ? {
              dueAt: resolveSpokenDueAt(duePhrase(claim.exactQuote), testCase.occurredAt),
            }
          : {}),
      }));
    });

    expect(report.cases).toBe(corpus.length);
    expect(report.unsupportedQuoteRate).toBe(0);
    expect(report.byKind.commitment?.falsePositive).toBeGreaterThan(0);
    expect(report.overall.precision).toBeLessThan(1);
  });

  it("enforces every RFC 037 per-kind, date, and evidence gate", async () => {
    const report = await runConversationEvaluation(corpus, async (testCase) =>
      testCase.expected.map((item) => ({ ...item }) as ConversationEvalPrediction),
    );
    expect(() => assertConversationEvaluationGates(report)).not.toThrow();

    await expect(async () => {
      const broken = await runConversationEvaluation(corpus, async () => []);
      assertConversationEvaluationGates(broken);
    }).rejects.toThrow("conversation evaluation failed");
  });
});
