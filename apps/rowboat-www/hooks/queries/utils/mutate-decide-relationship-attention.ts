import { z } from "zod";

import {
  DecideRelationshipAttention200Response,
  DecideRelationshipAttentionBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const DecideRelationshipAttentionInputSchema = DecideRelationshipAttentionBody;

export type DecideRelationshipAttentionInput = z.infer<
  typeof DecideRelationshipAttentionInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Decide relationship attention. Validates the response with
 * DecideRelationshipAttention200Response. Do not cast the parsed result. Owned by `use-decide-relationship-attention.lit.ts`.
 */
export function decideRelationshipAttentionPath(attentionId: string): string {
  return `/relationship-attention/${encodeURIComponent(attentionId)}/decisions`;
}

export async function loadDecideRelationshipAttention(
  request: RequestJsonFn,
  attentionId: string,
  body: DecideRelationshipAttentionInput,
  signal?: AbortSignal,
) {
  return request({
    path: decideRelationshipAttentionPath(attentionId),
    method: "POST",
    schema: DecideRelationshipAttention200Response,
    body,
    signal,
  });
}

export function fetchDecideRelationshipAttention(
  attentionId: string,
  body: DecideRelationshipAttentionInput,
  signal?: AbortSignal,
) {
  return loadDecideRelationshipAttention(requestJson, attentionId, body, signal);
}
