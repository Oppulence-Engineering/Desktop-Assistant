"use client";

import "client-only";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { useAuthSession } from "@/components/auth-gate";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import type { SettingsSection } from "@/lib/product-navigation";

const SettingsView = dynamic(() =>
  import("@/components/app-settings").then((module) => module.SettingsView),
);

export type SettingsDashboardRouteProps = ComponentPropsWithoutRef<"section"> & {
  section: SettingsSection;
};

export function SettingsDashboardRoute({
  className,
  section,
  ...props
}: SettingsDashboardRouteProps) {
  const session = useAuthSession();
  const { openSettings } = useProductRouteState();
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="settings-dashboard-route"
      {...props}
    >
      <SettingsView onNavigate={openSettings} section={section} session={session} />
    </section>
  );
}
