import { GetGoogleConnectionStatus200Response } from "@/lib/api/generated/zod/google-oauth/google-oauth";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { GoogleConnectionStatus } from "@/lib/api/generated/client/model";

const GOOGLE_OAUTH_PATH = "/google-oauth";

export async function loadGoogleConnectionStatus(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<GoogleConnectionStatus> {
  return request({
    path: GOOGLE_OAUTH_PATH,
    schema: GetGoogleConnectionStatus200Response,
    signal,
  }) as Promise<GoogleConnectionStatus>;
}

export function fetchGoogleConnectionStatus(signal?: AbortSignal): Promise<GoogleConnectionStatus> {
  return loadGoogleConnectionStatus(requestJson, signal);
}
