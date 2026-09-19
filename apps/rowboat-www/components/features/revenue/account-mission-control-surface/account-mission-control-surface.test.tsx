// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountMissionControlSurface } from "./account-mission-control-surface";

describe("AccountMissionControlSurface", () => {
  it("renders an empty account timeline with its product slot", () => {
    render(<AccountMissionControlSurface accountName="Acme" items={[]} />);

    const surface = screen.getByRole("region", { name: "Acme" });
    expect(surface).toHaveAttribute("data-slot", "account-mission-control-surface");
    expect(screen.getByText("No commitments recorded for this account yet.")).toBeInTheDocument();
  });
});
