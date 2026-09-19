import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { prefetchChatHome } from "@/app/(product)/app/prefetch";
import { prefetchReport } from "@/app/(product)/app/report/prefetch";
import { prefetchRevenue } from "@/app/(product)/app/revenue/prefetch";
import { prefetchSettings } from "@/app/(product)/app/settings/prefetch";
import { chatSessionKeys } from "@/hooks/queries/utils/chat-session-keys";
import { consoleKeys } from "@/hooks/queries/utils/console-keys";
import { impactKeys } from "@/hooks/queries/utils/impact-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
import { reportKeys } from "@/hooks/queries/utils/report-keys";
import { workspaceKeys } from "@/hooks/queries/utils/workspace-keys";

vi.mock("@/lib/api/request-json.server", () => ({
  requestUpstreamJson: vi.fn(),
}));
vi.mock("@/hooks/queries/utils/fetch-relationship-sources", () => ({
  loadRelationshipSourceStatuses: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/hooks/queries/utils/fetch-relationships", () => ({
  loadRelationships: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/hooks/queries/utils/fetch-report", () => ({
  loadReportScans: vi.fn().mockResolvedValue([]),
  loadReportScan: vi.fn().mockResolvedValue({ id: "scan-1" }),
  loadOpenPromisesReport: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@/hooks/queries/utils/fetch-impact", () => ({
  loadImpact: vi.fn().mockResolvedValue({ surfaced: 0 }),
}));
vi.mock("@/hooks/queries/utils/fetch-workspace", () => ({
  loadWorkspace: vi.fn().mockResolvedValue({ id: "ws-1" }),
}));
vi.mock("@/hooks/queries/utils/fetch-chat-sessions", () => ({
  loadChatSessions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/hooks/queries/utils/fetch-console", () => ({
  loadConsolePreferences: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/hooks/queries/utils/fetch-connectors", () => ({
  loadConnectors: vi.fn().mockResolvedValue([]),
}));

describe("RSC prefetch keys", () => {
  it("seeds the same report and source keys the client hooks read", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await prefetchReport(queryClient, "scan-1");

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toContainEqual(relationshipSourceKeys.list());
    expect(keys).toContainEqual(reportKeys.scanList());
    expect(keys).toContainEqual(reportKeys.scan("scan-1"));
    expect(keys).toContainEqual(reportKeys.document("scan-1"));
  });

  it("seeds source health for the revenue first paint", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await prefetchRevenue(queryClient);

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toContainEqual(relationshipSourceKeys.list());
    expect(keys).toContainEqual(workspaceKeys.current());
    expect(keys).toContainEqual(impactKeys.all);
    expect(keys).toContainEqual(relationshipKeys.list({}));
  });

  it("seeds home impact and chat sessions", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await prefetchChatHome(queryClient);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toContainEqual(impactKeys.all);
    expect(keys).toContainEqual(chatSessionKeys.list());
  });

  it("seeds settings preferences", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await prefetchSettings(queryClient);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toContainEqual(consoleKeys.preferences());
  });
});
