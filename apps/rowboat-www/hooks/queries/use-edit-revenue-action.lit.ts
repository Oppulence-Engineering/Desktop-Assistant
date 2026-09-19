import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Edit revenue action — Edit revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const EditRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("edit-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const EditRevenueActionLit = EditRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "edit-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Edit revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-edit-revenue-action.ts",
    "hooks/queries/utils/mutate-edit-revenue-action.ts",
    "hooks/queries/utils/edit-revenue-action-keys.ts",
    "hooks/queries/utils/edit-revenue-action-keys.test.ts",
    "hooks/queries/use-edit-revenue-action.lit.ts",
  ],
});
