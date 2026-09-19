import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Disconnect relationship source — Disconnect relationship source is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const DisconnectRelationshipSourceLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("disconnect-relationship-source"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const DisconnectRelationshipSourceLit = DisconnectRelationshipSourceLitSchema.parse({
  kind: "mutation",
  name: "disconnect-relationship-source",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Disconnect relationship source is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-disconnect-relationship-source.ts",
    "hooks/queries/utils/mutate-disconnect-relationship-source.ts",
    "hooks/queries/utils/disconnect-relationship-source-keys.ts",
    "hooks/queries/utils/disconnect-relationship-source-keys.test.ts",
    "hooks/queries/use-disconnect-relationship-source.lit.ts",
  ],
});
