import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Dismiss revenue action — Dismiss revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const DismissRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("dismiss-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const DismissRevenueActionLit = DismissRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "dismiss-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Dismiss revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-dismiss-revenue-action.ts",
    "hooks/queries/utils/mutate-dismiss-revenue-action.ts",
    "hooks/queries/utils/dismiss-revenue-action-keys.ts",
    "hooks/queries/utils/dismiss-revenue-action-keys.test.ts",
    "hooks/queries/use-dismiss-revenue-action.lit.ts",
  ],
});
