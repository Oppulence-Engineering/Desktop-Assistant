// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileVisualWorkflow } from "@/lib/cloud-workflows";
import { VisualWorkflowBuilder } from "./visual-workflow-builder";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ReactFlow: ({ nodes }: { nodes: Array<{ data: { label: string } }> }) => (
    <div>{nodes.map((node) => node.data.label).join(" → ")}</div>
  ),
  useEdgesState: (value: unknown) => [value, vi.fn()],
  useNodesState: (value: unknown) => [value, vi.fn(), vi.fn()],
}));

afterEach(cleanup);

const workflow = {
  version: 1 as const,
  trigger: { kind: "communication" as const },
  actions: ["review-account", "draft-email"] as const,
};

describe("VisualWorkflowBuilder", () => {
  it("forwards accessible section props and renders its content", () => {
    render(
      <VisualWorkflowBuilder
        aria-label="Example visual-workflow-builder"
        onChange={vi.fn()}
        value={{ ...workflow, actions: [...workflow.actions] }}
      />,
    );

    const component = screen.getByRole("region", { name: "Example visual-workflow-builder" });
    expect(component).toHaveAttribute("data-slot", "visual-workflow-builder");
    expect(component).toHaveTextContent("Communication received");
    expect(component).toHaveTextContent("Draft recovery email");
  });

  it("removes a selected action from the persisted definition", () => {
    const onChange = vi.fn();
    render(
      <VisualWorkflowBuilder
        onChange={onChange}
        value={{ ...workflow, actions: [...workflow.actions] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Draft recovery email" }));

    expect(onChange).toHaveBeenCalledWith({
      ...workflow,
      actions: ["review-account"],
    });
  });

  it("compiles communication triggers and approval-gated actions for the real runtime", () => {
    const compiled = compileVisualWorkflow({
      ...workflow,
      actions: [...workflow.actions],
      trigger: { kind: "communication", criteria: "Customer mentions a missed deadline" },
    });

    expect(compiled.triggers).toMatchObject({
      eventMatchCriteria: "Customer mentions a missed deadline",
      workflow: { version: 1, trigger: { kind: "communication" } },
    });
    expect(compiled.instructions).toContain("connector.write.gmail_draft");
    expect(compiled.instructions).toContain("runtime approval gate");
  });
});
