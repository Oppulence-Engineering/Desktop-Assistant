import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Execute revenue action — Execute revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ExecuteRevenueActionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("execute-revenue-action"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ExecuteRevenueActionLit = ExecuteRevenueActionLitSchema.parse({
  kind: "mutation",
  name: "execute-revenue-action",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Execute revenue action is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-execute-revenue-action.ts",
    "hooks/queries/utils/mutate-execute-revenue-action.ts",
    "hooks/queries/utils/execute-revenue-action-keys.ts",
    "hooks/queries/utils/execute-revenue-action-keys.test.ts",
    "hooks/queries/use-execute-revenue-action.lit.ts",
  ],
});
