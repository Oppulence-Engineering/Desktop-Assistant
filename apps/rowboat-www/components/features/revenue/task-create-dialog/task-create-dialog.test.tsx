// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAction: vi.fn(),
}));

vi.mock("@/lib/revenue/revenue", () => ({
  createAction: mocks.createAction,
}));

import { TaskCreateDialog } from "@/components/features/revenue/task-create-dialog/task-create-dialog";

describe("TaskCreateDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires a linked company before saving", async () => {
    const user = userEvent.setup();

    render(
      <TaskCreateDialog
        open
        relationships={[{ id: "relationship-1", kind: "organization", displayName: "Acme" }]}
        onError={vi.fn()}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Task title"), "Follow up on renewal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Add a company before saving.");
    expect(mocks.createAction).not.toHaveBeenCalled();
  });
});
