// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OpenPromisesReport,
  RelationshipSourceStatus,
  RevenueAction,
  RevenueImpact,
  RevenueLeakScan,
} from "@/types/revenue";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getDigest: vi.fn(),
  getImpact: vi.fn(),
  getOpenPromisesReport: vi.fn(),
  getScan: vi.fn(),
  listActions: vi.fn(),
  listRelationshipSourceStatuses: vi.fn(),
  listScans: vi.fn(),
  startScan: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/revenue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue")>()),
  ...mocks,
}));
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("@/components/revenue/review-sheet", () => ({ ReviewSheet: () => null }));
vi.mock("@/components/revenue/audit-sheet", () => ({ AuditSheet: () => null }));

import { OpenPromisesReportClient } from "@/app/(product)/app/report/report-client";
import { ImpactView } from "@/components/revenue/impact-view";
import { QueueView } from "@/components/revenue/queue-view";
import { ScansView } from "@/components/revenue/scans-view";

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

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

afterEach(cleanup);

beforeEach(() => {
  navigation.params = new URLSearchParams();
  navigation.replace.mockReset();
  for (const mock of Object.values(mocks)) mock.mockReset();

  mocks.listRelationshipSourceStatuses.mockResolvedValue([sourceStatus("live")]);
  mocks.listScans.mockResolvedValue([]);
  mocks.getDigest.mockResolvedValue(null);
});

describe("Open Promises report hardening", () => {
  it.each([
    {
      statuses: [] as RelationshipSourceStatus[],
      action: "Connect Gmail & Calendar",
      href: "/app/settings?settings=connections",
    },
    {
      statuses: [sourceStatus("reconnect_required")],
      action: "Reconnect Google",
      href: "/app/settings?settings=connections",
    },
  ])("gates scans behind the $action source action", async ({ statuses, action, href }) => {
    mocks.listRelationshipSourceStatuses.mockResolvedValue(statuses);

    renderWithQuery(<OpenPromisesReportClient />);

    const link = await screen.findByRole("link", { name: action });
    expect(link).toHaveAttribute("href", href);
    expect(screen.queryByRole("button", { name: "Find my open promises" })).not.toBeInTheDocument();
    expect(mocks.startScan).not.toHaveBeenCalled();
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
    expect(mocks.getScan).toHaveBeenCalledWith("scan-deep");
    await waitFor(() => {
      expect(mocks.listRelationshipSourceStatuses.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    await userEvent.selectOptions(screen.getByLabelText("Audit"), "scan-older");
    expect(navigation.replace).toHaveBeenCalledWith("/app/report?scan=scan-older");
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
  it("retries an explicit queue load error and reloads when its refresh key changes", async () => {
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

    view.rerender(
      <QueryClientProvider client={view.client}>
        <QueueView
          onError={onError}
          onNotice={vi.fn()}
          onScan={vi.fn()}
          refreshKey={1}
          scanning={false}
          workspace={null}
        />
      </QueryClientProvider>,
    );

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
