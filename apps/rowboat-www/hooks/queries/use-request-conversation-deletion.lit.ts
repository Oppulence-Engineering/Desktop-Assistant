import { z } from "zod";

/**
 * @oppulence-gen kind=mutation
 * Request conversation deletion — Request conversation deletion is generated from the rowboat-www growth standard. Replace this summary in the lit.
 *
 * Living Interface Template. This file is the contract, not the
 * implementation. Implementation lives in the siblings listed in `files`.
 */
export const RequestConversationDeletionLitSchema = z.object({
  kind: z.literal("mutation"),
  name: z.literal("request-conversation-deletion"),
  domain: z.literal(""),
  owner: z.literal("hook"),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const RequestConversationDeletionLit = RequestConversationDeletionLitSchema.parse({
  kind: "mutation",
  name: "request-conversation-deletion",
  domain: "",
  owner: "hook",
  client: false,
  summary:
    "Request conversation deletion is generated from the rowboat-www growth standard. Replace this summary in the lit.",
  schemas: [],
  files: [
    "hooks/queries/use-request-conversation-deletion.ts",
    "hooks/queries/utils/mutate-request-conversation-deletion.ts",
    "hooks/queries/utils/request-conversation-deletion-keys.ts",
    "hooks/queries/utils/request-conversation-deletion-keys.test.ts",
    "hooks/queries/use-request-conversation-deletion.lit.ts",
  ],
});
