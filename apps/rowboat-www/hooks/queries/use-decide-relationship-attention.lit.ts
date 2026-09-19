import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Decide relationship attention — Decide relationship attention is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const DecideRelationshipAttentionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("decide-relationship-attention"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const DecideRelationshipAttentionLit = DecideRelationshipAttentionLitSchema.parse({
  kind: "mutation",
  name: "decide-relationship-attention",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Decide relationship attention is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-decide-relationship-attention.ts",
    "hooks/queries/utils/mutate-decide-relationship-attention.ts",
    "hooks/queries/utils/decide-relationship-attention-keys.ts",
    "hooks/queries/utils/decide-relationship-attention-keys.test.ts",
    "hooks/queries/use-decide-relationship-attention.lit.ts",
  ],
});
