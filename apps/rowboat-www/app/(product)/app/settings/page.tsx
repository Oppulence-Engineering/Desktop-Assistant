import ProductDashboardClient from "../product-dashboard-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ settings?: string }>;
}) {
  const parameters = await searchParams;
  return (
    <ProductDashboardClient
      initialSettingsSection={parameters.settings === "connections" ? "connections" : "overview"}
      initialView="settings"
    />
  );
}
