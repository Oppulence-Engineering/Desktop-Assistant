import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Approve relationship recommendation — Approve relationship recommendation is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ApproveRelationshipRecommendationLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("approve-relationship-recommendation"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ApproveRelationshipRecommendationLit =
  ApproveRelationshipRecommendationLitSchema.parse({
    kind: "mutation",
    name: "approve-relationship-recommendation",
    domain: "",
    owner: "hook",
    client: false,
    summary:
      "Approve relationship recommendation is generated from the rowboat-www growth standard. Replace this summary in the lit.",
    schemas: [],
    files: [
      "hooks/queries/use-approve-relationship-recommendation.ts",
      "hooks/queries/utils/mutate-approve-relationship-recommendation.ts",
      "hooks/queries/utils/approve-relationship-recommendation-keys.ts",
      "hooks/queries/utils/approve-relationship-recommendation-keys.test.ts",
      "hooks/queries/use-approve-relationship-recommendation.lit.ts",
    ],
  });
