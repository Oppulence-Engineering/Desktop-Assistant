// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/json-editor", () => ({ JsonEditor: () => null }));
vi.mock("@/components/markdown-viewer", () => ({ MarkdownViewer: () => null }));
vi.mock("@/components/tiptap-markdown-editor", () => ({ TiptapMarkdownEditor: () => null }));

import { DashboardRouteContent } from "./dashboard-route-content";

describe("DashboardRouteContent", () => {
  it("provides an accessible route-owned content boundary", () => {
    render(<DashboardRouteContent aria-label="Dashboard content">Acme</DashboardRouteContent>);

    const content = screen.getByRole("region", { name: "Dashboard content" });
    expect(content).toHaveAttribute("data-slot", "dashboard-route-content");
    expect(content).toHaveTextContent("Acme");
  });
});
