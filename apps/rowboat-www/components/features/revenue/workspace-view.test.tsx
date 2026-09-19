// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceView } from "@/components/revenue/workspace-view";
import { fetchRelationshipSourceStatuses } from "@/hooks/queries/utils/fetch-relationship-sources";
import { fetchRelationshipRefreshBlocker } from "@/hooks/queries/utils/fetch-workflows";
import { resyncRelationshipSource } from "@/lib/revenue";
import type { RelationshipSourceStatus } from "@/types/revenue";

vi.mock("@/components/features/connectors/connector-settings", () => ({
  ConnectorSettings: () => <div data-testid="connector-settings">Connectors</div>,
}));

vi.mock("@/hooks/queries/utils/fetch-relationship-sources", () => ({
  fetchRelationshipSourceStatuses: vi.fn(),
  loadRelationshipSourceStatuses: vi.fn(),
}));

vi.mock("@/lib/revenue", () => ({
  linkWorkspace: vi.fn(),
  relativeTime: vi.fn(),
  resyncRelationshipSource: vi.fn(),
  RevenueAPIError: class RevenueAPIError extends Error {},
}));

vi.mock("@/hooks/queries/utils/fetch-workflows", () => ({
  fetchRelationshipRefreshBlocker: vi.fn(),
  fetchWorkflowRuns: vi.fn(),
  fetchWorkflowTasks: vi.fn(),
  fetchWorkflowTemplates: vi.fn(),
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

function renderWorkspace(overrides?: Partial<React.ComponentProps<typeof WorkspaceView>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceView
        workspace={{ id: "ws-1", mode: "local", status: "active", preflightAvailable: false }}
        onLinked={vi.fn()}
        onError={vi.fn()}
        onNotice={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchRelationshipRefreshBlocker).mockResolvedValue("");
  vi.mocked(fetchRelationshipSourceStatuses).mockResolvedValue([
    {
      ...incomplete,
      connectionId: "desktop-1",
      source: "desktop_note",
      sourceAccountId: "default",
      status: "live",
      backfillPhase: "idle",
      completeness: "complete",
    },
    incomplete,
  ]);
  vi.mocked(resyncRelationshipSource).mockImplementation(async () => {
    const updated = {
      ...incomplete,
      status: "backfilling" as const,
      backfillPhase: "queued",
      completeness: "rebuilding",
    };
    vi.mocked(fetchRelationshipSourceStatuses).mockResolvedValue([
      {
        ...incomplete,
        connectionId: "desktop-1",
        source: "desktop_note",
        sourceAccountId: "default",
        status: "live",
        backfillPhase: "idle",
        completeness: "complete",
      },
      updated,
    ]);
    return updated;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceView", () => {
  it("shows an incomplete connected source and lets the user retry its sync", async () => {
    const onNotice = vi.fn();
    renderWorkspace({ onNotice });

    expect(await screen.findByText("sync incomplete")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(
      screen.getByText(/connection works, but its history is not fully synced/i),
    ).toBeVisible();
    expect(screen.getByTestId("connector-settings")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry sync" }));

    await waitFor(() =>
      expect(resyncRelationshipSource).toHaveBeenCalledWith("google", "owner@example.com"),
    );
    expect(await screen.findByText("syncing")).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith("google sync queued.");
  });

  it("distinguishes stale freshness from an incomplete history sync", async () => {
    vi.mocked(fetchRelationshipSourceStatuses).mockResolvedValue([
      { ...incomplete, status: "stale", backfillPhase: "live", completeness: "stale" },
    ]);

    renderWorkspace();

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
      vi.mocked(fetchRelationshipSourceStatuses).mockResolvedValue([
        { ...incomplete, status: "stale", backfillPhase: "live", completeness: "stale" },
      ]);
      vi.mocked(fetchRelationshipRefreshBlocker).mockResolvedValue(errorCode);

      renderWorkspace();

      expect(await screen.findByText(message)).toHaveTextContent(/reconnecting will not fix it/i);
      expect(fetchRelationshipRefreshBlocker).toHaveBeenCalled();
    },
  );
});
