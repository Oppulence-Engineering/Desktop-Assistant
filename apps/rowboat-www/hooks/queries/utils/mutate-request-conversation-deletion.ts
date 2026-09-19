import { z } from "zod";

import {
  RequestConversationDeletion202Response,
  RequestConversationDeletionBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RequestConversationDeletionInputSchema = RequestConversationDeletionBody;

export type RequestConversationDeletionInput = z.infer<
  typeof RequestConversationDeletionInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Request conversation deletion. Validates the response with
 * RequestConversationDeletion202Response. Do not cast the parsed result. Owned by `use-request-conversation-deletion.lit.ts`.
 */
export function requestConversationDeletionPath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/conversation-deletion`;
}

export async function loadRequestConversationDeletion(
  request: RequestJsonFn,
  relationshipId: string,
  body: RequestConversationDeletionInput,
  signal?: AbortSignal,
) {
  return request({
    path: requestConversationDeletionPath(relationshipId),
    method: "POST",
    schema: RequestConversationDeletion202Response,
    body,
    signal,
  });
}

export function fetchRequestConversationDeletion(
  relationshipId: string,
  body: RequestConversationDeletionInput,
  signal?: AbortSignal,
) {
  return loadRequestConversationDeletion(requestJson, relationshipId, body, signal);
}
