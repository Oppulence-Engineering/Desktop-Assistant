// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttentionQueueSurface } from "./attention-queue-surface";

describe("AttentionQueueSurface", () => {
  it("renders the attention queue with its product slot", () => {
    render(
      <AttentionQueueSurface
        items={[
          {
            evidenceRefs: [],
            explanation: "No reply in 14 days",
            id: "attn-1",
            rankFactors: {},
            rankScore: 0.8,
            reasonCode: "quiet_account",
            relationshipId: "rel-1",
            relationshipName: "Acme",
            sourceRequirements: [],
            status: "open",
            triggeringObjectRef: "rel-1",
            urgencyBand: "high",
            version: 1,
          },
        ]}
        onActionError={vi.fn()}
        onChanged={vi.fn()}
        onOpenRelationship={vi.fn()}
      />,
    );

    const surface = screen.getByRole("region", { name: "Attention queue" });
    expect(surface).toHaveAttribute("data-slot", "attention-queue-surface");
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByText("No reply in 14 days")).toBeInTheDocument();
  });
});
