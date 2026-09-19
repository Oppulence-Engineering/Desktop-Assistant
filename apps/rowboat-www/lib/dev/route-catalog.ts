import { PRODUCT_VIEW_PATHS, type ProductView } from "@/lib/dashboard/product-navigation";

export type RouteCatalogEntry = {
  path: string;
  label: string;
  segment: "product" | "marketing" | "auth" | "dev";
  auth: "public" | "session";
  clientBoundary: string;
  bffEndpoints: string[];
  e2e?: string;
  readme?: string;
};

const PRODUCT_META: Record<
  ProductView,
  Pick<RouteCatalogEntry, "label" | "clientBoundary" | "bffEndpoints" | "e2e" | "readme">
> = {
  chat: {
    label: "Chat / home",
    clientBoundary:
      "components/features/dashboard/product-dashboard-client/product-dashboard-client.tsx",
    bffEndpoints: ["/api/rowboat/v1/agent-sessions", "/api/rowboat/v1/llm/models"],
    e2e: "e2e/navigation.spec.ts",
    readme: "app/(product)/app/README.md",
  },
  agents: {
    label: "Agents",
    clientBoundary: "components/features/agents/agents-view/agents-view.tsx",
    bffEndpoints: ["/api/rowboat/v1/agents", "/api/rowboat/v1/llm/models"],
    e2e: "e2e/navigation.spec.ts",
    readme: "app/(product)/app/agents/README.md",
  },
  workflows: {
    label: "Workflows",
    clientBoundary: "components/features/workflows/cloud-workflows-view/cloud-workflows-view.tsx",
    bffEndpoints: ["/api/rowboat/v1/background-tasks", "/api/rowboat/v1/background-task-runs"],
    readme: "app/(product)/app/workflows/README.md",
  },
  revenue: {
    label: "Revenue",
    clientBoundary: "components/features/revenue/*",
    bffEndpoints: ["/api/rowboat/v1/revenue-actions", "/api/rowboat/v1/revenue-leak-scans"],
    readme: "app/(product)/app/revenue/README.md",
  },
  settings: {
    label: "Settings",
    clientBoundary: "components/features/settings/app-settings/app-settings.tsx",
    bffEndpoints: ["/api/rowboat/v1/connectors", "/api/rowboat/v1/me"],
    readme: "app/(product)/app/settings/README.md",
  },
  report: {
    label: "Open promises report",
    clientBoundary: "components/features/report/open-promises-report/open-promises-report.tsx",
    bffEndpoints: [
      "/api/rowboat/v1/relationship-sources",
      "/api/rowboat/v1/revenue-leak-scans",
      "/api/rowboat/v1/open-promises-report",
    ],
    e2e: "e2e/smoke.spec.ts",
    readme: "app/(product)/app/report/README.md",
  },
};

/** Dev route catalog for /dev/routes and onboarding docs. */
export function productRouteCatalog(): RouteCatalogEntry[] {
  return (Object.entries(PRODUCT_VIEW_PATHS) as [ProductView, string][]).map(([view, path]) => ({
    path,
    segment: "product" as const,
    auth: "session" as const,
    ...PRODUCT_META[view],
  }));
}

export const marketingRouteSamples: RouteCatalogEntry[] = [
  {
    path: "/",
    label: "Home",
    segment: "marketing",
    auth: "public",
    clientBoundary: "app/(marketing)/page.tsx (RSC)",
    bffEndpoints: [],
  },
  {
    path: "/pricing",
    label: "Pricing",
    segment: "marketing",
    auth: "public",
    clientBoundary: "app/(marketing)/pricing/page.tsx",
    bffEndpoints: [],
  },
  {
    path: "/blog",
    label: "Blog",
    segment: "marketing",
    auth: "public",
    clientBoundary: "Fumadocs MDX + editorial.ts",
    bffEndpoints: [],
  },
];

export function fullRouteCatalog(): RouteCatalogEntry[] {
  return [...productRouteCatalog(), ...marketingRouteSamples];
}
