export const sidebarKeys = {
  all: ["sidebar"] as const,
  agents: () => [...sidebarKeys.all, "agents"] as const,
  tasks: () => [...sidebarKeys.all, "tasks"] as const,
  runs: () => [...sidebarKeys.all, "runs"] as const,
};

export const SIDEBAR_LIST_STALE_TIME = 15_000;
