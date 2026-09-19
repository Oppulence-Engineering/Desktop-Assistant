import { createParser, createSearchParamsCache } from "nuqs/server";

import { WorkflowFocusSchema, type WorkflowFocus } from "@/lib/product-navigation";

export const workflowParsers = {
  focus: createParser({
    parse: (value) => {
      const parsed = WorkflowFocusSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    serialize: (value: WorkflowFocus) => value,
  }).withDefault("scheduled"),
} as const;

/** Clean URLs, no back-stack churn for the scheduled/runs toggle. */
export const workflowUrlKeys = {
  history: "replace",
  clearOnDefault: true,
} as const;

export const workflowSearchParamsCache = createSearchParamsCache(workflowParsers);
