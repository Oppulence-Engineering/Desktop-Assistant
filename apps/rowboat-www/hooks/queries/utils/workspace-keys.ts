export const workspaceKeys = {
  all: ["revenue-workspace"] as const,
  current: () => [...workspaceKeys.all, "current"] as const,
  notes: () => [...workspaceKeys.all, "notes"] as const,
};

export const WORKSPACE_CURRENT_STALE_TIME = 15_000;
