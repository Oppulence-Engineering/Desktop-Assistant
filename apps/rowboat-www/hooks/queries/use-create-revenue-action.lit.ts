import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Create revenue action — Create revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const CreateRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("create-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const CreateRevenueActionLit = CreateRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "create-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Create revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-create-revenue-action.ts",
    "hooks/queries/utils/mutate-create-revenue-action.ts",
    "hooks/queries/utils/create-revenue-action-keys.ts",
    "hooks/queries/utils/create-revenue-action-keys.test.ts",
    "hooks/queries/use-create-revenue-action.lit.ts",
  ],
});
