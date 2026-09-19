import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { RevenueDashboardRoute } from "@/app/(product)/app/revenue/_components/revenue-dashboard-route/revenue-dashboard-route";
import { prefetchRevenue } from "@/app/(product)/app/revenue/prefetch";
import { getQueryClient } from "@/lib/query/get-query-client";

export const instant = false;

export default async function RevenuePage() {
  const queryClient = getQueryClient();
  await prefetchRevenue(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RevenueDashboardRoute />
    </HydrationBoundary>
  );
}
