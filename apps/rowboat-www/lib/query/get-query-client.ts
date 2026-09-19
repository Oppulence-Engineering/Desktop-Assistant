import { QueryClient } from "@tanstack/react-query";

/** Matches QueryProvider so RSC dehydrate and the browser cache share one policy. */
const APP_QUERY_STALE_TIME = 15_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: APP_QUERY_STALE_TIME,
      },
    },
  });
}

/** One client per RSC request so dehydrate never leaks across users. */
export function getQueryClient(): QueryClient {
  return createAppQueryClient();
}

/**
 * Awaited prefetch so dehydrate keeps the result. A failed seed must not
 * crash the authenticated shell — the client hook retries.
 */
export async function seedQuery(
  queryClient: QueryClient,
  options: Parameters<QueryClient["prefetchQuery"]>[0],
): Promise<void> {
  try {
    await queryClient.prefetchQuery(options);
  } catch {
    // Intentionally empty: first paint still hydrates whatever succeeded.
  }
}
