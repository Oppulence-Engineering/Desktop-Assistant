import { SettingsDashboardRoute } from "@/components/features/dashboard/dashboard-route-content/dashboard-route-content";
import { settingsSectionFromParam } from "@/lib/product-navigation";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ settings?: string | string[] }>;
}) {
  const { settings } = await searchParams;
  return (
    <SettingsDashboardRoute
      section={settingsSectionFromParam(Array.isArray(settings) ? settings[0] : settings)}
    />
  );
}
