export const workflowKeys = {
  all: ["workflow"] as const,
  tasks: () => [...workflowKeys.all, "tasks"] as const,
  templates: () => [...workflowKeys.all, "templates"] as const,
  runs: (scope: { status: string; trigger: string; executor: string }) =>
    [...workflowKeys.all, "runs", scope] as const,
  latest: (slug: string) => [...workflowKeys.all, "latest", slug] as const,
};

export const WORKFLOW_LIST_STALE_TIME = 15_000;
