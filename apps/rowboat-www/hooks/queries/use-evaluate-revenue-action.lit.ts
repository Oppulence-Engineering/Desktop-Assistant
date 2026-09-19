import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Evaluate revenue action — Evaluate revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const EvaluateRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("evaluate-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const EvaluateRevenueActionLit = EvaluateRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "evaluate-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Evaluate revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-evaluate-revenue-action.ts",
    "hooks/queries/utils/mutate-evaluate-revenue-action.ts",
    "hooks/queries/utils/evaluate-revenue-action-keys.ts",
    "hooks/queries/utils/evaluate-revenue-action-keys.test.ts",
    "hooks/queries/use-evaluate-revenue-action.lit.ts",
  ],
});
