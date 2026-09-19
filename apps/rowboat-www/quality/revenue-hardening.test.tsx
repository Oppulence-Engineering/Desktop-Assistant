// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OpenPromisesReport,
  RelationshipSourceStatus,
  RevenueAction,
  RevenueImpact,
  RevenueLeakScan,
} from "@/lib/revenue/types";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
}));

const mocks = vi.hoisted(() => ({
  createGoogleCommitmentsAuthorizationURL: vi.fn(),
  getDigest: vi.fn(),
  getImpact: vi.fn(),
  getOpenPromisesReport: vi.fn(),
  getScan: vi.fn(),
  listActions:
    vi.fn<(filter: string, limit?: number, signal?: AbortSignal) => Promise<RevenueAction[]>>(),
  listRelationshipSourceStatuses: vi.fn(),
  listScans: vi.fn(),
  startScan: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => navigation.params,
  usePathname: () => "/app/report",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/revenue/revenue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/revenue")>()),
  ...mocks,
}));
vi.mock("@/hooks/queries/utils/fetch-relationship-sources", () => ({
  fetchRelationshipSourceStatuses: mocks.listRelationshipSourceStatuses,
  loadRelationshipSourceStatuses: mocks.listRelationshipSourceStatuses,
}));
vi.mock("@/hooks/queries/utils/fetch-report", () => ({
  fetchReportScans: mocks.listScans,
  fetchReportScan: mocks.getScan,
  fetchOpenPromisesReport: mocks.getOpenPromisesReport,
  loadReportScans: mocks.listScans,
  loadReportScan: mocks.getScan,
  loadOpenPromisesReport: mocks.getOpenPromisesReport,
}));
vi.mock("@/hooks/queries/utils/fetch-impact", () => ({
  fetchImpact: mocks.getImpact,
  fetchDigest: mocks.getDigest,
  loadImpact: mocks.getImpact,
  loadDigest: mocks.getDigest,
}));
vi.mock("@/hooks/queries/utils/fetch-revenue-actions", () => ({
  fetchRevenueActions: (filter: string, limit?: number, signal?: AbortSignal) =>
    mocks.listActions(filter, limit, signal),
  loadRevenueActions: (request: unknown, filter: string, limit?: number, signal?: AbortSignal) =>
    mocks.listActions(filter, limit, signal),
}));
vi.mock("@/lib/api/connectors/google-oauth", () => ({
  createGoogleCommitmentsAuthorizationURL: mocks.createGoogleCommitmentsAuthorizationURL,
}));
vi.mock("@/lib/analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("@/components/features/revenue/review-sheet/review-sheet", () => ({
  ReviewSheet: () => null,
}));
vi.mock("@/components/features/revenue/audit-sheet/audit-sheet", () => ({
  AuditSheet: () => null,
}));

import { OpenPromisesReportClient } from "@/components/features/report/open-promises-report/open-promises-report";
import { ImpactView } from "@/components/features/revenue/impact-view/impact-view";
import { QueueView } from "@/components/features/revenue/queue-view/queue-view";
import { ScansView } from "@/components/features/revenue/scans-view/scans-view";

