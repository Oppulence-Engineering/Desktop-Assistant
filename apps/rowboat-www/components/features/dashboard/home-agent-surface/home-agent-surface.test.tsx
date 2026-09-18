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
        userName="morgan@acme.com"
        workspace="Acme"
      />,
    );

    const component = screen.getByRole("region", { name: "Home agent" });
    expect(component).toHaveAttribute("data-slot", "home-agent-surface");
    expect(screen.getByText("What should we get done, Morgan?")).toBeVisible();
    expect(component).toHaveTextContent("Acme · Revenue operator");
    expect(screen.getByText("3 promises at risk")).toBeVisible();
  });

  it("offers suggested actions to reduced-motion users on mobile", async () => {
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

    await user.click(screen.getAllByRole("button", { name: "Find a slipping promise" })[0]!);

    expect(onSelectPrompt).toHaveBeenCalledWith(expect.stringContaining("most likely to slip"));
  });
});
