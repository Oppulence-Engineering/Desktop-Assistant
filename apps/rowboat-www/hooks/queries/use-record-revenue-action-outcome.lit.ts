import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Record revenue action outcome — Record revenue action outcome is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RecordRevenueActionOutcomeLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("record-revenue-action-outcome"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RecordRevenueActionOutcomeLit = RecordRevenueActionOutcomeLitSchema.parse({
  kind: "mutation",
  name: "record-revenue-action-outcome",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Record revenue action outcome is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-record-revenue-action-outcome.ts",
    "hooks/queries/utils/mutate-record-revenue-action-outcome.ts",
    "hooks/queries/utils/record-revenue-action-outcome-keys.ts",
    "hooks/queries/utils/record-revenue-action-outcome-keys.test.ts",
    "hooks/queries/use-record-revenue-action-outcome.lit.ts",
  ],
});
