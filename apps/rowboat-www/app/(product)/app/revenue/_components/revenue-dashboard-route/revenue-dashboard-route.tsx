"use client";

import "client-only";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { useProductRouteState } from "@/hooks/dashboard/use-product-route-state";

const RevenuePanel = dynamic(() =>
  import("@/components/features/revenue/revenue-panel/revenue-panel").then(
    (module) => module.RevenuePanel,
  ),
);

export type RevenueDashboardRouteProps = ComponentPropsWithoutRef<"section">;

export function RevenueDashboardRoute({ className, ...props }: RevenueDashboardRouteProps) {
  const { openRevenueTab, openSettings, revenueTab } = useProductRouteState();
  return (
    <section
      className={cn("flex-1 overflow-hidden", className)}
      data-slot="revenue-dashboard-route"
      {...props}
    >
      <RevenuePanel
        onOpenConnectors={() => {
          openSettings("connections");
        }}
        onTabChange={openRevenueTab}
        tab={revenueTab}
      />
    </section>
  );
}
