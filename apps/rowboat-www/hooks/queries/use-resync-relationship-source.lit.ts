import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Resync relationship source — Resync relationship source is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ResyncRelationshipSourceLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("resync-relationship-source"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ResyncRelationshipSourceLit = ResyncRelationshipSourceLitSchema.parse({
  kind: "mutation",
  name: "resync-relationship-source",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Resync relationship source is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-resync-relationship-source.ts",
    "hooks/queries/utils/mutate-resync-relationship-source.ts",
    "hooks/queries/utils/resync-relationship-source-keys.ts",
    "hooks/queries/utils/resync-relationship-source-keys.test.ts",
    "hooks/queries/use-resync-relationship-source.lit.ts",
  ],
});
