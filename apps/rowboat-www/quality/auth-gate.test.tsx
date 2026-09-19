// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserSessionResponse } from "@/lib/auth/schemas";

const authClient = vi.hoisted(() => ({
  loadBrowserSession: vi.fn(),
}));

vi.mock("@/lib/auth/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/client")>();
  return {
    ...actual,
    loadBrowserSession: authClient.loadBrowserSession,
  };
});

import { AuthGate, useAuthSession } from "@/components/auth/auth-gate";
import { SessionUnavailableError } from "@/lib/auth/client";

const initialSession: Extract<BrowserSessionResponse, { authenticated: true }> = {
  authenticated: true,
  expiresAt: 2_000_000_000,
  user: {
    id: "user-1",
    email: "operator@example.com",
    organizationId: "org-1",
    permissions: [],
  },
};

function SessionConsumer() {
  const session = useAuthSession();
  return <p>{session.user.email}</p>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthGate", () => {
  it("renders the server-verified session without a client loading flash", () => {
    authClient.loadBrowserSession.mockReturnValue(new Promise(() => undefined));

    render(
      <AuthGate initialSession={initialSession}>
        <SessionConsumer />
      </AuthGate>,
    );

    expect(screen.getByText("operator@example.com")).toBeVisible();
    expect(screen.queryByText("Checking session")).not.toBeInTheDocument();
  });

  it("keeps the server-verified session when browser refresh is transiently unavailable", async () => {
    authClient.loadBrowserSession.mockRejectedValue(new SessionUnavailableError());

    render(
      <AuthGate initialSession={initialSession}>
        <SessionConsumer />
      </AuthGate>,
    );

    await waitFor(() => {
      expect(authClient.loadBrowserSession).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("operator@example.com")).toBeVisible();
    expect(screen.queryByText("We couldn’t verify your session")).not.toBeInTheDocument();
  });
});
