export const actionProposalKeys = {
  all: ["action-proposal"] as const,
  lists: () => [...actionProposalKeys.all, "list"] as const,
  pending: () => [...actionProposalKeys.lists(), "pending"] as const,
};

export const ACTION_PROPOSAL_LIST_STALE_TIME = 15_000;
