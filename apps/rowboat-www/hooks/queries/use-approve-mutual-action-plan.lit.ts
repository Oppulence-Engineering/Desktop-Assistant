import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Approve mutual action plan — Approve mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ApproveMutualActionPlanLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("approve-mutual-action-plan"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ApproveMutualActionPlanLit = ApproveMutualActionPlanLitSchema.parse({
  kind: "mutation",
  name: "approve-mutual-action-plan",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Approve mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-approve-mutual-action-plan.ts",
    "hooks/queries/utils/mutate-approve-mutual-action-plan.ts",
    "hooks/queries/utils/approve-mutual-action-plan-keys.ts",
    "hooks/queries/utils/approve-mutual-action-plan-keys.test.ts",
    "hooks/queries/use-approve-mutual-action-plan.lit.ts",
  ],
});
