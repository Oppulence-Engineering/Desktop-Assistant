import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Create relationship — Create relationship is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const CreateRelationshipLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("create-relationship"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const CreateRelationshipLit = CreateRelationshipLitSchema.parse({
  kind: "mutation",
  name: "create-relationship",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Create relationship is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-create-relationship.ts",
    "hooks/queries/utils/mutate-create-relationship.ts",
    "hooks/queries/utils/create-relationship-keys.ts",
    "hooks/queries/utils/create-relationship-keys.test.ts",
    "hooks/queries/use-create-relationship.lit.ts",
  ],
});
