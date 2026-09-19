import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Retract relationship assertion — Retract relationship assertion is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RetractRelationshipAssertionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("retract-relationship-assertion"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RetractRelationshipAssertionLit = RetractRelationshipAssertionLitSchema.parse({
  kind: "mutation",
  name: "retract-relationship-assertion",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Retract relationship assertion is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-retract-relationship-assertion.ts",
    "hooks/queries/utils/mutate-retract-relationship-assertion.ts",
    "hooks/queries/utils/retract-relationship-assertion-keys.ts",
    "hooks/queries/utils/retract-relationship-assertion-keys.test.ts",
    "hooks/queries/use-retract-relationship-assertion.lit.ts",
  ],
});
