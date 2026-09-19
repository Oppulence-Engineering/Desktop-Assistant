import { DashboardRouteFallback } from "@/lib/query/prefetch-hydration";

export default function ProductLoading() {
  return <DashboardRouteFallback label="Loading workspace…" />;
}
