import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { ChatDashboardRoute } from "@/app/(product)/app/_components/chat-dashboard-route/chat-dashboard-route";
import { prefetchChatHome } from "@/app/(product)/app/prefetch";
import { getQueryClient } from "@/lib/query/get-query-client";

// The dashboard leaf is a client tree that lazy-loads route panels. Next
// drops it from instant prerender; opt out so that does not surface as a
// hard "/app" crash overlay on every navigation.
export const instant = false;

export default async function ProductPage() {
  const queryClient = getQueryClient();
  await prefetchChatHome(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ChatDashboardRoute />
    </HydrationBoundary>
  );
}
