import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Resolve relationship contradiction — Resolve relationship contradiction is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ResolveRelationshipContradictionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("resolve-relationship-contradiction"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ResolveRelationshipContradictionLit = ResolveRelationshipContradictionLitSchema.parse({
  kind: "mutation",
  name: "resolve-relationship-contradiction",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Resolve relationship contradiction is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-resolve-relationship-contradiction.ts",
    "hooks/queries/utils/mutate-resolve-relationship-contradiction.ts",
    "hooks/queries/utils/resolve-relationship-contradiction-keys.ts",
    "hooks/queries/utils/resolve-relationship-contradiction-keys.test.ts",
    "hooks/queries/use-resolve-relationship-contradiction.lit.ts",
  ],
});
