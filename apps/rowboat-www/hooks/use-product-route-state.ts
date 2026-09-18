"use client";

import "client-only";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  PRODUCT_VIEW_PATHS,
  productViewForPathname,
  revenueTabFromParam,
  revenueTabSearch,
  settingsSectionFromParam,
  workflowFocusFromParam,
  type ProductView,
  type RevenueTab,
  type SettingsSection,
  type WorkflowFocus,
} from "@/lib/product-navigation";

export type ProductRouteState = {
  view: ProductView;
  revenueTab: RevenueTab;
  settingsSection: SettingsSection;
  workflowFocus: WorkflowFocus;
  navigateTo: (view: ProductView) => void;
  openRevenueTab: (tab: RevenueTab) => void;
  openSettings: (section: SettingsSection) => void;
  openWorkflows: (focus: WorkflowFocus) => void;
};

/**
 * Treats the App Router URL as the single source of truth for dashboard
 * navigation. Parsing happens through Zod-backed helpers because pathname and
 * search parameters are browser-controlled inputs.
 */
export function useProductRouteState(): ProductRouteState {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const navigate = useCallback(
    (target: string) => {
      const current = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
      if (current !== target) router.push(target, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const navigateTo = useCallback(
    (view: ProductView) => navigate(PRODUCT_VIEW_PATHS[view]),
    [navigate],
  );
  const openRevenueTab = useCallback(
    (tab: RevenueTab) => navigate(`${PRODUCT_VIEW_PATHS.revenue}${revenueTabSearch(tab)}`),
    [navigate],
  );
  const openSettings = useCallback(
    (section: SettingsSection) =>
      navigate(
        `${PRODUCT_VIEW_PATHS.settings}${
          section === "overview" ? "" : `?settings=${encodeURIComponent(section)}`
        }`,
      ),
    [navigate],
  );
  const openWorkflows = useCallback(
    (focus: WorkflowFocus) =>
      navigate(`${PRODUCT_VIEW_PATHS.workflows}${focus === "runs" ? "?focus=runs" : ""}`),
    [navigate],
  );

  return {
    view: productViewForPathname(pathname),
    revenueTab: revenueTabFromParam(searchParams.get("tab")),
    settingsSection: settingsSectionFromParam(searchParams.get("settings")),
    workflowFocus: workflowFocusFromParam(searchParams.get("focus")),
    navigateTo,
    openRevenueTab,
    openSettings,
    openWorkflows,
  };
}
