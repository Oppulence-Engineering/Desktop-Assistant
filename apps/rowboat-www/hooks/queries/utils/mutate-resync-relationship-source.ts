import { z } from "zod";

import {
  ResyncRelationshipSource202Response,
  ResyncRelationshipSourceBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ResyncRelationshipSourceInputSchema = ResyncRelationshipSourceBody;

export type ResyncRelationshipSourceInput = z.infer<typeof ResyncRelationshipSourceInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Resync relationship source. Validates the response with
 * ResyncRelationshipSource202Response. Do not cast the parsed result. Owned by `use-resync-relationship-source.lit.ts`.
 */
export function resyncRelationshipSourcePath(source: string): string {
  return `/relationship-sources/${encodeURIComponent(source)}/resync`;
}

export async function loadResyncRelationshipSource(
  request: RequestJsonFn,
  source: string,
  body: ResyncRelationshipSourceInput,
  signal?: AbortSignal,
) {
  return request({
    path: resyncRelationshipSourcePath(source),
    method: "POST",
    schema: ResyncRelationshipSource202Response,
    body,
    signal,
  });
}

export function fetchResyncRelationshipSource(
  source: string,
  body: ResyncRelationshipSourceInput,
  signal?: AbortSignal,
) {
  return loadResyncRelationshipSource(requestJson, source, body, signal);
}
