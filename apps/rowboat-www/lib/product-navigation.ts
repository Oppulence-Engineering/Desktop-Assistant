import { z } from "zod";

export const ProductViewSchema = z.enum([
  "chat",
  "settings",
  "revenue",
  "workflows",
  "agents",
  "report",
]);

export type ProductView = z.infer<typeof ProductViewSchema>;

export const RevenueTabSchema = z.enum([
  "tasks",
  "notes",
  "commitments",
  "relationships",
  "people",
  "queue",
  "scans",
  "impact",
  "actions",
  "workspace",
]);

export type RevenueTab = z.infer<typeof RevenueTabSchema>;

export const REVENUE_TAB_LABELS: Record<RevenueTab, string> = {
  tasks: "Tasks",
  notes: "Notes",
  commitments: "Commitments",
  relationships: "Companies",
  people: "People",
  queue: "Recovery",
  scans: "Audits",
  impact: "Impact",
  actions: "Actions",
  workspace: "Sources",
};

export const SettingsSectionSchema = z.enum([
  "overview",
  "preferences",
  "notifications",
  "permissions",
  "security",
  "extensions",
  "connections",
  "advanced",
  "models",
  "customization",
  "appearance",
  "environment",
  "account",
  "connect",
  "help",
]);

export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

export const WorkflowFocusSchema = z.enum(["scheduled", "runs"]);

export type WorkflowFocus = z.infer<typeof WorkflowFocusSchema>;

export const PRODUCT_VIEW_PATHS: Record<ProductView, string> = {
  chat: "/app",
  agents: "/app/agents",
  workflows: "/app/workflows",
  revenue: "/app/revenue",
  settings: "/app/settings",
  report: "/app/report",
};

export function productViewForPathname(pathname: string): ProductView {
  const matched = Object.entries(PRODUCT_VIEW_PATHS).find(
    ([view, path]) => view !== "chat" && (pathname === path || pathname.startsWith(`${path}/`)),
  )?.[0];
  return ProductViewSchema.catch("chat").parse(matched);
}

/** Validates a revenue tab from an untrusted URL parameter. */
export function revenueTabFromParam(value: string | null | undefined): RevenueTab {
  return RevenueTabSchema.catch("commitments").parse(value);
}

/** The query string that addresses a revenue tab. Commitments is the bare path. */
export function revenueTabSearch(tab: RevenueTab): string {
  return tab === "commitments" ? "" : `?tab=${tab}`;
}

/** Validates a settings section from an untrusted URL parameter. */
export function settingsSectionFromParam(value: string | null | undefined): SettingsSection {
  // Extensions and connections previously pointed to the same screen. Keep
  // old bookmarks working while exposing one canonical navigation concept.
  if (value === "extensions") return "connections";
  // These legacy settings pages are no longer user-facing.
  if (value === "models" || value === "environment") return "overview";
  return SettingsSectionSchema.catch("overview").parse(value);
}

/** Validates workflow focus from an untrusted URL parameter. */
export function workflowFocusFromParam(value: string | null | undefined): WorkflowFocus {
  return WorkflowFocusSchema.catch("scheduled").parse(value);
}
