"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchPendingActionProposals } from "@/hooks/queries/utils/fetch-action-proposals";
import {
  ACTION_PROPOSAL_LIST_STALE_TIME,
  actionProposalKeys,
} from "@/hooks/queries/utils/action-proposal-keys";

export function usePendingActionProposals() {
  return useQuery({
    queryKey: actionProposalKeys.pending(),
    queryFn: ({ signal }) => fetchPendingActionProposals(signal),
    staleTime: ACTION_PROPOSAL_LIST_STALE_TIME,
  });
}
