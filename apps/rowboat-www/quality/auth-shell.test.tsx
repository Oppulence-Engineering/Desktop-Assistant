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
});
