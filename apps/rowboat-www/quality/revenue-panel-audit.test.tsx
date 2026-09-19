// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RelationshipSourceInventoryItem,
  RelationshipSourceStatus,
  RevenueLeakScan,
} from "@/lib/revenue/types";

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listScans: vi.fn(),
  listCommitments: vi.fn(),
  getRelationshipGraph: vi.fn(),
  listRelationshipSources: vi.fn(),
  listRelationshipSourceStatuses: vi.fn(),
  startScan: vi.fn(),
  getScan: vi.fn(),
}));

vi.mock("@/lib/revenue/revenue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/revenue")>()),
  ...mocks,
}));
vi.mock("@/hooks/queries/utils/fetch-relationship-sources", () => ({
  fetchRelationshipSourceStatuses: mocks.listRelationshipSourceStatuses,
  loadRelationshipSourceStatuses: mocks.listRelationshipSourceStatuses,
  fetchRelationshipSources: mocks.listRelationshipSources,
  loadRelationshipSources: mocks.listRelationshipSources,
}));
vi.mock("@/hooks/queries/utils/fetch-report", () => ({
  fetchReportScans: mocks.listScans,
  fetchReportScan: mocks.getScan,
  fetchOpenPromisesReport: vi.fn(),
  loadReportScans: mocks.listScans,
  loadReportScan: mocks.getScan,
  loadOpenPromisesReport: vi.fn(),
}));
vi.mock("@/hooks/queries/utils/fetch-workspace", () => ({
  fetchWorkspace: mocks.getWorkspace,
  loadWorkspace: mocks.getWorkspace,
}));
vi.mock("@/hooks/queries/utils/fetch-commitments", () => ({
  fetchCommitments: mocks.listCommitments,
  loadCommitments: mocks.listCommitments,
}));
vi.mock("@/lib/analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/analytics")>()),
  capture: vi.fn(),
}));

// These views are not under test and pull in editors and a graph that import
// CSS, which Vitest cannot load.
vi.mock("@/components/features/revenue/relationships-view/relationships-view", () => ({
  RelationshipsView: () => null,
}));
vi.mock("@/components/features/revenue/workspace-records/workspace-records-view", () => ({
  NotesView: () => null,
  PeopleView: () => null,
  TasksView: () => null,
}));
vi.mock("@/components/features/revenue/queue-view/queue-view", () => ({ QueueView: () => null }));

import { RevenuePanel } from "@/components/features/revenue/revenue-panel/revenue-panel";

function googleStatus(status: string): RelationshipSourceStatus {
  const row: RelationshipSourceStatus = {
    connectionId: "google-1",
    source: "google",
    sourceAccountId: "me@x.co",
    status,
    backfillPhase: status === "reconnect_required" ? "failed" : "live",
    backfillCompleted: 0,
    backfillTotal: 0,
    completeness: status === "reconnect_required" ? "stale" : "complete",
    expectedCadenceSeconds: 900,
    lagSeconds: 0,
    retryCount: 0,
    requiredScopes: [],
    grantedScopes: [],
    missingScopes: [],
  };
  return row;
}

function googleInventory(status: string): RelationshipSourceInventoryItem[] {
  return [
    {
      source: "google",
      displayName: "Google Gmail & Calendar",
      evidence: [],
      actions: [],
      readScopes: [],
      writeScopes: [],
      scopeExplanation: "",
      connectPath: "/google",
      disconnectPath: "/google",
      supportsReconnect: true,
      supportsResync: true,
      expectedCadenceSeconds: 900,
      accounts: [googleStatus(status)],
    },
  ] as RelationshipSourceInventoryItem[];
}

const running: RevenueLeakScan = {
  id: "scan-1",
  status: "running",
  mode: "local",
  lookbackDays: 90,
  startedAt: "2026-09-17T04:13:06Z",
};

function renderPanel(tab: "commitments" | "scans", onOpenConnectors = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RevenuePanel onOpenConnectors={onOpenConnectors} onTabChange={vi.fn()} tab={tab} />
    </QueryClientProvider>,
  );
  return onOpenConnectors;
}

afterEach(cleanup);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getWorkspace.mockResolvedValue({ id: "ws-1", mode: "local", status: "active" });
  mocks.listScans.mockResolvedValue([]);
  mocks.listCommitments.mockResolvedValue([]);
  mocks.getRelationshipGraph.mockResolvedValue({ nodes: [], edges: [] });
});

describe("revenue panel after an audit", () => {
  // The bug: the audit marked Google for reconnecting, but the page kept the
  // sources it loaded before the audit. It said "the connection looks healthy
  // now" beside the reconnect error, and the sidebar said nothing was wrong.
  it("reloads source health when an audit fails, so the page names the dead grant", async () => {
    let grantDead = false;
    mocks.listRelationshipSources.mockImplementation(() =>
      Promise.resolve(googleInventory(grantDead ? "reconnect_required" : "connected")),
    );
    mocks.listRelationshipSourceStatuses.mockImplementation(() =>
      Promise.resolve([googleStatus(grantDead ? "reconnect_required" : "connected")]),
    );
    mocks.startScan.mockResolvedValue(running);
    mocks.getScan.mockImplementation(() => {
      // The API marks the source before it finalizes the failed scan.
      grantDead = true;
      return Promise.resolve({
        ...running,
        status: "failed",
        completedAt: "2026-09-17T04:13:07Z",
        error: "Google reported invalid authentication; reconnect is required.",
      } satisfies RevenueLeakScan);
    });

    renderPanel("commitments");
    await userEvent.click(
      await screen.findByRole("button", { name: /Run 6-month Promise Leak Audit/ }),
    );

    expect(mocks.startScan).toHaveBeenCalledWith(180);
    expect(await screen.findByText("Google needs reconnecting")).toBeInTheDocument();
    expect(screen.queryByText(/connection looks healthy now/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listRelationshipSourceStatuses).toHaveBeenCalledTimes(2);
    });
  });

  // Every audit button routes through one handler. With the only Google
  // account dead, starting a scan can only fail, so it opens the fix instead.
  it("opens connections instead of starting an audit that can only fail", async () => {
    mocks.listRelationshipSourceStatuses.mockResolvedValue([googleStatus("reconnect_required")]);
    const onOpenConnectors = renderPanel("scans");

    // The header and the empty list both offer the audit; both become the fix.
    const buttons = await screen.findAllByRole("button", { name: /Reconnect Google/ });
    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Run/ })).not.toBeInTheDocument();
    await userEvent.click(buttons[0]);

    expect(onOpenConnectors).toHaveBeenCalledTimes(1);
    expect(mocks.startScan).not.toHaveBeenCalled();
  });
});