function sourceStatus(status: string, connectionId = `google-${status}`): RelationshipSourceStatus {
  return {
    connectionId,
    source: "google",
    sourceAccountId: `${connectionId}@example.com`,
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
}

function completedScan(id: string, completedAt = "2026-09-17T12:00:00Z"): RevenueLeakScan {
  return {
    id,
    status: "completed",
    mode: "local",
    lookbackDays: 90,
    startedAt: "2026-09-17T11:00:00Z",
    completedAt,
    threadsSeen: 4,
  };
}

const emptyReport: OpenPromisesReport = {
  scanId: "scan-1",
  generatedAt: "2026-09-17T12:00:00Z",
  threadsSeen: 4,
  outboundCount: 0,
  inboundCount: 0,
  truncated: false,
  items: [],
};

const action: RevenueAction = {
  id: "action-1",
  actionType: "warm_follow_up",
  channel: "email",
  detector: "warm_follow_up",
  revision: 1,
  revisionHash: "revision-1",
  reason: "Reply to the renewal thread",
  recipientEmail: "buyer@example.com",
  priorityScore: 80,
  queueStatus: "open",
  policyStatus: "passed",
  approvalStatus: "pending",
  executionStatus: "pending",
  executionOwner: "rowboat",
  executionMode: "draft",
  createdAt: "2026-09-17T11:00:00Z",
  updatedAt: "2026-09-17T11:00:00Z",
  evidence: [],
};

const impact: RevenueImpact = {
  surfaced: 1,
  open: 1,
  handled: 0,
  snoozed: 0,
  dismissed: 0,
  approved: 0,
  executed: 0,
  replied: 0,
  meetingsBooked: 0,
  won: 0,
  lost: 0,
  replyRate: null,
  meetingRate: null,
  outcomes: {},
  byDetector: [],
  relationships: 1,
  atRiskRelationships: 1,
  criticalRelationships: 0,
  portfolioRiskScore: 25,
  overdueCommitments: 0,
  overdueByUs: 0,
  overdueByThem: 0,
  longestOverdueDays: 0,
  riskReasons: [],
};

function wrapWithQuery(ui: React.ReactElement, client: QueryClient) {
  return (
    <NuqsTestingAdapter
      hasMemory
      onUrlUpdate={({ searchParams }) => {
        navigation.params = searchParams;
      }}
      searchParams={navigation.params}
    >
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    client,
    ...render(wrapWithQuery(ui, client)),
  };
}

afterEach(cleanup);

beforeEach(() => {
  navigation.params = new URLSearchParams();
  for (const mock of Object.values(mocks)) mock.mockReset();

  mocks.listRelationshipSourceStatuses.mockResolvedValue([sourceStatus("live")]);
  mocks.listScans.mockResolvedValue([]);
  mocks.getDigest.mockResolvedValue(null);
  mocks.createGoogleCommitmentsAuthorizationURL.mockResolvedValue(
    new URL("https://accounts.google.com/o/oauth2/v2/auth"),
  );
});

describe("Open Promises report hardening", () => {
  it.each([
    {
      statuses: [] as RelationshipSourceStatus[],
      action: "Connect Gmail & Calendar",
    },
    {
      statuses: [sourceStatus("reconnect_required")],
      action: "Reconnect Google",
    },
  ])(
    "starts Google authorization directly from the $action action",
    async ({ statuses, action }) => {
      mocks.listRelationshipSourceStatuses.mockResolvedValue(statuses);

      renderWithQuery(<OpenPromisesReportClient />);

      await userEvent.click(await screen.findByRole("button", { name: action }));

      expect(mocks.createGoogleCommitmentsAuthorizationURL).toHaveBeenCalledWith("/app/report");
      expect(
        screen.queryByRole("button", { name: "Find my open promises" }),
      ).not.toBeInTheDocument();
      expect(mocks.startScan).not.toHaveBeenCalled();
    },
  );

  it("shows bounded source progress and starts the first audit once after OAuth", async () => {
    navigation.params = new URLSearchParams("google_connected=1");
    mocks.listRelationshipSourceStatuses.mockResolvedValue([
      {
        ...sourceStatus("backfilling"),
        backfillPhase: "running",
        backfillCompleted: 25,
        backfillTotal: 100,
        completeness: "partial",
      },
    ]);
    mocks.startScan.mockResolvedValue({
      ...completedScan("scan-first"),
      status: "queued",
      completedAt: undefined,
    });

    const view = renderWithQuery(<OpenPromisesReportClient />);

    expect(await screen.findByText("Syncing Google evidence")).toBeInTheDocument();
    expect(screen.getByText("25 of 100 evidence records processed.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    await waitFor(() => {
      expect(mocks.startScan).toHaveBeenCalledOnce();
    });
    expect(mocks.startScan).toHaveBeenCalledWith(180);
    view.rerender(wrapWithQuery(<OpenPromisesReportClient />, view.client));
    expect(mocks.startScan).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(navigation.params.get("scan")).toBe("scan-first");
    });
  });

  it("loads a deep-linked scan, refreshes terminal health, and selects another scan in the URL", async () => {
    navigation.params = new URLSearchParams("scan=scan-deep");
    const deep = completedScan("scan-deep", "2026-09-17T12:00:00Z");
    const older = completedScan("scan-older", "2026-09-16T12:00:00Z");
    mocks.listScans.mockResolvedValue([deep, older]);
    mocks.getScan.mockImplementation((id: string) => Promise.resolve(completedScan(id)));
    mocks.getOpenPromisesReport.mockResolvedValue(emptyReport);

    renderWithQuery(<OpenPromisesReportClient />);

    expect(await screen.findByText("No open promises found")).toBeInTheDocument();
    expect(mocks.getScan).toHaveBeenCalledWith("scan-deep", expect.anything());
    await waitFor(() => {
      expect(mocks.listRelationshipSourceStatuses.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    await userEvent.selectOptions(screen.getByLabelText("Audit"), "scan-older");
    await waitFor(() => {
      expect(navigation.params.get("scan")).toBe("scan-older");
    });
  });

  it("retries a report load without restarting the completed scan", async () => {
    navigation.params = new URLSearchParams("scan=scan-1");
    mocks.listScans.mockResolvedValue([completedScan("scan-1")]);
    mocks.getScan.mockResolvedValue(completedScan("scan-1"));
    mocks.getOpenPromisesReport
      .mockRejectedValueOnce(new Error("report temporarily unavailable"))
      .mockResolvedValueOnce(emptyReport);

    renderWithQuery(<OpenPromisesReportClient />);

    expect(await screen.findByRole("heading", { name: "The report could not load" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No open promises found")).toBeInTheDocument();
    expect(mocks.getOpenPromisesReport).toHaveBeenCalledTimes(2);
    expect(mocks.startScan).not.toHaveBeenCalled();
  });
});

describe("revenue query retries", () => {
  it("retries an explicit queue load error and reloads after invalidation", async () => {
    mocks.listActions
      .mockRejectedValueOnce(new Error("queue offline"))
      .mockResolvedValueOnce([action])
      .mockResolvedValueOnce([{ ...action, reason: "Refreshed renewal thread" }]);
    const onError = vi.fn();
    const view = renderWithQuery(
      <QueueView
        onError={onError}
        onNotice={vi.fn()}
        onScan={vi.fn()}
        scanning={false}
        workspace={null}
      />,
    );

    expect(await screen.findByText("Recovery could not load")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(action.reason)).toBeVisible();

    await view.client.invalidateQueries({ queryKey: ["revenue-action"] });

    expect(await screen.findByText("Refreshed renewal thread")).toBeVisible();
    expect(mocks.listActions).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith("queue offline");
  });

  it("retries an explicit impact load error", async () => {
    mocks.getImpact
      .mockRejectedValueOnce(new Error("impact offline"))
      .mockResolvedValueOnce(impact);
    const onError = vi.fn();

    renderWithQuery(<ImpactView onError={onError} />);

    expect(await screen.findByText("Impact could not load")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Portfolio risk score")).toBeVisible();
    expect(mocks.getImpact).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith("impact offline");
  });
});

it("deep-links completed audit rows to their report", () => {
  render(
    <ScansView
      activeScan={null}
      onScan={vi.fn()}
      scanning={false}
      scans={[completedScan("scan/with space")]}
    />,
  );

  expect(screen.getByRole("link", { name: "Audit complete" })).toHaveAttribute(
    "href",
    "/app/report?scan=scan%2Fwith%20space",
  );
});
