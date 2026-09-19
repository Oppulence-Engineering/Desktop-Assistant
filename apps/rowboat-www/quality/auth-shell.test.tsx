// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthShell } from "@/components/auth/auth-shell";

afterEach(cleanup);

describe("AuthShell", () => {
  it("shows a useful sign-in error instead of an internal code", () => {
    render(<AuthShell error="sign_in_unavailable" mode="sign-in" returnTo="/app" />);

    expect(screen.getByText("Sign-in is temporarily unavailable. Please try again.")).toBeVisible();
    expect(screen.queryByText("sign_in_unavailable")).not.toBeInTheDocument();
  });

  it("sends Google sign-in through WorkOS with the safe return path", () => {
    render(<AuthShell mode="sign-in" returnTo="/app/settings" />);

    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      "/api/auth/workos/login?return_to=%2Fapp%2Fsettings",
    );
  });

  it("keeps the form as the only product copy", () => {
    render(<AuthShell mode="sign-up" returnTo="/app" />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Fapp",
    );
    expect(document.querySelector('img[src*="/marketing/footer-artwork/"]')).toBeTruthy();
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
    expect(screen.queryByText("Security review by Friday")).not.toBeInTheDocument();
    expect(screen.queryByText("Design partner")).not.toBeInTheDocument();
  });
});
