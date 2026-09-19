import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Append commitment transition — Append commitment transition is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const AppendCommitmentTransitionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("append-commitment-transition"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const AppendCommitmentTransitionLit = AppendCommitmentTransitionLitSchema.parse({
  kind: "mutation",
  name: "append-commitment-transition",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Append commitment transition is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-append-commitment-transition.ts",
    "hooks/queries/utils/mutate-append-commitment-transition.ts",
    "hooks/queries/utils/append-commitment-transition-keys.ts",
    "hooks/queries/utils/append-commitment-transition-keys.test.ts",
    "hooks/queries/use-append-commitment-transition.lit.ts",
  ],
});
