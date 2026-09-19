import { z } from "zod";

import { DisconnectRelationshipSource200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const DisconnectRelationshipSourceInputSchema = z.undefined();

export type DisconnectRelationshipSourceInput = z.infer<
  typeof DisconnectRelationshipSourceInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Disconnect relationship source. Validates the response with
 * DisconnectRelationshipSource200Response. Do not cast the parsed result. Owned by `use-disconnect-relationship-source.lit.ts`.
 */
export function disconnectRelationshipSourcePath(source: string, sourceAccountId: string): string {
  return `/relationship-sources/${encodeURIComponent(source)}/${encodeURIComponent(sourceAccountId)}/disconnect`;
}

export async function loadDisconnectRelationshipSource(
  request: RequestJsonFn,
  source: string,
  sourceAccountId: string,
  signal?: AbortSignal,
) {
  return request({
    path: disconnectRelationshipSourcePath(source, sourceAccountId),
    method: "POST",
    schema: DisconnectRelationshipSource200Response,
    signal,
  });
}

export function fetchDisconnectRelationshipSource(
  source: string,
  sourceAccountId: string,
  signal?: AbortSignal,
) {
  return loadDisconnectRelationshipSource(requestJson, source, sourceAccountId, signal);
}
