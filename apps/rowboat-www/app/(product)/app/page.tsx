import { Suspense } from "react";

import { ChatDashboardRoute } from "@/app/(product)/app/_components/chat-dashboard-route/chat-dashboard-route";
import { prefetchChatHome } from "@/app/(product)/app/prefetch";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import ProductLoading from "./loading";

export default function ProductPage() {
  return (
    <Suspense fallback={<ProductLoading />}>
      <PrefetchHydration seed={prefetchChatHome}>
        <ChatDashboardRoute />
      </PrefetchHydration>
    </Suspense>
  );
}
