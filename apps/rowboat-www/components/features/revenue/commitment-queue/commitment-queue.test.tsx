// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { CommitmentQueue } from "./commitment-queue";
import type {
  RegisterEntry,
  RelationshipSourceInventoryItem,
  RevenueLeakScan,
} from "@/types/revenue";

afterEach(cleanup);

const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// The queue reads the register now, so the fixture is a register row rather
// than a relationship-graph node with edges the component had to reassemble.
function entries(acceptance: RegisterEntry["acceptance"] = "accepted"): RegisterEntry[] {
  return [
    {
      id: "commitment-1",
      direction: "promised_by_me",
      text: "Send the signed security packet",
      status: "open",
      state: "at_risk",
      relationshipId: "rel-1",
      relationshipName: "Acme",
      dueAt,
      confidence: 0.9,
      userConfirmed: acceptance !== "candidate",
      acceptance,
      ownerParticipantRef: "Taylor",
      counterpartyParticipantRef: "Morgan",
      sourcePhrase: "I will send the signed security packet by Friday.",
      currentEventVersion: 3,
    },
  ];
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

// A dead grant is a fact about the source, not only about a past scan. The
// component now asks the source before telling anyone to reconnect.
const brokenSources: RelationshipSourceInventoryItem[] = [
  {
    ...sources[0],
    accounts: [
      {
        connectionId: "google-1",
        source: "google",
        sourceAccountId: "me@gmail.com",
        status: "reconnect_required",
        backfillPhase: "failed",
        backfillCompleted: 0,
        backfillTotal: 0,
        completeness: "stale",
        expectedCadenceSeconds: 900,
        lagSeconds: 0,
        retryCount: 1,
        requiredScopes: [],
        grantedScopes: [],
        missingScopes: [],
      },
    ],
  },
];

function props(overrides: Partial<ComponentProps<typeof CommitmentQueue>> = {}) {
  return {
    entries: entries(),
    relationshipCount: 1,
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
    expect(screen.getByText("At risk")).toHaveClass("border-amber-500/40");
    expect(screen.getByRole("button", { name: /Run 90-day Promise Leak Audit/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Connect Gmail & Calendar/ })).toBeEnabled();
  });

  it("does not send a stale Google source through OAuth", () => {
    render(
      <CommitmentQueue
        {...props({
          entries: [],
          sources: [
            {
              ...sources[0],
              accounts: [
                {
                  connectionId: "google-1",
                  source: "google",
                  sourceAccountId: "me@gmail.com",
                  status: "stale",
                  backfillPhase: "completed",
                  backfillCompleted: 1,
                  backfillTotal: 1,
                  completeness: "stale",
                  expectedCadenceSeconds: 900,
                  lagSeconds: 1_801,
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
    expect(screen.getByRole("button", { name: /Google connected/ })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Connect Gmail & Calendar/ }),
    ).not.toBeInTheDocument();
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
            relationshipsCreated: 2,
          },
        })}
      />,
    );

    expect(screen.getByText("Latest 90-day audit")).toBeInTheDocument();
    expect(screen.getByText("12", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("New relationships").closest("div")).toHaveTextContent(
      "2New relationships",
    );
    expect(screen.getByRole("button", { name: "Review relationships" })).toBeEnabled();
  });

  it("asks for a scope before loading an owner view", () => {
    render(<CommitmentQueue {...props({ entries: [], owner: "", view: "by_owner" })} />);

    expect(screen.getByRole("textbox", { name: "Filter by owner" })).toBeInTheDocument();
    expect(screen.getByText("Enter an owner")).toBeInTheDocument();
    expect(screen.queryByText(/Connect Gmail and Calendar to find/)).not.toBeInTheDocument();
  });

  it("records confirmation and correction through transition callbacks", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn(async () => true);
    render(<CommitmentQueue {...props({ entries: entries("candidate"), onTransition })} />);

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

describe("when the register is empty for a reason", () => {
  const deadGrant: RevenueLeakScan = {
    id: "scan-failed",
    status: "failed",
    mode: "linked",
    lookbackDays: 90,
    threadsSeen: 0,
    candidatesSeen: 0,
    error:
      "revenue: gmail thread sweep: gmail threads.list: google api /gmail/v1/users/me/threads returned 401: Request had invalid authentication credentials.",
  };

  // The bug this replaces: a dead Google grant produced an empty register and
  // the words "Connect Gmail and Calendar", sending a user who was already
  // connected back through an OAuth flow that could not help them.
  it("names the dead grant and offers to reconnect", () => {
    render(
      <CommitmentQueue
        {...props({ entries: [], failedScan: deadGrant, sources: brokenSources })}
      />,
    );

    expect(screen.getByText("Google needs reconnecting")).toBeInTheDocument();
    expect(screen.getByText(/stopped accepting the authorization/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reconnect Google/ })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Connect Gmail & Calendar/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google connected/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect Gmail and Calendar to find/)).not.toBeInTheDocument();
  });

  // A provider outage is not the user's fault and must not send them through
  // OAuth. It offers a retry instead.
  it("offers a retry for a transient failure, not a reconnect", () => {
    render(
      <CommitmentQueue
        {...props({
          entries: [],
          failedScan: { ...deadGrant, error: "google api /gmail returned 503: Backend Error" },
        })}
      />,
    );

    expect(screen.getByText("The last audit did not finish")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run the audit again/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reconnect Google/ })).not.toBeInTheDocument();
  });

  // Mid-scan, "no promises were found" reads as a result. It is not one.
  it("says it is still reading while a scan runs", () => {
    render(<CommitmentQueue {...props({ entries: [], scanning: true })} />);

    expect(screen.getByText("Reading your last 90 days")).toBeInTheDocument();
    expect(screen.queryByText(/No explicit promises were found/)).not.toBeInTheDocument();
  });
});

