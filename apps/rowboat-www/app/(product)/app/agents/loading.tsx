import { DashboardRouteFallback } from "@/lib/query/prefetch-hydration";

export default function AgentsLoading() {
  return <DashboardRouteFallback label="Loading agents…" />;
}
