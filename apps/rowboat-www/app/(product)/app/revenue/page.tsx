import ProductDashboardClient from "../product-dashboard-client";

export const instant = false;

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const parameters = await searchParams;
  return <ProductDashboardClient initialRevenueTab={parameters.tab} initialView="revenue" />;
}
