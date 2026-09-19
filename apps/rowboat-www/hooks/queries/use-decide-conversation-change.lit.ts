import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Decide conversation change — Decide conversation change is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const DecideConversationChangeLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("decide-conversation-change"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const DecideConversationChangeLit = DecideConversationChangeLitSchema.parse({
  kind: "mutation",
  name: "decide-conversation-change",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Decide conversation change is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-decide-conversation-change.ts",
    "hooks/queries/utils/mutate-decide-conversation-change.ts",
    "hooks/queries/utils/decide-conversation-change-keys.ts",
    "hooks/queries/utils/decide-conversation-change-keys.test.ts",
    "hooks/queries/use-decide-conversation-change.lit.ts",
  ],
});
