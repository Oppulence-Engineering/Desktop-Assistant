import { Suspense } from "react";

import { RevenueDashboardRoute } from "@/app/(product)/app/revenue/_components/revenue-dashboard-route/revenue-dashboard-route";
import { prefetchRevenue } from "@/app/(product)/app/revenue/prefetch";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import RevenueLoading from "./loading";

export default function RevenuePage() {
  return (
    <Suspense fallback={<RevenueLoading />}>
      <PrefetchHydration seed={prefetchRevenue}>
        <RevenueDashboardRoute />
      </PrefetchHydration>
    </Suspense>
  );
}
