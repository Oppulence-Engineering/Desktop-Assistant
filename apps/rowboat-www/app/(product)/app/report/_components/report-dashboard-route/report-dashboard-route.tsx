"use client";

import "client-only";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";

const OpenPromisesReportClient = dynamic(() =>
  import("@/components/features/report/open-promises-report/open-promises-report").then(
    (module) => module.OpenPromisesReportClient,
  ),
);

export type ReportDashboardRouteProps = ComponentPropsWithoutRef<"section">;

export function ReportDashboardRoute({ className, ...props }: ReportDashboardRouteProps) {
  return (
    <section
      className={cn("flex-1 overflow-y-auto", className)}
      data-slot="report-dashboard-route"
      {...props}
    >
      <OpenPromisesReportClient />
    </section>
  );
}
