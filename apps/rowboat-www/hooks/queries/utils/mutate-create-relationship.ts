import { z } from "zod";

import {
  CreateRelationship201Response,
  CreateRelationshipBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const CreateRelationshipInputSchema = CreateRelationshipBody;

export type CreateRelationshipInput = z.infer<typeof CreateRelationshipInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Create relationship. Validates the response with
 * CreateRelationship201Response. Do not cast the parsed result. Owned by `use-create-relationship.lit.ts`.
 */
export function createRelationshipPath(): string {
  return "/relationships";
}

export async function loadCreateRelationship(
  request: RequestJsonFn,
  body: CreateRelationshipInput,
  signal?: AbortSignal,
) {
  return request({
    path: createRelationshipPath(),
    method: "POST",
    schema: CreateRelationship201Response,
    body,
    signal,
  });
}

export function fetchCreateRelationship(body: CreateRelationshipInput, signal?: AbortSignal) {
  return loadCreateRelationship(requestJson, body, signal);
}
