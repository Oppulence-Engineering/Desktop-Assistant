"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchCommunicationPolicy,
  fetchCommunicationPrivacyRules,
} from "@/hooks/queries/utils/fetch-communication";
import {
  COMMUNICATION_POLICY_STALE_TIME,
  communicationKeys,
} from "@/hooks/queries/utils/communication-keys";

export function useCommunicationPolicy(sourceAccountId: string) {
  return useQuery({
    queryKey: communicationKeys.policy(sourceAccountId),
    queryFn: ({ signal }) => fetchCommunicationPolicy(sourceAccountId, signal),
    staleTime: COMMUNICATION_POLICY_STALE_TIME,
    enabled: sourceAccountId.trim().length > 0,
  });
}

export function useCommunicationPrivacyRules(enabled = true) {
  return useQuery({
    queryKey: communicationKeys.rules(),
    queryFn: ({ signal }) => fetchCommunicationPrivacyRules(signal),
    staleTime: COMMUNICATION_POLICY_STALE_TIME,
    enabled,
  });
}
