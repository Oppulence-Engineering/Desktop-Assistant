import { createSearchParamsCache, parseAsString } from "nuqs/server";

/** Nullable: a missing scan means "use the latest completed scan". */
export const reportParsers = {
  scan: parseAsString,
} as const;

/** Clean URLs, no back-stack churn for the selected audit. */
export const reportUrlKeys = {
  history: "replace",
  clearOnDefault: true,
} as const;

export const reportSearchParamsCache = createSearchParamsCache(reportParsers);
