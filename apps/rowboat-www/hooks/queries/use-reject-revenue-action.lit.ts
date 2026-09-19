import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Reject revenue action — Reject revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RejectRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("reject-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RejectRevenueActionLit = RejectRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "reject-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Reject revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-reject-revenue-action.ts",
    "hooks/queries/utils/mutate-reject-revenue-action.ts",
    "hooks/queries/utils/reject-revenue-action-keys.ts",
    "hooks/queries/utils/reject-revenue-action-keys.test.ts",
    "hooks/queries/use-reject-revenue-action.lit.ts",
  ],
});
