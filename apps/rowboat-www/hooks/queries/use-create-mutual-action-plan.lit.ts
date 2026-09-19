import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Create mutual action plan — Create mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const CreateMutualActionPlanLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("create-mutual-action-plan"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const CreateMutualActionPlanLit = CreateMutualActionPlanLitSchema.parse({
  kind: "mutation",
  name: "create-mutual-action-plan",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Create mutual action plan is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-create-mutual-action-plan.ts",
    "hooks/queries/utils/mutate-create-mutual-action-plan.ts",
    "hooks/queries/utils/create-mutual-action-plan-keys.ts",
    "hooks/queries/utils/create-mutual-action-plan-keys.test.ts",
    "hooks/queries/use-create-mutual-action-plan.lit.ts",
  ],
});
