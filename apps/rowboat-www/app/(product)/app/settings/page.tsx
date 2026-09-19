import { Suspense } from "react";

import { SettingsDashboardRoute } from "@/app/(product)/app/settings/_components/settings-dashboard-route/settings-dashboard-route";
import { prefetchSettings } from "@/app/(product)/app/settings/prefetch";
import { settingsSearchParamsCache } from "@/app/(product)/app/settings/search-params";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import SettingsLoading from "./loading";

type SettingsPageProps = {
  searchParams: Promise<{ settings?: string | string[] }>;
};

/**
 * Keeps URL-dependent settings selection behind a streaming boundary.
 *
 * Next.js Cache Components cannot complete an instant client navigation when
 * a page reads searchParams outside Suspense. That left the previous page
 * hidden and made its visible connector CTA appear inert.
 */
export default function SettingsPage({ searchParams }: SettingsPageProps) {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsRouteContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsRouteContent({ searchParams }: SettingsPageProps) {
  const raw = await searchParams;
  const { settings } = settingsSearchParamsCache.parse({
    settings: Array.isArray(raw.settings) ? raw.settings[0] : raw.settings,
  });
  return (
    <PrefetchHydration seed={prefetchSettings}>
      <SettingsDashboardRoute section={settings} />
    </PrefetchHydration>
  );
}
