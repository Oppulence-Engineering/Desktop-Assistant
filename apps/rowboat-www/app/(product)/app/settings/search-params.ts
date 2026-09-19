import { createParser, createSearchParamsCache } from "nuqs/server";

import { settingsSectionFromParam, type SettingsSection } from "@/lib/product-navigation";

export const settingsParsers = {
  settings: createParser({
    parse: (value) => settingsSectionFromParam(value),
    serialize: (value: SettingsSection) => value,
  }).withDefault("overview"),
} as const;

/** Clean URLs, no back-stack churn for section changes. */
export const settingsUrlKeys = {
  history: "replace",
  clearOnDefault: true,
} as const;

export const settingsSearchParamsCache = createSearchParamsCache(settingsParsers);
