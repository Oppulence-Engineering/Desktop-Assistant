import ProductDashboardClient from "../product-dashboard-client";

export const instant = false;

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const parameters = await searchParams;
  return <ProductDashboardClient initialWorkflowFocus={parameters.focus} initialView="workflows" />;
}
