// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { CommitmentQueue } from "./commitment-queue";
import type { RelationshipGraph, RelationshipSourceInventoryItem } from "@/types/revenue";

afterEach(cleanup);

const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function graph(acceptance = "accepted"): RelationshipGraph {
  return {
    contractVersion: "2026-08-01",
    generatedAt: new Date().toISOString(),
    asOf: new Date().toISOString(),
    historical: false,
    scope: "portfolio",
    depth: 1,
    permissions: {
      canView: true,
      canContribute: true,
      canApprove: true,
      canExecute: true,
      canSaveViews: true,
    },
    nodes: [
      {
        id: "relationship:rel-1",
        kind: "relationship",
        label: "Acme",
        relationshipId: "rel-1",
        relationshipIds: ["rel-1"],
        changedSinceReview: false,
        changedDimensions: [],
        evidenceRefs: [],
        metadata: {},
      },
      {
        id: "person:owner",
        kind: "person",
        label: "Taylor",
        relationshipId: "rel-1",
        relationshipIds: ["rel-1"],
        changedSinceReview: false,
        changedDimensions: [],
        evidenceRefs: [],
        metadata: {},
      },
      {
        id: "commitment:commitment-1",
        kind: "commitment",
        label: "Send the signed security packet",
        relationshipId: "rel-1",
        relationshipIds: ["rel-1"],
        status: "open",
        summary: "I will send the signed security packet by Friday.",
        dueAt,
        resourceRef: "commitment-1",
        changedSinceReview: false,
        changedDimensions: [],
        evidenceRefs: ["evidence-1"],
        metadata: {
          acceptance,
          direction: "promised_by_me",
          counterpartyParticipantRef: "Morgan",
          currentEventVersion: 3,
          userConfirmed: acceptance !== "candidate",
        },
      },
    ],
    edges: [
      {
        id: "edge:owner",
        source: "person:owner",
        target: "commitment:commitment-1",
        kind: "owns",
        label: "owns",
        directed: true,
        evidenceRefs: ["evidence-1"],
      },
    ],
  };
}

const sources: RelationshipSourceInventoryItem[] = [
  {
    source: "google",
    displayName: "Google Gmail & Calendar",
    evidence: [],
    actions: [],
    readScopes: [],
    writeScopes: [],
    scopeExplanation: "Read account evidence.",
    connectPath: "/google",
    disconnectPath: "/google",
    supportsReconnect: true,
    supportsResync: true,
    expectedCadenceSeconds: 900,
    accounts: [],
  },
];

function props(overrides: Partial<ComponentProps<typeof CommitmentQueue>> = {}) {
  return {
    graph: graph(),
    sources,
    onScan: vi.fn(),
    onOpenConnectors: vi.fn(),
    onOpenAccounts: vi.fn(),
    onOpenRecoveryQueue: vi.fn(),
    onTransition: vi.fn(async () => true),
    onDraftRecovery: vi.fn(async () => true),
    ...overrides,
  };
}

describe("CommitmentQueue", () => {
  it("shows the operational promise, evidence, warning, and next action", () => {
    render(<CommitmentQueue aria-label="Client commitments" {...props()} />);

    const component = screen.getByRole("region", { name: "Client commitments" });
    expect(component).toHaveAttribute("data-slot", "commitment-queue");
    expect(component).toHaveTextContent("Send the signed security packet");
    expect(component).toHaveTextContent("Taylor");
    expect(component).toHaveTextContent("Morgan");
    expect(component).toHaveTextContent("I will send the signed security packet by Friday.");
    expect(component).toHaveTextContent("Due within 72h");
    expect(screen.getByRole("button", { name: /Run 90-day Promise Leak Audit/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Connect Gmail & Calendar/ })).toBeEnabled();
  });

  it("explains a clean audit when Google is connected", () => {
    render(
      <CommitmentQueue
        {...props({
          graph: { ...graph(), nodes: [], edges: [] },
          sources: [
            {
              ...sources[0],
              accounts: [
                {
                  connectionId: "google-1",
                  source: "google",
                  sourceAccountId: "me@gmail.com",
                  status: "live",
                  backfillPhase: "completed",
                  backfillCompleted: 1,
                  backfillTotal: 1,
                  completeness: "complete",
                  expectedCadenceSeconds: 900,
                  lagSeconds: 0,
                  retryCount: 0,
                  requiredScopes: [],
                  grantedScopes: [],
                  missingScopes: [],
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(/No explicit promises were found/)).toBeInTheDocument();
    expect(screen.queryByText(/Connect Google and run/)).not.toBeInTheDocument();
  });

  it("shows what the latest audit accomplished", () => {
    render(
      <CommitmentQueue
        {...props({
          latestScan: {
            id: "scan-1",
            status: "completed",
            mode: "linked",
            lookbackDays: 90,
            threadsSeen: 12,
            candidatesSeen: 2,
          },
        })}
      />,
    );

    expect(screen.getByText("Latest 90-day audit")).toBeInTheDocument();
    expect(screen.getByText("12", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Relationships mapped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review 1 relationship" })).toBeEnabled();
  });

  it("records confirmation and correction through transition callbacks", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn(async () => true);
    const candidate = graph("candidate");
    render(<CommitmentQueue {...props({ graph: candidate, onTransition })} />);

    await user.click(screen.getByRole("button", { name: "Confirm promise" }));
    await waitFor(() =>
      expect(onTransition).toHaveBeenCalledWith(
        expect.objectContaining({ id: "commitment-1" }),
        expect.objectContaining({
          kind: "internally_confirmed",
          idempotencyKey: "commitment-queue:internally_confirmed:commitment-1:v3",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Correct" }));
    const promise = screen.getByRole("textbox", { name: "Corrected promise" });
    await user.clear(promise);
    await user.type(promise, "Send the final security packet");
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() =>
      expect(onTransition).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "commitment-1" }),
        expect.objectContaining({
          kind: "corrected",
          action: "Send the final security packet",
          idempotencyKey: "commitment-queue:corrected:commitment-1:v3",
        }),
      ),
    );
  });
});
