import { z } from "zod";

import {
  CorrectConversationEvidence201Response,
  CorrectConversationEvidenceBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const CorrectConversationEvidenceInputSchema = CorrectConversationEvidenceBody;

export type CorrectConversationEvidenceInput = z.infer<
  typeof CorrectConversationEvidenceInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Correct conversation evidence. Validates the response with
 * CorrectConversationEvidence201Response. Do not cast the parsed result. Owned by `use-correct-conversation-evidence.lit.ts`.
 */
export function correctConversationEvidencePath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/conversation-corrections`;
}

export async function loadCorrectConversationEvidence(
  request: RequestJsonFn,
  relationshipId: string,
  body: CorrectConversationEvidenceInput,
  signal?: AbortSignal,
) {
  return request({
    path: correctConversationEvidencePath(relationshipId),
    method: "POST",
    schema: CorrectConversationEvidence201Response,
    body,
    signal,
  });
}

export function fetchCorrectConversationEvidence(
  relationshipId: string,
  body: CorrectConversationEvidenceInput,
  signal?: AbortSignal,
) {
  return loadCorrectConversationEvidence(requestJson, relationshipId, body, signal);
}
