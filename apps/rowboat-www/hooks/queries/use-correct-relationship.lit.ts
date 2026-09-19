import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Correct relationship — Correct relationship is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const CorrectRelationshipLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("correct-relationship"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const CorrectRelationshipLit = CorrectRelationshipLitSchema.parse({
  kind: "mutation",
  name: "correct-relationship",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Correct relationship is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-correct-relationship.ts",
    "hooks/queries/utils/mutate-correct-relationship.ts",
    "hooks/queries/utils/correct-relationship-keys.ts",
    "hooks/queries/utils/correct-relationship-keys.test.ts",
    "hooks/queries/use-correct-relationship.lit.ts",
  ],
});
