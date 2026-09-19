// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/quality/test-support/render-query";

const mocks = vi.hoisted(() => ({
  dashboardFetch: vi.fn(),
  getPreferences: vi.fn(),
  patchPreferences: vi.fn(),
  setConsent: vi.fn(),
}));

vi.mock("@/hooks/queries/utils/fetch-console", () => ({
  fetchConsolePreferences: mocks.getPreferences,
  fetchConsoleResources: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/hooks/queries/utils/fetch-agents", () => ({
  fetchAgentSummaries: vi.fn().mockResolvedValue([{ slug: "reviewer", name: "Reviewer" }]),
}));
vi.mock("@/lib/console/console", () => ({
  patchConsolePreferences: mocks.patchPreferences,
}));
vi.mock("@/lib/analytics/analytics", () => ({
  capture: vi.fn(),
  RevenueEvents: { UpgradeClicked: "upgrade" },
  setAnalyticsConsent: mocks.setConsent,
}));
vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: mocks.dashboardFetch,
}));
vi.mock("@/components/features/connectors/connector-settings/connector-settings", () => ({
  ConnectorSettings: () => null,
}));
vi.mock("@/components/features/account/delete-account-row/delete-account-row", () => ({
  DeleteAccountRow: () => null,
}));

import { SettingsView } from "@/components/features/settings/app-settings/app-settings";

const preferences = {
  defaultAgentSlug: "reviewer",
  displayName: "Ada",
  shareUsageData: false,
};

function renderPreferences() {
  return renderWithQuery(
    <SettingsView
      onNavigate={vi.fn()}
      section="preferences"
      session={{ user: { permissions: [] } }}
    />,
  );
}

describe("synced console preferences", () => {
  beforeEach(() => {
    mocks.getPreferences.mockResolvedValue(preferences);
    mocks.patchPreferences.mockImplementation((patch: Partial<typeof preferences>) =>
      Promise.resolve({ ...preferences, ...patch }),
    );
    mocks.dashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ agents: [{ slug: "reviewer" }] })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows only preferences with real consumers", async () => {
    renderPreferences();

    expect(await screen.findByLabelText("Share anonymous usage data")).not.toBeChecked();
    expect(screen.queryByText("Memory Bank (preview)")).not.toBeInTheDocument();
    expect(screen.queryByText("Show model reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto context compaction")).not.toBeInTheDocument();
    expect(screen.queryByText("Desktop notifications")).not.toBeInTheDocument();
  });

  it("patches analytics consent and updates the capture gate", async () => {
    const user = userEvent.setup();
    renderPreferences();

    await user.click(await screen.findByLabelText("Share anonymous usage data"));

    await waitFor(() => {
      expect(mocks.patchPreferences).toHaveBeenCalledWith({ shareUsageData: true });
    });
    expect(mocks.setConsent).toHaveBeenCalledWith(true);
  });
});
