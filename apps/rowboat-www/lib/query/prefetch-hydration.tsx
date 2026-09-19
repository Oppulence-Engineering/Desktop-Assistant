import { dehydrate, HydrationBoundary, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getQueryClient } from "@/lib/query/get-query-client";

/** Inline fallback for streamed dashboard leaves — not the full-page /app spinner. */
export function DashboardRouteFallback({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

/**
 * Seed TanStack Query on the server, then dehydrate into the leaf.
 *
 * Kept as its own async child so the page can return a Suspense boundary
 * immediately (Cache Components / instant navigation).
 */
export async function PrefetchHydration({
  seed,
  children,
}: {
  seed: (queryClient: QueryClient) => Promise<void>;
  children: ReactNode;
}) {
  const queryClient = getQueryClient();
  await seed(queryClient);
  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
