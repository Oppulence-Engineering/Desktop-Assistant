import { z } from "zod";

import {
  IngestRelationshipObservations201Response,
  IngestRelationshipObservationsBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const IngestRelationshipObservationsInputSchema = IngestRelationshipObservationsBody;

export type IngestRelationshipObservationsInput = z.infer<
  typeof IngestRelationshipObservationsInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Ingest relationship observations. Validates the response with
 * IngestRelationshipObservations201Response. Do not cast the parsed result. Owned by `use-ingest-relationship-observations.lit.ts`.
 */
export function ingestRelationshipObservationsPath(): string {
  return "/relationship-observations/batch";
}

export async function loadIngestRelationshipObservations(
  request: RequestJsonFn,
  body: IngestRelationshipObservationsInput,
  signal?: AbortSignal,
) {
  return request({
    path: ingestRelationshipObservationsPath(),
    method: "POST",
    schema: IngestRelationshipObservations201Response,
    body,
    signal,
  });
}

export function fetchIngestRelationshipObservations(
  body: IngestRelationshipObservationsInput,
  signal?: AbortSignal,
) {
  return loadIngestRelationshipObservations(requestJson, body, signal);
}
