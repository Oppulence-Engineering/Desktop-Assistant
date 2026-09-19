import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { SettingsDashboardRoute } from "@/app/(product)/app/settings/_components/settings-dashboard-route/settings-dashboard-route";
import { prefetchSettings } from "@/app/(product)/app/settings/prefetch";
import { settingsSearchParamsCache } from "@/app/(product)/app/settings/search-params";
import { getQueryClient } from "@/lib/query/get-query-client";

export const instant = false;

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
    <Suspense fallback={<SettingsRouteFallback />}>
      <SettingsRouteContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsRouteContent({ searchParams }: SettingsPageProps) {
  const raw = await searchParams;
  const { settings } = settingsSearchParamsCache.parse({
    settings: Array.isArray(raw.settings) ? raw.settings[0] : raw.settings,
  });
  const queryClient = getQueryClient();
  await prefetchSettings(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsDashboardRoute section={settings} />
    </HydrationBoundary>
  );
}

function SettingsRouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Loading settings…
    </div>
  );
}
