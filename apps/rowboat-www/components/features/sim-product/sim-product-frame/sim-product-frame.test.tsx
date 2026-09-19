// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SimProductHeader, SimProductPanel, SimProductToolbar } from "./sim-product-frame";

describe("SimProductFrame", () => {
  it("renders the panel, header, and toolbar slots", () => {
    render(
      <SimProductPanel>
        <SimProductHeader title="Accounts" />
        <SimProductToolbar>Filters</SimProductToolbar>
      </SimProductPanel>,
    );

    expect(screen.getByText("Accounts").closest("[data-slot]")).toHaveAttribute(
      "data-slot",
      "sim-product-header",
    );
    expect(document.querySelector('[data-slot="sim-product-panel"]')).toBeInTheDocument();
    expect(screen.getByText("Filters").closest("[data-slot]")).toHaveAttribute(
      "data-slot",
      "sim-product-toolbar",
    );
  });
});