// Fix 4's contract at the UI edge: when the register request fails, the panel
// passes the failure down and the queue shows it. It must never silently fall
// through to the "connect your accounts" onboarding copy, which is what a
// failed fetch used to look like.
it("shows a register failure instead of the onboarding prompt", () => {
  render(
    <CommitmentQueue
      {...props({
        entries: [],
        sources: [],
        error: "The commitment register could not be loaded.",
      })}
    />,
  );

  expect(screen.getByText("The commitment register could not be loaded.")).toBeInTheDocument();
  expect(screen.queryByText(/Connect Gmail and Calendar to find/)).not.toBeInTheDocument();
});

// Dogfooding found this: the reconnect warning only rendered on an empty
// register. With rows on screen the list still looked authoritative while it
// was quietly going out of date, and nothing said the audits had stopped.
it("keeps warning about a dead grant even when the register has rows", () => {
  render(
    <CommitmentQueue
      {...props({
        entries: entries(),
        sources: brokenSources,
        failedScan: {
          id: "scan-failed",
          status: "failed",
          mode: "linked",
          lookbackDays: 90,
          threadsSeen: 0,
          candidatesSeen: 0,
          error: "google api /gmail returned 401: Request had invalid authentication credentials.",
        },
      })}
    />,
  );

  expect(screen.getByText("Google needs reconnecting")).toBeInTheDocument();
  expect(screen.getByText(/not being updated until you reconnect/)).toBeInTheDocument();
  // The rows are still there — the warning is additive, not a replacement.
  expect(screen.getByText("Send the signed security packet")).toBeInTheDocument();
});

// The bug a real reconnect exposed: the register kept demanding another
// reconnect after the user had already done one, because it read only the old
// failed scan and never asked whether the source was working again.
it("stops demanding a reconnect once the source is healthy again", () => {
  render(
    <CommitmentQueue
      {...props({
        entries: [],
        sources,
        failedScan: {
          id: "scan-old",
          status: "failed",
          mode: "linked",
          lookbackDays: 90,
          threadsSeen: 0,
          candidatesSeen: 0,
          error: "google api /gmail returned 401: Request had invalid authentication credentials.",
        },
      })}
    />,
  );

  expect(screen.queryByRole("button", { name: /Reconnect Google/ })).not.toBeInTheDocument();
  expect(screen.getByText(/connection looks healthy now/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Run the audit again/ })).toBeInTheDocument();
});

// "90 conversations reviewed" counted every thread swept, including inbox mail
// the audit never judged. The number now reflects what was examined.
it("reports what the audit examined, not everything it swept", () => {
  render(
    <CommitmentQueue
      {...props({
        entries: entries(),
        latestScan: {
          id: "scan-cov",
          status: "completed",
          mode: "linked",
          lookbackDays: 90,
          threadsSeen: 90,
          candidatesSeen: 0,
          threadsDeepRead: 8,
          threadsSnippetOnly: 2,
          threadsSkipped: 80,
        },
      })}
    />,
  );

  // 8 deep + 2 preview = 10 examined, not 90 swept.
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.queryByText("90")).not.toBeInTheDocument();
  expect(screen.getByText("Not a conversation")).toBeInTheDocument();
  expect(screen.getByText("80")).toBeInTheDocument();
});
