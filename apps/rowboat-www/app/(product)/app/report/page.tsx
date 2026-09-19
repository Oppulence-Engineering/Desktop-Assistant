import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { ReportDashboardRoute } from "@/app/(product)/app/report/_components/report-dashboard-route/report-dashboard-route";
import { prefetchReport } from "@/app/(product)/app/report/prefetch";
import { reportSearchParamsCache } from "@/app/(product)/app/report/search-params";
import { getQueryClient } from "@/lib/query/get-query-client";

// The Open Promises report is the wedge (one-pager §11). Signup lands here:
// connect Gmail, scan six months, read the document. The sale and the activation
// are one motion, so this route asks for nothing else first — no model key, no
// workspace setup, no configuration.
export const instant = false;

export const metadata = {
  title: "Open promises - Oppulence",
  description: "The commitments your team made that have no evidence of fulfilment.",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string | string[] }>;
}) {
  const raw = await searchParams;
  const { scan } = reportSearchParamsCache.parse({
    scan: Array.isArray(raw.scan) ? raw.scan[0] : raw.scan,
  });
  const queryClient = getQueryClient();
  await prefetchReport(queryClient, scan);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportDashboardRoute />
    </HydrationBoundary>
  );
}
