// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DashboardRouteProvider,
  useDashboardRouteContext,
  type DashboardRouteContextValue,
} from "./dashboard-route-context";

describe("DashboardRouteContent", () => {
  it("provides route-owned content with the persistent shell state it needs", () => {
    const value = {
      chat: { workspace: "Acme" },
      agents: {},
      revenue: {},
      settings: {},
      workflows: {},
    } as DashboardRouteContextValue;
    function TestRoute() {
      return <div>{useDashboardRouteContext().chat.workspace}</div>;
    }
    render(
      <DashboardRouteProvider value={value}>
        <TestRoute />
      </DashboardRouteProvider>,
    );

    expect(screen.getByText("Acme")).toBeVisible();
  });
});
