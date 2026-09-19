import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Report relationship source authorization — Report relationship source authorization is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const ReportRelationshipSourceAuthorizationLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("report-relationship-source-authorization"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const ReportRelationshipSourceAuthorizationLit =
  ReportRelationshipSourceAuthorizationLitSchema.parse({
    kind: "mutation",
    name: "report-relationship-source-authorization",
    domain: "",
    owner: "hook",
    client: false,
    summary:
      "Report relationship source authorization is generated from the rowboat-www growth standard. Replace this summary in the lit.",
    schemas: [],
    files: [
      "hooks/queries/use-report-relationship-source-authorization.ts",
      "hooks/queries/utils/mutate-report-relationship-source-authorization.ts",
      "hooks/queries/utils/report-relationship-source-authorization-keys.ts",
      "hooks/queries/utils/report-relationship-source-authorization-keys.test.ts",
      "hooks/queries/use-report-relationship-source-authorization.lit.ts",
    ],
  });
