import { z } from "zod";

import {
  RetractRelationshipAssertion200Response,
  RetractRelationshipAssertionBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RetractRelationshipAssertionInputSchema = RetractRelationshipAssertionBody;

export type RetractRelationshipAssertionInput = z.infer<
  typeof RetractRelationshipAssertionInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Retract relationship assertion. Validates the response with
 * RetractRelationshipAssertion200Response. Do not cast the parsed result. Owned by `use-retract-relationship-assertion.lit.ts`.
 */
export function retractRelationshipAssertionPath(
  relationshipId: string,
  assertionId: string,
): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/assertions/${encodeURIComponent(assertionId)}/retract`;
}

export async function loadRetractRelationshipAssertion(
  request: RequestJsonFn,
  relationshipId: string,
  assertionId: string,
  body: RetractRelationshipAssertionInput,
  signal?: AbortSignal,
) {
  return request({
    path: retractRelationshipAssertionPath(relationshipId, assertionId),
    method: "POST",
    schema: RetractRelationshipAssertion200Response,
    body,
    signal,
  });
}

export function fetchRetractRelationshipAssertion(
  relationshipId: string,
  assertionId: string,
  body: RetractRelationshipAssertionInput,
  signal?: AbortSignal,
) {
  return loadRetractRelationshipAssertion(requestJson, relationshipId, assertionId, body, signal);
}
