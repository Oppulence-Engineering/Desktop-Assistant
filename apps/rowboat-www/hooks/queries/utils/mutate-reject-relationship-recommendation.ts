import { z } from "zod";

import {
  RejectRelationshipRecommendation200Response,
  RejectRelationshipRecommendationBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RejectRelationshipRecommendationInputSchema = RejectRelationshipRecommendationBody;

export type RejectRelationshipRecommendationInput = z.infer<
  typeof RejectRelationshipRecommendationInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Reject relationship recommendation. Validates the response with
 * RejectRelationshipRecommendation200Response. Do not cast the parsed result. Owned by `use-reject-relationship-recommendation.lit.ts`.
 */
export function rejectRelationshipRecommendationPath(actionId: string): string {
  return `/relationship-recommendations/${encodeURIComponent(actionId)}/reject`;
}

export async function loadRejectRelationshipRecommendation(
  request: RequestJsonFn,
  actionId: string,
  body: RejectRelationshipRecommendationInput,
  signal?: AbortSignal,
) {
  return request({
    path: rejectRelationshipRecommendationPath(actionId),
    method: "POST",
    schema: RejectRelationshipRecommendation200Response,
    body,
    signal,
  });
}

export function fetchRejectRelationshipRecommendation(
  actionId: string,
  body: RejectRelationshipRecommendationInput,
  signal?: AbortSignal,
) {
  return loadRejectRelationshipRecommendation(requestJson, actionId, body, signal);
}
