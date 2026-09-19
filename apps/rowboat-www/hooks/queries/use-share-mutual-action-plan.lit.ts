import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Share mutual action plan — Share mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ShareMutualActionPlanLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("share-mutual-action-plan"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ShareMutualActionPlanLit = ShareMutualActionPlanLitSchema.parse({
  kind: "mutation",
  name: "share-mutual-action-plan",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Share mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-share-mutual-action-plan.ts",
    "hooks/queries/utils/mutate-share-mutual-action-plan.ts",
    "hooks/queries/utils/share-mutual-action-plan-keys.ts",
    "hooks/queries/utils/share-mutual-action-plan-keys.test.ts",
    "hooks/queries/use-share-mutual-action-plan.lit.ts",
  ],
});
