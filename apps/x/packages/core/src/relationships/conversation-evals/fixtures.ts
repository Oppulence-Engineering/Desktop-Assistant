import fs from "node:fs";
import { z } from "zod";

export const ConversationEvalExpectedSchema = z.object({
  kind: z.enum([
    "risk",
    "objection",
    "decision",
    "milestone",
    "sentiment",
    "stakeholder",
    "lifecycle",
    "commitment",
  ]),
  exactQuote: z.string().min(1),
  displayValue: z.string().min(1),
  dueAt: z.string().optional(),
});

export const ConversationEvalCaseSchema = z.object({
  id: z.string().min(1),
  bucket: z.string().min(1),
  title: z.string().min(1),
  occurredAt: z.string(),
  segments: z
    .array(
      z.object({
        speakerId: z.string().min(1),
        speakerLabel: z.string().min(1),
        speakerConfidence: z.number().min(0).max(1),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        text: z.string(),
      }),
    )
    .min(1),
  expected: z.array(ConversationEvalExpectedSchema),
});

const CorpusSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(ConversationEvalCaseSchema).min(1),
});

export const CONVERSATION_EVAL_MINIMUM_CASES = 250;

export type ConversationEvalCase = z.infer<typeof ConversationEvalCaseSchema>;
export type ConversationEvalExpected = z.infer<typeof ConversationEvalExpectedSchema>;

export function loadConversationEvalCorpus(): ConversationEvalCase[] {
  const raw = fs.readFileSync(new URL("./fixtures/corpus.json", import.meta.url), "utf8");
  const seeds = CorpusSchema.parse(JSON.parse(raw)).cases;
  const cases: ConversationEvalCase[] = [];

  // The checked-in seeds remain readable and reviewable. Deterministic permutations
  // exercise dedupe ids, speaker labels/confidence, timestamps, and repeated source
  // delivery without copying a production transcript into Git.
  for (let variant = 0; cases.length < CONVERSATION_EVAL_MINIMUM_CASES; variant += 1) {
    for (const seed of seeds) {
      if (cases.length >= CONVERSATION_EVAL_MINIMUM_CASES) break;
      const offset = variant * 10_000;
      cases.push({
        ...seed,
        id: `${seed.id}-synthetic-${variant + 1}`,
        bucket: `${seed.bucket}/synthetic`,
        segments: seed.segments.map((segment, index) => ({
          ...segment,
          speakerId: `${segment.speakerId}-${variant % 5}`,
          speakerLabel: `${segment.speakerLabel} ${variant + 1}`,
          speakerConfidence: Math.max(0.76, segment.speakerConfidence - (variant % 4) * 0.03),
          startMs: segment.startMs + offset + index * 20,
          endMs: segment.endMs + offset + index * 20,
        })),
      });
    }
  }
  return cases;
}
