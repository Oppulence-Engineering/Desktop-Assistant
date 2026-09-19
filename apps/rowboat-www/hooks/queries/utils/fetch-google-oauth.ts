import { z } from "zod";

import { GetGoogleConnectionStatus200Response } from "@/lib/api/generated/zod/google-oauth/google-oauth";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

const GOOGLE_OAUTH_PATH = "/google-oauth";

export type GoogleConnectionStatus = z.infer<typeof GetGoogleConnectionStatus200Response>;

export async function loadGoogleConnectionStatus(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<GoogleConnectionStatus> {
  return request({
    path: GOOGLE_OAUTH_PATH,
    schema: GetGoogleConnectionStatus200Response,
    signal,
  });
}

export function fetchGoogleConnectionStatus(signal?: AbortSignal): Promise<GoogleConnectionStatus> {
  return loadGoogleConnectionStatus(requestJson, signal);
}
