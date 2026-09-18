// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RELATIONSHIP_SOURCE_STATUS_QUERY_KEY } from "@/lib/revenue";

import {
  GOOGLE_OAUTH_CONNECTED_EVENT,
  GoogleOAuthReturnHandler,
} from "./google-oauth-return-handler";

const mocks = vi.hoisted(() => ({
  dashboardFetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: mocks.dashboardFetch,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

function renderHandler(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthReturnHandler />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  window.history.replaceState(null, "", "/app/report");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/app/report");
});

describe("Google OAuth return handler", () => {
  it("claims once, clears the ticket, invalidates sources, and marks the report return", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/report?google_session=ticket-1&google_status=success",
    );
    mocks.dashboardFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(RELATIONSHIP_SOURCE_STATUS_QUERY_KEY, []);
    const connected = vi.fn();
    window.addEventListener(GOOGLE_OAUTH_CONNECTED_EVENT, connected);

    const view = renderHandler(queryClient);
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <GoogleOAuthReturnHandler />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mocks.dashboardFetch).toHaveBeenCalledOnce();
      expect(connected).toHaveBeenCalledOnce();
    });
    expect(mocks.dashboardFetch).toHaveBeenCalledWith(
      "/api/rowboat/v1/google-oauth/claim",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ session: "ticket-1" }),
      }),
    );
    expect(window.location.search).toBe("?google_connected=1");
    expect(queryClient.getQueryState(RELATIONSHIP_SOURCE_STATUS_QUERY_KEY)?.isInvalidated).toBe(
      true,
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Google connected. Your evidence sync has started.",
    );

    window.removeEventListener(GOOGLE_OAUTH_CONNECTED_EVENT, connected);
  });

  it("surfaces a canceled consent without attempting to claim it", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/report?google_session=ticket-2&google_status=error",
    );
    renderHandler(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Google authorization was not completed. Please try again.",
      );
    });
    expect(mocks.dashboardFetch).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});
