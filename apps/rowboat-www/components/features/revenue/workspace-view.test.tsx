// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkspaceView } from "@/components/revenue/workspace-view";
import { listCloudRuns } from "@/lib/cloud-workflows";
import { listRelationshipSourceStatuses, resyncRelationshipSource } from "@/lib/revenue";
import type { RelationshipSourceStatus } from "@/types/revenue";

vi.mock("@/lib/revenue", () => ({
  linkWorkspace: vi.fn(),
  listRelationshipSourceStatuses: vi.fn(),
  relativeTime: vi.fn(),
  resyncRelationshipSource: vi.fn(),
  RevenueAPIError: class RevenueAPIError extends Error {},
}));

vi.mock("@/lib/cloud-workflows", () => ({
  listCloudRuns: vi.fn(),
}));

const incomplete: RelationshipSourceStatus = {
  connectionId: "google-1",
  source: "google",
  sourceAccountId: "owner@example.com",
  status: "connected",
  backfillPhase: "failed",
  backfillCompleted: 0,
  backfillTotal: 0,
  completeness: "partial",
  expectedCadenceSeconds: 900,
  lagSeconds: 0,
  requiredScopes: [],
  grantedScopes: [],
  missingScopes: [],
  retryCount: 4,
};

beforeEach(() => {
  vi.mocked(listCloudRuns).mockResolvedValue({ runs: [] });
  vi.mocked(listRelationshipSourceStatuses).mockResolvedValue([
    {
      ...incomplete,
      connectionId: "desktop-1",
      source: "desktop_note",
      sourceAccountId: "default",
      status: "live",
      backfillPhase: "idle",
    },
    incomplete,
  ]);
  vi.mocked(resyncRelationshipSource).mockResolvedValue({
    ...incomplete,
    status: "backfilling",
    backfillPhase: "queued",
    completeness: "rebuilding",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows an incomplete connected source and lets the user retry its sync", async () => {
  const onNotice = vi.fn();
  render(
    <WorkspaceView
      workspace={{ id: "ws-1", mode: "local", status: "active", preflightAvailable: false }}
      onLinked={vi.fn()}
      onError={vi.fn()}
      onNotice={onNotice}
    />,
  );

  expect(await screen.findByText("sync incomplete")).toBeInTheDocument();
  expect(screen.getByText("live")).toBeInTheDocument();
  expect(screen.getByText(/connection works, but its history is not fully synced/i)).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Retry sync" }));

  await waitFor(() =>
    expect(resyncRelationshipSource).toHaveBeenCalledWith("google", "owner@example.com"),
  );
  expect(await screen.findByText("syncing")).toBeInTheDocument();
  expect(onNotice).toHaveBeenCalledWith("google sync queued.");
});

it("distinguishes stale freshness from an incomplete history sync", async () => {
  vi.mocked(listRelationshipSourceStatuses).mockResolvedValue([
    { ...incomplete, status: "stale", backfillPhase: "live", completeness: "stale" },
  ]);

  render(
    <WorkspaceView
      workspace={{ id: "ws-1", mode: "local", status: "active", preflightAvailable: false }}
      onLinked={vi.fn()}
      onError={vi.fn()}
      onNotice={vi.fn()}
    />,
  );

  expect(await screen.findByText("stale")).toBeInTheDocument();
  expect(
    screen.getByText(/no successful update arrived within the expected cadence/i),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Refresh now" })).toBeEnabled();
  expect(screen.queryByText("sync incomplete")).not.toBeInTheDocument();
});

it.each([
  ["workspace credits", "insufficient_credits", /out of AI credits.*still connected/i],
  ["provider credits", "upstream_credits_exhausted", /AI provider.*still connected/i],
])(
  "explains when stale automation needs %s instead of a Google reconnect",
  async (_, errorCode, message) => {
    vi.mocked(listRelationshipSourceStatuses).mockResolvedValue([
      { ...incomplete, status: "stale", backfillPhase: "live", completeness: "stale" },
    ]);
    vi.mocked(listCloudRuns).mockResolvedValue({
      runs: [
        {
          id: "run-1",
          runId: "run-1",
          previousRunId: "",
          retryOfRunId: "",
          slug: "oppulence-relationship-refresh",
          trigger: "cron",
          status: "failed",
          executor: "api",
          attempt: 1,
          requestedContext: "",
          summary: "",
          error: "insufficient credits for cloud run preflight",
          errorCode,
          errorDetails: "",
          temporalWorkflowId: "",
          progressMessage: "",
          createdAt: "2026-09-10T01:45:00Z",
          updatedAt: "2026-09-10T01:45:00Z",
          revision: 1,
        },
      ],
    });

    render(
      <WorkspaceView
        workspace={{ id: "ws-1", mode: "local", status: "active", preflightAvailable: false }}
        onLinked={vi.fn()}
        onError={vi.fn()}
        onNotice={vi.fn()}
      />,
    );

    expect(await screen.findByText(message)).toHaveTextContent(/reconnecting will not fix it/i);
    expect(listCloudRuns).toHaveBeenCalledWith({ slug: "oppulence-relationship-refresh" });
  },
);
