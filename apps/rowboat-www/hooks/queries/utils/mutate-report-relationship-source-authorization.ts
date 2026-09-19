import { z } from "zod";

import {
  ReportRelationshipSourceAuthorization200Response,
  ReportRelationshipSourceAuthorizationBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ReportRelationshipSourceAuthorizationInputSchema =
  ReportRelationshipSourceAuthorizationBody;

export type ReportRelationshipSourceAuthorizationInput = z.infer<
  typeof ReportRelationshipSourceAuthorizationInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Report relationship source authorization. Validates the response with
 * ReportRelationshipSourceAuthorization200Response. Do not cast the parsed result. Owned by `use-report-relationship-source-authorization.lit.ts`.
 */
export function reportRelationshipSourceAuthorizationPath(source: string): string {
  return `/relationship-sources/${encodeURIComponent(source)}/authorization`;
}

export async function loadReportRelationshipSourceAuthorization(
  request: RequestJsonFn,
  source: string,
  body: ReportRelationshipSourceAuthorizationInput,
  signal?: AbortSignal,
) {
  return request({
    path: reportRelationshipSourceAuthorizationPath(source),
    method: "POST",
    schema: ReportRelationshipSourceAuthorization200Response,
    body,
    signal,
  });
}

export function fetchReportRelationshipSourceAuthorization(
  source: string,
  body: ReportRelationshipSourceAuthorizationInput,
  signal?: AbortSignal,
) {
  return loadReportRelationshipSourceAuthorization(requestJson, source, body, signal);
}
