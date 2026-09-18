import { Suspense } from "react";

import { SettingsDashboardRoute } from "@/components/features/dashboard/dashboard-route-content/dashboard-route-content";
import { settingsSectionFromParam } from "@/lib/product-navigation";

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
  const { settings } = await searchParams;
  return (
    <SettingsDashboardRoute
      section={settingsSectionFromParam(Array.isArray(settings) ? settings[0] : settings)}
    />
  );
}

function SettingsRouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Loading settings…
    </div>
  );
}
