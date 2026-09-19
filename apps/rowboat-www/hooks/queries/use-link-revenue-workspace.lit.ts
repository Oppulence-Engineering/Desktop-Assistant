import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Link revenue workspace — Link revenue workspace is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const LinkRevenueWorkspaceLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("link-revenue-workspace"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const LinkRevenueWorkspaceLit = LinkRevenueWorkspaceLitSchema.parse({
  kind: "mutation",
  name: "link-revenue-workspace",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Link revenue workspace is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-link-revenue-workspace.ts",
    "hooks/queries/utils/mutate-link-revenue-workspace.ts",
    "hooks/queries/utils/link-revenue-workspace-keys.ts",
    "hooks/queries/utils/link-revenue-workspace-keys.test.ts",
    "hooks/queries/use-link-revenue-workspace.lit.ts",
  ],
});
