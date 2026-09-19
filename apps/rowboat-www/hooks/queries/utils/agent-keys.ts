export const agentKeys = {
  all: ["agent"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  summaries: () => [...agentKeys.lists(), "summaries"] as const,
};

export const AGENT_LIST_STALE_TIME = 15_000;
