import { ChatDashboardRoute } from "@/components/features/dashboard/dashboard-route-content/dashboard-route-content";

// The dashboard leaf is a client tree that lazy-loads route panels. Next
// drops it from instant prerender; opt out so that does not surface as a
// hard "/app" crash overlay on every navigation.
export const instant = false;

export default function ProductPage() {
  return <ChatDashboardRoute />;
}
