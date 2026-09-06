"use client";

import "client-only";

import * as React from "react";
import Image from "next/image";
import {
  ArrowClockwise,
  Check,
  CircleNotch,
  MagnifyingGlass,
  PencilSimple,
  Plugs,
  Warning,
  X,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { cn } from "@oppulence/ui/lib/utils";

import type {
  RelationshipGraph,
  RelationshipGraphNode,
  RelationshipSourceInventoryItem,
  RevenueLeakScan,
} from "@/types/revenue";

const THREE_DAYS = 72 * 60 * 60 * 1000;
const ACTIVE_SOURCE_STATES = new Set(["connected", "backfilling", "live"]);

export interface CommitmentQueueTransition {
  kind: string;
  idempotencyKey: string;
  reason?: string;
  dueAt?: string;
  action?: string;
  blocker?: string;
  evidenceRefs?: string[];
}

export interface CommitmentQueueItem {
  id: string;
  relationshipId: string;
  relationshipName: string;
  text: string;
  direction: string;
  owner: string;
  counterparty: string;
  dueAt?: string;
  state: string;
  quote?: string;
  missingEvidence: string[];
  nextAction: string;
  urgency: "overdue" | "due_soon" | "open" | "closed";
  currentEventVersion: number;
}

export interface CommitmentQueueProps extends Omit<
  React.ComponentPropsWithoutRef<"section">,
  "children"
> {
  graph: RelationshipGraph | null;
  sources: RelationshipSourceInventoryItem[];
  latestScan?: RevenueLeakScan | null;
  loading?: boolean;
  error?: string;
  scanning?: boolean;
  onScan: () => void;
  onOpenConnectors?: () => void;
  onOpenAccounts: () => void;
  onOpenRecoveryQueue: () => void;
  onTransition: (
    item: CommitmentQueueItem,
    transition: CommitmentQueueTransition,
  ) => Promise<boolean>;
  onDraftRecovery: (relationshipId: string) => Promise<boolean>;
}

function metadataString(node: RelationshipGraphNode, key: string) {
  const value = node.metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataNumber(node: RelationshipGraphNode, key: string) {
  const value = node.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function commitmentState(node: RelationshipGraphNode) {
  if (node.status && node.status !== "open") return node.status;
  if (metadataString(node, "blocker")) return "blocked";
  const acceptance = metadataString(node, "acceptance");
  if (acceptance) return acceptance;
  return node.metadata.userConfirmed === true ? "internally_confirmed" : "candidate";
}

function missingEvidence(node: RelationshipGraphNode, hasOwner: boolean) {
  const missing: string[] = [];
  if (!hasOwner && !metadataString(node, "ownerParticipantRef")) missing.push("promiser");
  if (
    !metadataString(node, "counterpartyParticipantRef") &&
    !metadataString(node, "beneficiaryParticipantRef")
  )
    missing.push("recipient");
  if (!node.dueAt) missing.push("due date");
  if (!node.summary?.trim()) missing.push("exact quote");
  if (node.evidenceRefs.length === 0) missing.push("supporting record");
  if (commitmentState(node) === "candidate") missing.push("confirmation");
  return missing;
}

function nextAction(state: string, missing: string[], urgency: CommitmentQueueItem["urgency"]) {
  if (state === "fulfilled") return "Closed from observed or confirmed evidence.";
  if (state === "cancelled" || state === "superseded") return "No action required.";
  if (state === "blocked") return "Resolve the blocker or renegotiate the promise.";
  if (state === "disputed") return "Clarify the promise with the counterparty.";
  if (missing.length > 0) return `Confirm or correct ${missing[0]}.`;
  if (urgency === "overdue") return "Draft a recovery message or task now.";
  if (urgency === "due_soon") return "Review and warn the owner before it is overdue.";
  return "Watch connected sources for fulfillment or a reply.";
}

export function buildCommitmentQueue(graph: RelationshipGraph, now = new Date()) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ownerByCommitment = new Map<string, RelationshipGraphNode>();
  for (const edge of graph.edges) {
    if (edge.kind === "owns") {
      const owner = nodes.get(edge.source);
      if (owner) ownerByCommitment.set(edge.target, owner);
    }
  }

  return graph.nodes
    .filter((node) => node.kind === "commitment" && node.relationshipId && node.resourceRef)
    .map((node): CommitmentQueueItem => {
      const relationship = nodes.get(`relationship:${node.relationshipId}`);
      const ownerNode = ownerByCommitment.get(node.id);
      const direction = metadataString(node, "direction");
      const beneficiaryRef = metadataString(node, "beneficiaryParticipantRef");
      const counterpartyRef = metadataString(node, "counterpartyParticipantRef");
      const relationshipName = relationship?.label || "Unknown account";
      const owner =
        ownerNode?.label ||
        metadataString(node, "ownerParticipantRef") ||
        (direction === "promised_by_me" ? "You" : relationshipName);
      const counterparty =
        beneficiaryRef ||
        (direction === "promised_by_them" ? "You" : counterpartyRef || relationshipName);
      const state = commitmentState(node);
      const due = node.dueAt ? new Date(node.dueAt).getTime() : undefined;
      const closed = ["fulfilled", "cancelled", "superseded"].includes(state);
      const urgency: CommitmentQueueItem["urgency"] = closed
        ? "closed"
        : due !== undefined && due < now.getTime()
          ? "overdue"
          : due !== undefined && due <= now.getTime() + THREE_DAYS
            ? "due_soon"
            : "open";
      const missing = missingEvidence(node, Boolean(ownerNode));
      return {
        id: node.resourceRef!,
        relationshipId: node.relationshipId!,
        relationshipName,
        text: node.label,
        direction,
        owner,
        counterparty,
        dueAt: node.dueAt,
        state,
        quote: node.summary,
        missingEvidence: missing,
        nextAction: nextAction(state, missing, urgency),
        urgency,
        currentEventVersion: metadataNumber(node, "currentEventVersion"),
      };
    })
    .sort((left, right) => {
      const urgency = { overdue: 0, due_soon: 1, open: 2, closed: 3 };
      return (
        urgency[left.urgency] - urgency[right.urgency] ||
        (left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER) -
          (right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER) ||
        left.relationshipName.localeCompare(right.relationshipName)
      );
    });
}

function sourceConnected(source: RelationshipSourceInventoryItem | undefined) {
  return Boolean(
    source?.accounts.some(
      (account) => ACTIVE_SOURCE_STATES.has(account.status) && account.missingScopes.length === 0,
    ),
  );
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    candidate: "Needs confirmation",
    internally_confirmed: "Confirmed",
    offered: "Offered",
    accepted: "Accepted",
    disputed: "Disputed",
    blocked: "Blocked",
    fulfilled: "Fulfilled",
    cancelled: "Cancelled",
    superseded: "Superseded",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CommitmentQueue({
  className,
  graph,
  sources,
  latestScan,
  loading = false,
  error,
  scanning = false,
  onScan,
  onOpenConnectors,
  onOpenAccounts,
  onOpenRecoveryQueue,
  onTransition,
  onDraftRecovery,
  ...props
}: CommitmentQueueProps) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("active");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<CommitmentQueueItem | null>(null);
  const [editing, setEditing] = React.useState<CommitmentQueueItem | null>(null);
  const [correctedText, setCorrectedText] = React.useState("");
  const [correctedDueAt, setCorrectedDueAt] = React.useState("");
  const items = React.useMemo(() => (graph ? buildCommitmentQueue(graph) : []), [graph]);
  const relationshipCount = graph?.nodes.filter((node) => node.kind === "relationship").length ?? 0;
  const filtered = items.filter((item) => {
    if (filter === "review" && item.missingEvidence.length === 0) return false;
    if (filter === "due" && item.urgency !== "overdue" && item.urgency !== "due_soon") return false;
    if (filter === "closed" && item.urgency !== "closed") return false;
    if (filter === "active" && item.urgency === "closed") return false;
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      `${item.relationshipName} ${item.owner} ${item.counterparty} ${item.text}`
        .toLowerCase()
        .includes(needle)
    );
  });
  const google = sources.find((source) => source.source === "google");
  const needsReview = items.filter(
    (item) => item.urgency !== "closed" && item.missingEvidence.length > 0,
  ).length;
  const openPromises = items.filter((item) => item.urgency !== "closed").length;
  const dueSoon = items.filter(
    (item) => item.urgency === "overdue" || item.urgency === "due_soon",
  ).length;

  const transition = async (
    item: CommitmentQueueItem,
    kind: string,
    extra: Partial<CommitmentQueueTransition> = {},
  ) => {
    setBusy(`${item.id}:${kind}`);
    try {
      return await onTransition(item, {
        kind,
        idempotencyKey: `commitment-queue:${kind}:${item.id}:v${item.currentEventVersion}`,
        reason: `Reviewed from the Commitment Queue (${statusLabel(kind)}).`,
        ...extra,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      data-slot="commitment-queue"
      className={cn("relative flex min-h-full w-full min-w-0 flex-col", className)}
      {...props}
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary/35" />
          <Input
            aria-label="Search commitments"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commitments"
            className="h-8 border-border bg-background pl-8 text-[13px]"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-40" aria-label="Filter commitments">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="app-shell rounded-md">
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="review">Needs review</SelectItem>
            <SelectItem value="due">Due soon or overdue</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="hidden 2xl:inline-flex"
          onClick={onOpenRecoveryQueue}
        >
          Recovery drafts
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {!sourceConnected(google) ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenConnectors}>
              <Plugs /> Connect Gmail &amp; Calendar
            </Button>
          ) : (
            <button
              className="hidden h-8 items-center gap-1.5 text-[12px] text-emerald-400 2xl:flex"
              onClick={onOpenAccounts}
              type="button"
            >
              <span className="size-1.5 rounded-full bg-emerald-400" /> Google connected
            </button>
          )}
          <Button
            type="button"
            size="sm"
            className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
            onClick={onScan}
            disabled={scanning}
          >
            {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />}
            <span className="hidden xl:inline">
              {scanning ? "Scanning 90 days" : "Run 90-day Promise Leak Audit"}
            </span>
            <span className="xl:hidden">{scanning ? "Scanning" : "Run audit"}</span>
          </Button>
        </div>
        <div
          className="hidden items-center gap-4 text-[11px] text-primary/45 2xl:flex"
          aria-label="Commitment summary"
        >
          <span>
            <b className="font-medium text-primary">{openPromises}</b> open
          </span>
          <span>
            <b className="font-medium text-primary">{needsReview}</b> review
          </span>
          <span>
            <b className="font-medium text-primary">{dueSoon}</b> due soon
          </span>
          <span>
            <b className="font-medium text-primary">
              {items.filter((item) => item.state === "fulfilled").length}
            </b>{" "}
            fulfilled
          </span>
        </div>
      </div>

      {latestScan?.status === "completed" ? (
        <div className="flex min-h-12 items-center gap-4 border-b border-border bg-background-50 px-3 text-[12px] text-primary/55">
          <span className="font-medium text-primary">
            Latest {latestScan.lookbackDays}-day audit
          </span>
          <dl className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <dd className="font-medium text-primary">{latestScan.threadsSeen ?? 0}</dd>
              <dt>Conversations reviewed</dt>
            </div>
            <div className="flex items-center gap-1.5">
              <dd className="font-medium text-primary">{relationshipCount}</dd>
              <dt>Relationships mapped</dt>
            </div>
            <div className="hidden items-center gap-1.5 lg:flex">
              <dd className="font-medium text-primary">{latestScan.candidatesSeen ?? 0}</dd>
              <dt>Follow-up signals</dt>
            </div>
          </dl>
          {relationshipCount > 0 ? (
            <Button
              className="ml-auto h-7"
              onClick={onOpenAccounts}
              size="sm"
              type="button"
              variant="outline"
            >
              Review {relationshipCount}{" "}
              {relationshipCount === 1 ? "relationship" : "relationships"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-primary/55">
          <CircleNotch className="animate-spin" /> Loading commitments…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[520px] flex-1 flex-col items-center px-6 pt-[84px] text-center">
          <Image
            alt=""
            aria-hidden="true"
            className="mb-4 h-[150px] w-[225px] object-cover opacity-90"
            height={160}
            priority
            src="/marketing/relationship-system/commitment-queue-empty-v2.png"
            width={240}
          />
          <h2 className="text-[20px] font-semibold leading-6 text-primary">
            {items.length === 0 ? "Commitment Queue" : "No commitments match this view"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-primary/55">
            {items.length === 0
              ? sourceConnected(google)
                ? "No explicit promises were found. Run another audit after new conversations or import reviewed meeting evidence."
                : "Connect Gmail and Calendar to find who promised what, when it is due, and the exact evidence behind it."
              : "Change the filter or search query."}
          </p>
          {items.length === 0 ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {!sourceConnected(google) ? (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#3478f6] text-white"
                  onClick={onOpenConnectors}
                >
                  <Plugs /> Connect Gmail &amp; Calendar
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#3478f6] text-white"
                  onClick={onScan}
                  disabled={scanning}
                >
                  <MagnifyingGlass /> Run 90-day audit
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={onOpenAccounts}>
                Import meeting evidence
              </Button>
            </div>
          ) : null}
          {items.length === 0 ? (
            <div className="mb-4 mt-auto w-full max-w-[640px] text-left">
              <p className="mb-2 text-[12px] text-primary/45">Learn more</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  className="flex h-[72px] items-center gap-3 rounded-lg border border-border bg-background-50 px-3 text-left text-[13px] text-primary/80 transition-colors hover:bg-background-100"
                  onClick={onOpenAccounts}
                  type="button"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary/45">
                    <Check className="size-4" />
                  </span>
                  Confirm promises with exact evidence
                </button>
                <button
                  className="flex h-[72px] items-center gap-3 rounded-lg border border-border bg-background-50 px-3 text-left text-[13px] text-primary/80 transition-colors hover:bg-background-100"
                  onClick={onOpenRecoveryQueue}
                  type="button"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary/45">
                    <ArrowClockwise className="size-4" />
                  </span>
                  Approve recovery before anything is sent
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-w-0 flex-1 overflow-auto">
          <table
            className="w-full min-w-[1040px] border-collapse text-left"
            aria-label="Commitments"
          >
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="h-10 border-b border-border text-[12px] font-medium text-primary/55">
                <th className="w-10 border-r border-border px-3">
                  <input
                    aria-label="Select all commitments"
                    className="size-4 accent-[#3478f6]"
                    type="checkbox"
                  />
                </th>
                <th className="min-w-[330px] border-r border-border px-3">Commitment</th>
                <th className="w-36 border-r border-border px-3">Promised by</th>
                <th className="w-36 border-r border-border px-3">To</th>
                <th className="w-44 border-r border-border px-3">Due date</th>
                <th className="w-40 border-r border-border px-3">Status</th>
                <th className="w-36 px-3">Next step</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="group border-b border-border hover:bg-background-100/70"
                >
                  <td className="border-r border-border px-3">
                    <label className="flex items-center" htmlFor={`commitment-${item.id}`}>
                      <span className="sr-only">Select {item.text}</span>
                      <input
                        aria-label={`Select ${item.text}`}
                        className="size-4 accent-[#3478f6]"
                        id={`commitment-${item.id}`}
                        type="checkbox"
                      />
                    </label>
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    <button
                      aria-label={`Open ${item.text}`}
                      className="block w-full min-w-0 text-left"
                      onClick={() => setSelected(item)}
                      type="button"
                    >
                      <span className="block truncate text-[13px] font-medium text-primary">
                        {item.text}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-primary/45">
                        {item.relationshipName} · {item.quote ? `“${item.quote}”` : item.nextAction}
                      </span>
                    </button>
                  </td>
                  <td className="truncate border-r border-border px-3 text-[13px] text-primary/70">
                    {item.owner}
                  </td>
                  <td className="truncate border-r border-border px-3 text-[13px] text-primary/70">
                    {item.counterparty}
                  </td>
                  <td className="border-r border-border px-3 text-[12px] text-primary/60">
                    {item.dueAt ? (
                      new Date(item.dueAt).toLocaleString()
                    ) : (
                      <span className="text-amber-400">Due date missing</span>
                    )}
                  </td>
                  <td className="border-r border-border px-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge state={item.state} />
                      {item.urgency === "overdue" || item.urgency === "due_soon" ? (
                        <span
                          className={cn(
                            "text-[11px]",
                            item.urgency === "overdue" ? "text-red-400" : "text-amber-400",
                          )}
                        >
                          {item.urgency === "overdue" ? "Overdue" : "Due within 72h"}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      {item.state === "candidate" ? (
                        <ActionButton
                          busy={busy === `${item.id}:internally_confirmed`}
                          disabled={busy !== null}
                          className="h-7 px-2 text-[12px]"
                          onClick={() => void transition(item, "internally_confirmed")}
                        >
                          <Check /> Confirm promise
                        </ActionButton>
                      ) : (
                        <button
                          className="truncate text-left text-[12px] text-primary/55 hover:text-primary"
                          onClick={() => setSelected(item)}
                          type="button"
                        >
                          {item.urgency === "overdue" || item.urgency === "due_soon"
                            ? "Review now"
                            : "Open"}
                        </button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[12px]"
                        disabled={busy !== null}
                        onClick={() => {
                          setEditing(item);
                          setCorrectedText(item.text);
                          setCorrectedDueAt(localDateTime(item.dueAt));
                        }}
                      >
                        <PencilSimple /> Correct
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="fixed inset-y-0 right-0 z-40 flex bg-background md:left-[274px]">
          <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-background">
            <div className="flex h-12 items-center gap-2 border-b border-border px-3">
              <button
                className="flex size-8 items-center justify-center rounded-md text-primary/50 hover:bg-background-100 hover:text-primary"
                onClick={() => setSelected(null)}
                type="button"
                aria-label="Close commitment"
              >
                <X className="size-4" />
              </button>
              <span className="text-[12px] text-primary/45">Commitment record</span>
            </div>
            <div className="border-b border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3478f6] text-white">
                  <Plugs className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-medium leading-5 text-primary">
                    {selected.relationshipName}
                  </h2>
                  <p className="mt-1 text-[12px] text-primary/50">{selected.text}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(selected.urgency === "overdue" || selected.urgency === "due_soon") &&
                selected.state !== "candidate" ? (
                  <Button
                    type="button"
                    size="sm"
                    className="bg-[#3478f6] text-white"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(`${selected.id}:recovery`);
                      try {
                        await onDraftRecovery(selected.relationshipId);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === `${selected.id}:recovery` ? (
                      <CircleNotch className="animate-spin" />
                    ) : (
                      <ArrowClockwise />
                    )}
                    Draft recovery
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(selected);
                    setCorrectedText(selected.text);
                    setCorrectedDueAt(localDateTime(selected.dueAt));
                  }}
                >
                  <PencilSimple /> Correct
                </Button>
              </div>
            </div>
            <div className="p-4">
              <p className="mb-4 text-[12px] font-medium text-primary/55">Record details</p>
              <dl className="space-y-4 text-[13px]">
                <Fact label="Promised by" value={selected.owner} />
                <Fact label="To" value={selected.counterparty} />
                <Fact
                  label="Due date"
                  value={selected.dueAt ? new Date(selected.dueAt).toLocaleString() : "Missing"}
                />
                <div>
                  <dt className="text-[12px] text-primary/45">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge state={selected.state} />
                  </dd>
                </div>
                <Fact
                  label="Evidence missing"
                  value={
                    selected.missingEvidence.length
                      ? selected.missingEvidence.join(", ")
                      : "Nothing"
                  }
                />
              </dl>
            </div>
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="flex h-12 items-center gap-2 border-b border-border px-4">
              <span className="rounded-md bg-background-200 px-3 py-1.5 text-[13px] font-medium text-primary">
                Overview
              </span>
              <span className="px-2 text-[13px] text-primary/45">Evidence</span>
              <span className="px-2 text-[13px] text-primary/45">Activity</span>
            </div>
            <div className="mx-auto max-w-4xl p-6">
              <h3 className="text-sm font-medium text-primary/60">Highlights</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <DetailCard
                  label="Urgency"
                  value={
                    selected.urgency === "due_soon"
                      ? "Due within 72h"
                      : statusLabel(selected.urgency)
                  }
                />
                <DetailCard label="Promise status" value={statusLabel(selected.state)} />
                <DetailCard
                  label="Evidence completeness"
                  value={
                    selected.missingEvidence.length
                      ? `${selected.missingEvidence.length} items missing`
                      : "Complete"
                  }
                />
                <DetailCard label="Owner" value={selected.owner} />
                <DetailCard label="Recipient" value={selected.counterparty} />
                <DetailCard
                  label="Due"
                  value={
                    selected.dueAt ? new Date(selected.dueAt).toLocaleDateString() : "Not confirmed"
                  }
                />
              </div>
              <section className="mt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-primary/60">Supporting evidence</h3>
                  <span className="text-[12px] text-primary/40">Exact quote</span>
                </div>
                <blockquote className="mt-3 rounded-lg border border-border bg-background-50 p-4 text-[14px] leading-6 text-primary/75">
                  {selected.quote ? `“${selected.quote}”` : "No exact quote is attached yet."}
                </blockquote>
              </section>
              <section className="mt-8">
                <h3 className="text-sm font-medium text-primary/60">Next action</h3>
                <div className="mt-3 rounded-lg border border-border p-4">
                  <p className="text-[14px] text-primary">{selected.nextAction}</p>
                  {selected.missingEvidence.length > 0 ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-400">
                      <Warning /> Missing {selected.missingEvidence.join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selected.state === "candidate" ? (
                      <ActionButton
                        busy={busy === `${selected.id}:internally_confirmed`}
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "internally_confirmed")}
                      >
                        <Check /> Confirm promise
                      </ActionButton>
                    ) : null}
                    {["internally_confirmed", "offered", "disputed"].includes(selected.state) ? (
                      <ActionButton
                        busy={busy === `${selected.id}:accepted`}
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "accepted")}
                      >
                        <Check /> Mark accepted
                      </ActionButton>
                    ) : null}
                    {selected.state === "accepted" || selected.state === "offered" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "disputed")}
                      >
                        Mark disputed
                      </Button>
                    ) : null}
                    {selected.state === "accepted" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          const blocker = window.prompt("What is blocking this commitment?");
                          if (blocker?.trim())
                            void transition(selected, "blocked", { blocker: blocker.trim() });
                        }}
                      >
                        Mark blocked
                      </Button>
                    ) : null}
                    {selected.state === "blocked" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "unblocked")}
                      >
                        Unblock
                      </Button>
                    ) : null}
                    {["internally_confirmed", "accepted", "blocked"].includes(selected.state) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm("Mark this commitment fulfilled?"))
                            void transition(selected, "fulfilled");
                        }}
                      >
                        Mark fulfilled
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="app-shell rounded-[2px] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct commitment</DialogTitle>
            <DialogDescription>
              The correction is recorded as a new immutable event; the supporting quote is
              preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-xs text-primary/60">
            <p>Promise</p>
            <Input
              aria-label="Corrected promise"
              value={correctedText}
              onChange={(event) => setCorrectedText(event.target.value)}
            />
          </div>
          <div className="space-y-1 text-xs text-primary/60">
            <p>Due date</p>
            <Input
              type="datetime-local"
              aria-label="Corrected due date"
              value={correctedDueAt}
              onChange={(event) => setCorrectedDueAt(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!correctedText.trim() || busy !== null}
              onClick={() => {
                if (!editing) return;
                void transition(editing, "corrected", {
                  action: correctedText.trim(),
                  dueAt: correctedDueAt ? new Date(correctedDueAt).toISOString() : undefined,
                  reason: "User corrected the extracted commitment in the Commitment Queue.",
                }).then((saved) => saved && setEditing(null));
              }}
            >
              {busy === `${editing?.id}:corrected` ? (
                <CircleNotch className="animate-spin" />
              ) : null}
              Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-24 rounded-lg border border-border bg-background-50 p-3">
      <p className="text-[12px] text-primary/45">{label}</p>
      <p className="mt-5 text-[14px] font-medium text-primary">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-primary/40">{label}</dt>
      <dd className="mt-1 text-primary/70">{value}</dd>
    </div>
  );
}

function StatusBadge({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-[2px] capitalize",
        state === "fulfilled" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
        state === "blocked" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
        state === "disputed" && "border-red-500/40 text-red-600 dark:text-red-400",
      )}
    >
      {statusLabel(state)}
    </Badge>
  );
}

function ActionButton({
  busy,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy: boolean }) {
  return (
    <Button type="button" size="sm" {...props}>
      {busy ? <CircleNotch className="animate-spin" /> : children}
    </Button>
  );
}
