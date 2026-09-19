import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Approve revenue action — Approve revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ApproveRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("approve-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ApproveRevenueActionLit = ApproveRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "approve-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Approve revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-approve-revenue-action.ts",
    "hooks/queries/utils/mutate-approve-revenue-action.ts",
    "hooks/queries/utils/approve-revenue-action-keys.ts",
    "hooks/queries/utils/approve-revenue-action-keys.test.ts",
    "hooks/queries/use-approve-revenue-action.lit.ts",
  ],
});
