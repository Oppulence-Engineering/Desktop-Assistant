// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GovernedActionSurface } from "./governed-action-surface";

describe("GovernedActionSurface", () => {
  it("renders a held draft with its product slot", () => {
    render(<GovernedActionSurface message="Please send the revised proposal." />);

    const surface = screen.getByRole("region", { name: "Follow-up draft" });
    expect(surface).toHaveAttribute("data-slot", "governed-action-surface");
    expect(screen.getByText("Please send the revised proposal.")).toBeInTheDocument();
    expect(screen.getByText("Held")).toBeInTheDocument();
  });
});
