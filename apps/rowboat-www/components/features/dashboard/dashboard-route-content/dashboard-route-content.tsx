"use client";

import "client-only";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";

export type DashboardRouteContentProps = ComponentPropsWithoutRef<"section">;

/** Shared accessible boundary for leftover dashboard panels that are not yet route-owned. */
export function DashboardRouteContent({ className, ...props }: DashboardRouteContentProps) {
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="dashboard-route-content"
      {...props}
    />
  );
}
