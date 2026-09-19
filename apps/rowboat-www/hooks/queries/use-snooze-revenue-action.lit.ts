import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Snooze revenue action — Snooze revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const SnoozeRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("snooze-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const SnoozeRevenueActionLit = SnoozeRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "snooze-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Snooze revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-snooze-revenue-action.ts",
    "hooks/queries/utils/mutate-snooze-revenue-action.ts",
    "hooks/queries/utils/snooze-revenue-action-keys.ts",
    "hooks/queries/utils/snooze-revenue-action-keys.test.ts",
    "hooks/queries/use-snooze-revenue-action.lit.ts",
  ],
});
