// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Report</div>,
}));

import { ReportDashboardRoute } from "./report-dashboard-route";

describe("ReportDashboardRoute", () => {
  it("forwards accessible section props and renders its content", () => {
    render(<ReportDashboardRoute aria-label="Report">Content</ReportDashboardRoute>);

    const route = screen.getByRole("region", { name: "Report" });
    expect(route).toHaveAttribute("data-slot", "report-dashboard-route");
    expect(route).toHaveTextContent("Report");
  });
});
