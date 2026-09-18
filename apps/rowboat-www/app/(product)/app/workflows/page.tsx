import { WorkflowsDashboardRoute } from "@/components/features/dashboard/dashboard-route-content/dashboard-route-content";
import { workflowFocusFromParam } from "@/lib/product-navigation";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const { focus } = await searchParams;
  return (
    <WorkflowsDashboardRoute
      focus={workflowFocusFromParam(Array.isArray(focus) ? focus[0] : focus)}
    />
  );
}
