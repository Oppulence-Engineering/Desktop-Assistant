import { Suspense } from "react";

import { ReportDashboardRoute } from "@/app/(product)/app/report/_components/report-dashboard-route/report-dashboard-route";
import { prefetchReport } from "@/app/(product)/app/report/prefetch";
import { reportSearchParamsCache } from "@/app/(product)/app/report/search-params";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import ReportLoading from "./loading";

export const metadata = {
  title: "Open promises - Oppulence",
  description: "The commitments your team made that have no evidence of fulfilment.",
};

type ReportPageProps = {
  searchParams: Promise<{ scan?: string | string[] }>;
};

export default function ReportPage({ searchParams }: ReportPageProps) {
  return (
    <Suspense fallback={<ReportLoading />}>
      <ReportRouteContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportRouteContent({ searchParams }: ReportPageProps) {
  const raw = await searchParams;
  const { scan } = reportSearchParamsCache.parse({
    scan: Array.isArray(raw.scan) ? raw.scan[0] : raw.scan,
  });
  return (
    <PrefetchHydration seed={(queryClient) => prefetchReport(queryClient, scan)}>
      <ReportDashboardRoute />
    </PrefetchHydration>
  );
}
