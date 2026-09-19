import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Decide relationship identity candidate — Decide relationship identity candidate is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const DecideRelationshipIdentityCandidateLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("decide-relationship-identity-candidate"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const DecideRelationshipIdentityCandidateLit =
  DecideRelationshipIdentityCandidateLitSchema.parse({
    kind: "mutation",
    name: "decide-relationship-identity-candidate",
    domain: "",
    owner: "hook",
    client: false,
    summary:
      "Decide relationship identity candidate is generated from the rowboat-www growth standard. Replace this summary in the lit.",
    schemas: [],
    files: [
      "hooks/queries/use-decide-relationship-identity-candidate.ts",
      "hooks/queries/utils/mutate-decide-relationship-identity-candidate.ts",
      "hooks/queries/utils/decide-relationship-identity-candidate-keys.ts",
      "hooks/queries/utils/decide-relationship-identity-candidate-keys.test.ts",
      "hooks/queries/use-decide-relationship-identity-candidate.lit.ts",
    ],
  });
