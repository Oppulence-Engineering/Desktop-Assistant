import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Ingest relationship observations — Ingest relationship observations is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const IngestRelationshipObservationsLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("ingest-relationship-observations"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const IngestRelationshipObservationsLit = IngestRelationshipObservationsLitSchema.parse({
  kind: "mutation",
  name: "ingest-relationship-observations",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Ingest relationship observations is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-ingest-relationship-observations.ts",
    "hooks/queries/utils/mutate-ingest-relationship-observations.ts",
    "hooks/queries/utils/ingest-relationship-observations-keys.ts",
    "hooks/queries/utils/ingest-relationship-observations-keys.test.ts",
    "hooks/queries/use-ingest-relationship-observations.lit.ts",
  ],
});
