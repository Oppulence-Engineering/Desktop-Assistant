import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Reject relationship recommendation — Reject relationship recommendation is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RejectRelationshipRecommendationLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("reject-relationship-recommendation"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RejectRelationshipRecommendationLit = RejectRelationshipRecommendationLitSchema.parse({
  kind: "mutation",
  name: "reject-relationship-recommendation",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Reject relationship recommendation is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-reject-relationship-recommendation.ts",
    "hooks/queries/utils/mutate-reject-relationship-recommendation.ts",
    "hooks/queries/utils/reject-relationship-recommendation-keys.ts",
    "hooks/queries/utils/reject-relationship-recommendation-keys.test.ts",
    "hooks/queries/use-reject-relationship-recommendation.lit.ts",
  ],
});
