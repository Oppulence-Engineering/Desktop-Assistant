import { z } from "zod";

import {
  LinkRevenueWorkspace200Response,
  LinkRevenueWorkspaceBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const LinkRevenueWorkspaceInputSchema = LinkRevenueWorkspaceBody;

export type LinkRevenueWorkspaceInput = z.infer<typeof LinkRevenueWorkspaceInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Link revenue workspace. Validates the response with
 * LinkRevenueWorkspace200Response. Do not cast the parsed result. Owned by `use-link-revenue-workspace.lit.ts`.
 */
export function linkRevenueWorkspacePath(): string {
  return "/revenue-workspaces/link";
}

export async function loadLinkRevenueWorkspace(
  request: RequestJsonFn,
  body: LinkRevenueWorkspaceInput,
  signal?: AbortSignal,
) {
  return request({
    path: linkRevenueWorkspacePath(),
    method: "POST",
    schema: LinkRevenueWorkspace200Response,
    body,
    signal,
  });
}

export function fetchLinkRevenueWorkspace(body: LinkRevenueWorkspaceInput, signal?: AbortSignal) {
  return loadLinkRevenueWorkspace(requestJson, body, signal);
}
