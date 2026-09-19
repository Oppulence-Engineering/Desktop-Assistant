import { z } from "zod";

import {
  DecideConversationChange201Response,
  DecideConversationChangeBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const DecideConversationChangeInputSchema = DecideConversationChangeBody;

export type DecideConversationChangeInput = z.infer<typeof DecideConversationChangeInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Decide conversation change. Validates the response with
 * DecideConversationChange201Response. Do not cast the parsed result. Owned by `use-decide-conversation-change.lit.ts`.
 */
export function decideConversationChangePath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/conversation-decisions`;
}

export async function loadDecideConversationChange(
  request: RequestJsonFn,
  relationshipId: string,
  body: DecideConversationChangeInput,
  signal?: AbortSignal,
) {
  return request({
    path: decideConversationChangePath(relationshipId),
    method: "POST",
    schema: DecideConversationChange201Response,
    body,
    signal,
  });
}

export function fetchDecideConversationChange(
  relationshipId: string,
  body: DecideConversationChangeInput,
  signal?: AbortSignal,
) {
  return loadDecideConversationChange(requestJson, relationshipId, body, signal);
}
