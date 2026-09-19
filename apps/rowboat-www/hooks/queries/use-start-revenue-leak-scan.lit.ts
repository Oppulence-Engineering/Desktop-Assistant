import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Start revenue leak scan — Start revenue leak scan is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const StartRevenueLeakScanLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("start-revenue-leak-scan"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const StartRevenueLeakScanLit = StartRevenueLeakScanLitSchema.parse({
  kind: "mutation",
  name: "start-revenue-leak-scan",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Start revenue leak scan is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-start-revenue-leak-scan.ts",
    "hooks/queries/utils/mutate-start-revenue-leak-scan.ts",
    "hooks/queries/utils/start-revenue-leak-scan-keys.ts",
    "hooks/queries/utils/start-revenue-leak-scan-keys.test.ts",
    "hooks/queries/use-start-revenue-leak-scan.lit.ts",
  ],
});
