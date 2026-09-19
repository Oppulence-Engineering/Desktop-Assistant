import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Correct conversation evidence — Correct conversation evidence is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const CorrectConversationEvidenceLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("correct-conversation-evidence"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const CorrectConversationEvidenceLit = CorrectConversationEvidenceLitSchema.parse({
  kind: "mutation",
  name: "correct-conversation-evidence",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Correct conversation evidence is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-correct-conversation-evidence.ts",
    "hooks/queries/utils/mutate-correct-conversation-evidence.ts",
    "hooks/queries/utils/correct-conversation-evidence-keys.ts",
    "hooks/queries/utils/correct-conversation-evidence-keys.test.ts",
    "hooks/queries/use-correct-conversation-evidence.lit.ts",
  ],
});
