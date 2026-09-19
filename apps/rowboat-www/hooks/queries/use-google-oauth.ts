"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchGoogleConnectionStatus } from "@/hooks/queries/utils/fetch-google-oauth";
import {
  GOOGLE_OAUTH_STATUS_STALE_TIME,
  googleOauthKeys,
} from "@/hooks/queries/utils/google-oauth-keys";

export function useGoogleConnectionStatus() {
  return useQuery({
    queryKey: googleOauthKeys.status(),
    queryFn: ({ signal }) => fetchGoogleConnectionStatus(signal),
    staleTime: GOOGLE_OAUTH_STATUS_STALE_TIME,
  });
}
