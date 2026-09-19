import { DashboardRouteFallback } from "@/lib/query/prefetch-hydration";

export default function WorkflowsLoading() {
  return <DashboardRouteFallback label="Loading workflows…" />;
}
