import { DashboardRouteFallback } from "@/lib/query/prefetch-hydration";

export default function ReportLoading() {
  return <DashboardRouteFallback label="Loading report…" />;
}
