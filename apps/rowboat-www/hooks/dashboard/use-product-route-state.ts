"use client";

import "client-only";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";

import { reportParsers, reportUrlKeys } from "@/app/(product)/app/report/search-params";
import { revenueParsers, revenueUrlKeys } from "@/app/(product)/app/revenue/search-params";
import { settingsParsers, settingsUrlKeys } from "@/app/(product)/app/settings/search-params";
import { workflowParsers, workflowUrlKeys } from "@/app/(product)/app/workflows/search-params";
import {
  PRODUCT_VIEW_PATHS,
  productViewForPathname,
  revenueTabSearch,
  type ProductView,
  type RevenueTab,
  type SettingsSection,
  type WorkflowFocus,
} from "@/lib/dashboard/product-navigation";

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

function settingsSearch(section: SettingsSection): string {
  return section === "overview" ? "" : `?settings=${encodeURIComponent(section)}`;
}

function workflowSearch(focus: WorkflowFocus): string {
  return focus === "scheduled" ? "" : "?focus=runs";
}

/**
 * Pathname owns the product surface. nuqs owns shareable query state on that
 * surface. Cross-path navigation still uses the router so it cannot drop
 * unrelated params by rewriting a path template.
 */
export function useProductRouteState(): ProductRouteState {
  const pathname = usePathname();
  const router = useRouter();
  const view = productViewForPathname(pathname);
  const [revenue, setRevenue] = useQueryStates(revenueParsers, revenueUrlKeys);
  const [settings, setSettings] = useQueryStates(settingsParsers, settingsUrlKeys);
  const [workflows, setWorkflows] = useQueryStates(workflowParsers, workflowUrlKeys);

  const navigateTo = useCallback(
    (target: ProductView) => {
      const path = PRODUCT_VIEW_PATHS[target];
      if (pathname !== path) router.push(path, { scroll: false });
    },
    [pathname, router],
  );

  const openRevenueTab = useCallback(
    (tab: RevenueTab) => {
      if (view === "revenue") {
        void setRevenue({ tab });
        return;
      }
      router.push(`${PRODUCT_VIEW_PATHS.revenue}${revenueTabSearch(tab)}`, { scroll: false });
    },
    [router, setRevenue, view],
  );

  const openSettings = useCallback(
    (section: SettingsSection) => {
      if (view === "settings") {
        void setSettings({ settings: section });
        return;
      }
      router.push(`${PRODUCT_VIEW_PATHS.settings}${settingsSearch(section)}`, { scroll: false });
    },
    [router, setSettings, view],
  );

  const openWorkflows = useCallback(
    (focus: WorkflowFocus) => {
      if (view === "workflows") {
        void setWorkflows({ focus });
        return;
      }
      router.push(`${PRODUCT_VIEW_PATHS.workflows}${workflowSearch(focus)}`, { scroll: false });
    },
    [router, setWorkflows, view],
  );

  return {
    view,
    revenueTab: revenue.tab,
    settingsSection: settings.settings,
    workflowFocus: workflows.focus,
    navigateTo,
    openRevenueTab,
    openSettings,
    openWorkflows,
  };
}

export function useReportScanParam() {
  return useQueryStates(reportParsers, reportUrlKeys);
}
