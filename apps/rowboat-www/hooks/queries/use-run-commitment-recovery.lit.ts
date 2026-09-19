import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Run commitment recovery — Run commitment recovery is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RunCommitmentRecoveryLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("run-commitment-recovery"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RunCommitmentRecoveryLit = RunCommitmentRecoveryLitSchema.parse({
  kind: "mutation",
  name: "run-commitment-recovery",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Run commitment recovery is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-run-commitment-recovery.ts",
    "hooks/queries/utils/mutate-run-commitment-recovery.ts",
    "hooks/queries/utils/run-commitment-recovery-keys.ts",
    "hooks/queries/utils/run-commitment-recovery-keys.test.ts",
    "hooks/queries/use-run-commitment-recovery.lit.ts",
  ],
});
