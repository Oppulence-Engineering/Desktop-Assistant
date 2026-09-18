// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeAgentSurface } from "./home-agent-surface";

const onSelectPrompt = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("HomeAgentSurface", () => {
  it("forwards accessible section props and renders workspace context", () => {
    render(
      <HomeAgentSurface
        activeAgent="Revenue operator"
        aria-label="Home agent"
        onSelectPrompt={onSelectPrompt}
        promptInput={<label>Operator brief</label>}
        signalPanel={<p>3 promises at risk</p>}
        workspace="Acme"
      />,
    );

    const component = screen.getByRole("region", { name: "Home agent" });
    expect(component).toHaveAttribute("data-slot", "home-agent-surface");
    expect(component).toHaveTextContent("Acme · Revenue operator");
    expect(screen.getByText("3 promises at risk")).toBeVisible();
  });

  it("offers stable starting points to reduced-motion users", async () => {
    const user = userEvent.setup();
    render(
      <HomeAgentSurface
        activeAgent="Revenue operator"
        onSelectPrompt={onSelectPrompt}
        promptInput={<label>Operator brief</label>}
        signalPanel={null}
        workspace="Acme"
      />,
    );

    await user.click(screen.getByRole("button", { name: "slipping promise" }));

    expect(onSelectPrompt).toHaveBeenCalledWith(expect.stringContaining("most likely to slip"));
  });
});
