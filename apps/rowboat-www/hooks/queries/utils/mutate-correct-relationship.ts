import { z } from "zod";

import {
  CorrectRelationship201Response,
  CorrectRelationshipBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const CorrectRelationshipInputSchema = CorrectRelationshipBody;

export type CorrectRelationshipInput = z.infer<typeof CorrectRelationshipInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Correct relationship. Validates the response with
 * CorrectRelationship201Response. Do not cast the parsed result. Owned by `use-correct-relationship.lit.ts`.
 */
export function correctRelationshipPath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/corrections`;
}

export async function loadCorrectRelationship(
  request: RequestJsonFn,
  relationshipId: string,
  body: CorrectRelationshipInput,
  signal?: AbortSignal,
) {
  return request({
    path: correctRelationshipPath(relationshipId),
    method: "POST",
    schema: CorrectRelationship201Response,
    body,
    signal,
  });
}

export function fetchCorrectRelationship(
  relationshipId: string,
  body: CorrectRelationshipInput,
  signal?: AbortSignal,
) {
  return loadCorrectRelationship(requestJson, relationshipId, body, signal);
}
