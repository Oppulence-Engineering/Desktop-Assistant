import type { ReactNode } from "react";

import { SupportChat } from "@/components/features/support/support-chat";
import { QueryProvider } from "@/components/providers/query-provider";
import { requireSession } from "@/lib/auth/session";

import ProductDashboardClient from "./product-dashboard-client";

// Authentication must complete before response headers are committed so an
// anonymous direct request receives a real HTTP redirect, not an in-stream one.
export const instant = false;

export default async function ProductLayout({ children }: { children: ReactNode }) {
  await requireSession("/app");
  return (
    <QueryProvider>
      {/* The dashboard is shared route UI, so it belongs in the layout. Next
          preserves this instance while replacing the leaf page slot below. */}
      <ProductDashboardClient>{children}</ProductDashboardClient>
      {/* Signed-in users reach support without leaving the dashboard; the
          widget identifies them from the sealed session. */}
      <SupportChat />
    </QueryProvider>
  );
}
