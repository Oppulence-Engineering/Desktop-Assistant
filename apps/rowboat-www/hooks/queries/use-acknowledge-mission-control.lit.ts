import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Acknowledge mission control — Acknowledge mission control is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const AcknowledgeMissionControlLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("acknowledge-mission-control"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const AcknowledgeMissionControlLit = AcknowledgeMissionControlLitSchema.parse({
  kind: "mutation",
  name: "acknowledge-mission-control",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Acknowledge mission control is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-acknowledge-mission-control.ts",
    "hooks/queries/utils/mutate-acknowledge-mission-control.ts",
    "hooks/queries/utils/acknowledge-mission-control-keys.ts",
    "hooks/queries/utils/acknowledge-mission-control-keys.test.ts",
    "hooks/queries/use-acknowledge-mission-control.lit.ts",
  ],
});
