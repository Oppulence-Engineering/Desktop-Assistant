// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Label } from "@oppulence/ui/components/label";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("shared UI primitive contract", () => {
  it("keeps button interaction and native semantics", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save changes</Button>);

    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toHaveAttribute("data-slot", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps labels associated with inputs", () => {
    render(
      <>
        <Label htmlFor="account-name">Account name</Label>
        <Input id="account-name" />
      </>,
    );

    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveAttribute(
      "data-slot",
      "input",
    );
  });
});
