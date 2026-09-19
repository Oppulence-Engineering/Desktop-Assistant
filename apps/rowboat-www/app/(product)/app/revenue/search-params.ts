import { createParser, createSearchParamsCache } from "nuqs/server";

import { RevenueTabSchema, type RevenueTab } from "@/lib/product-navigation";

export const revenueParsers = {
  tab: createParser({
    parse: (value) => {
      const parsed = RevenueTabSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    serialize: (value: RevenueTab) => value,
  }).withDefault("commitments"),
} as const;

/** Clean URLs, no back-stack churn for tab changes. */
export const revenueUrlKeys = {
  history: "replace",
  clearOnDefault: true,
} as const;

export const revenueSearchParamsCache = createSearchParamsCache(revenueParsers);
