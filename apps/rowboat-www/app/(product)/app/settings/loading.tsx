import { DashboardRouteFallback } from "@/lib/query/prefetch-hydration";

export default function SettingsLoading() {
  return <DashboardRouteFallback label="Loading settings…" />;
}
