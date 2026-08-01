import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../conversation-evidence.js";
import { StructuredConversationExtractor } from "../conversation-extractor.js";
import { loadConversationEvalCorpus } from "./fixtures.js";
import { assertConversationEvaluationGates, runConversationEvaluation } from "./runner.js";

const realEvaluationEnabled = process.env.CONVERSATION_EVAL_REAL === "1";

describe.skipIf(!realEvaluationEnabled)("real conversation semantic extractor evaluation", () => {
  it("passes the RFC 037 release gates", async () => {
    const extractor = new StructuredConversationExtractor();
    const corpus = loadConversationEvalCorpus();
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
  }, 120_000);
});
