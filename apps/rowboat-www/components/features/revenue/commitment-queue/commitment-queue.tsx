"use client";

import "client-only";

import * as React from "react";
import {
  ArrowClockwise,
  Check,
  Export,
  MagnifyingGlass,
  PencilSimple,
  Plugs,
  Warning,
  X,
} from "@/lib/icons";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Avatar, AvatarFallback } from "@oppulence/ui/components/avatar";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@oppulence/ui/components/card";
import { Label } from "@oppulence/ui/components/label";
import { Spinner } from "@oppulence/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@oppulence/ui/components/tabs";
import type { AppendCommitmentTransitionInput } from "@/hooks/queries/utils/mutate-append-commitment-transition";
import { REVENUE_EVIDENCE_LOOKBACK_LABEL } from "@/lib/revenue/revenue";
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
import { Badge as SimBadge, Chip } from "@sim/emcn";
import {
  Columns3,
  ListFilter,
  Plus,
  Table as TableIcon,
  TagIcon,
  TypeNumber,
  TypeText,
} from "@sim/emcn/icons";
import { WorkspaceEmptyIllustration } from "@/components/features/revenue/shared/shared";
import {
  SimProductHeader,
  SimProductPanel,
  SimProductToolbar,
} from "@/components/features/sim-product/sim-product-frame/sim-product-frame";

import type { RegisterView } from "@/lib/revenue/commitment-register-filter";
import type {
  RegisterEntry,
  RelationshipSourceInventoryItem,
  RevenueLeakScan,
} from "@/lib/revenue/types";

export type { RegisterView } from "@/lib/revenue/commitment-register-filter";
export { registerFilterFor } from "@/lib/revenue/commitment-register-filter";

const THREE_DAYS = 72 * 60 * 60 * 1000;
const ACTIVE_SOURCE_STATES = new Set(["connected", "backfilling", "live", "stale"]);

export interface CommitmentQueueTransition {
  kind: AppendCommitmentTransitionInput["kind"];
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
  /** The register state a reader sees: open, at_risk, met, missed, waived… */
  state: string;
  /** Where the promise sits in the confirm/offer/accept chain. A separate axis
   *  from state: a commitment can be accepted AND at risk. */
  acceptance: string;
  blocker?: string;
  quote?: string;
  missingEvidence: string[];
  nextAction: string;
  urgency: "overdue" | "due_soon" | "open" | "closed";
  confidence: number;
  currentEventVersion: number;
}

/** The five views of the commitment register (one-pager §3). Each one is a
 *  different query against GET /v1/commitments, not a different screen. */

export const REGISTER_VIEWS: { id: RegisterView; label: string; hint: string }[] = [
  { id: "we_owe", label: "What we owe", hint: "Outbound obligations by risk, then by date." },
  {
    id: "they_owe",
    label: "What they owe us",
    hint: "Inbound obligations. The view no other tool offers.",
  },
  {
    id: "changed",
    label: "What changed",
    hint: "New commitments and slippage since the last review.",
  },
  {
    id: "by_account",
    label: "By account",
    hint: "The full two-sided history for one relationship.",
  },
  {
    id: "by_owner",
    label: "By owner",
    hint: "What each person has promised. Used for load and handover.",
  },
];

export interface CommitmentQueueProps extends Omit<
  React.ComponentPropsWithoutRef<"section">,
  "children"
> {
  /** Register rows from GET /v1/commitments. */
  entries: RegisterEntry[];
  view?: RegisterView;
  onViewChange?: (view: RegisterView) => void;
  /** Fetches the Markdown record a user forwards. */
  onExport?: (item: CommitmentQueueItem) => Promise<void>;
  /** Accounts in the workspace, for the "no accounts yet" empty state. */
  relationshipCount?: number;
  accounts?: { id: string; label: string }[];
  accountId?: string;
  onAccountChange?: (relationshipId: string) => void;
  owner?: string;
  onOwnerChange?: (owner: string) => void;
  onIncludeCandidatesChange?: (include: boolean) => void;
  sources: RelationshipSourceInventoryItem[];
  latestScan?: RevenueLeakScan | null;
  /** The most recent audit that failed, when it is newer than the last success.
   *  A failed audit is the reason the register is empty, so it belongs here
   *  rather than only on the audits screen. */
  failedScan?: RevenueLeakScan | null;
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

// The register already carries direction, owner, counterparty, the derived
// state and the account name, so the queue no longer reconstructs commitments
// from relationship-graph nodes and edges. That reconstruction could not page,
// could not filter server-side, and could not answer "by owner" at all.

function missingEvidence(entry: RegisterEntry) {
  const missing: string[] = [];
  if (!entry.ownerParticipantRef?.trim()) missing.push("promiser");
  if (!entry.counterpartyParticipantRef?.trim() && !entry.beneficiaryParticipantRef?.trim()) {
    missing.push("recipient");
  }
  if (!entry.dueAt) missing.push("due date");
  if (!entry.sourcePhrase?.trim()) missing.push("exact quote");
  if (entry.acceptance === "candidate") missing.push("confirmation");
  return missing;
}

function nextAction(
  state: string,
  missing: string[],
  urgency: CommitmentQueueItem["urgency"],
  blocked = false,
) {
  if (state === "met") return "Closed from observed or confirmed evidence.";
  if (state === "waived") return "Released by the counterparty. No action required.";
  if (state === "cancelled" || state === "superseded") return "No action required.";
  if (state === "missed") return "Acknowledge with the counterparty or renegotiate.";
  if (state === "disputed") return "Clarify the promise with the counterparty.";
  if (blocked) return "Resolve the blocker or renegotiate the promise.";
  if (missing.length > 0) return `Confirm or correct ${missing[0]}.`;
  if (urgency === "overdue") return "Draft a recovery message or task now.";
  if (urgency === "due_soon") return "Review and warn the owner before it is overdue.";
  return "Watch connected sources for fulfillment or a reply.";
}

function toQueueItems(entries: RegisterEntry[], now = new Date()): CommitmentQueueItem[] {
  return entries
    .map((entry): CommitmentQueueItem => {
      const relationshipName = entry.relationshipName || "Unknown account";
      const owner =
        entry.ownerParticipantRef ||
        (entry.direction === "promised_by_me" ? "You" : relationshipName);
      const counterparty =
        entry.beneficiaryParticipantRef ||
        (entry.direction === "promised_by_them"
          ? "You"
          : entry.counterpartyParticipantRef || relationshipName);
      const due = entry.dueAt ? new Date(entry.dueAt).getTime() : undefined;
      const closed = ["met", "waived", "cancelled", "superseded"].includes(entry.state);
      const urgency: CommitmentQueueItem["urgency"] = closed
        ? "closed"
        : due !== undefined && due < now.getTime()
          ? "overdue"
          : due !== undefined && due <= now.getTime() + THREE_DAYS
            ? "due_soon"
            : "open";
      const missing = missingEvidence(entry);
      return {
        id: entry.id,
        relationshipId: entry.relationshipId ?? "",
        relationshipName,
        text: entry.text,
        direction: entry.direction,
        owner,
        counterparty,
        dueAt: entry.dueAt ?? undefined,
        state: entry.state,
        acceptance: entry.acceptance ?? "candidate",
        blocker: entry.blocker,
        quote: entry.sourcePhrase,
        missingEvidence: missing,
        nextAction: nextAction(entry.state, missing, urgency, Boolean(entry.blocker?.trim())),
        urgency,
        confidence: Math.round((entry.confidence ?? 0) * 100),
        currentEventVersion: entry.currentEventVersion ?? 0,
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

// A dead Google grant and a transient provider fault need different words and
// a different button. Everything else is "try again".
function scanFailure(scan: RevenueLeakScan | null | undefined, sourceStillBroken: boolean) {
  if (!scan?.error) return null;
  const wasAuthFailure = /invalid authentication|invalid_grant|unauthorized|returned 40[13]/i.test(
    scan.error,
  );
  // Only ask for a reconnect while the grant is actually broken. Reading the
  // old error alone kept telling a user who had just reconnected that Google
  // still needed reconnecting.
  const needsReconnect = wasAuthFailure && sourceStillBroken;
  return {
    needsReconnect,
    headline: needsReconnect ? "Google needs reconnecting" : "The last audit did not finish",
    detail: needsReconnect
      ? "Google stopped accepting the authorization, so we could not read your mail. Reconnect to run the audit again."
      : wasAuthFailure
        ? "The last audit could not read your mail. The connection looks healthy now, so running it again should work."
        : scan.error,
  };
}

// Health reports the WORST account, never the best.
//
// This used to be a .some() over accounts, so a workspace with one healthy
// account and one whose grant had died read as fully connected — and the
// broken one is the one an audit trips over. An account that needs the user
// back through OAuth outranks any number of healthy siblings.
const ATTENTION_SOURCE_STATES = new Set(["reconnect_required", "disconnected"]);

function sourceNeedsReconnect(source: RelationshipSourceInventoryItem | undefined) {
  return Boolean(
    source?.accounts.some(
      (account) => ATTENTION_SOURCE_STATES.has(account.status) || account.missingScopes.length > 0,
    ),
  );
}

function sourceConnected(source: RelationshipSourceInventoryItem | undefined) {
  if (sourceNeedsReconnect(source)) return false;
  return Boolean(
    source?.accounts.some(
      (account) => ACTIVE_SOURCE_STATES.has(account.status) && account.missingScopes.length === 0,
    ),
  );
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    open: "Open",
    at_risk: "At risk",
    met: "Met",
    missed: "Missed",
    waived: "Waived",
    disputed: "Disputed",
    cancelled: "Cancelled",
    superseded: "Superseded",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function acceptanceLabel(value: string) {
  const labels: Record<string, string> = {
    candidate: "Needs confirmation",
    internally_confirmed: "Confirmed",
    offered: "Offered",
    accepted: "Accepted",
    disputed: "Disputed",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const REGISTER_COLUMNS = [
  { name: "Company", icon: TypeText },
  { name: "Score", icon: TypeNumber },
  { name: "Status", icon: TagIcon },
  { name: "Contact", icon: TypeText },
] as const;

function registerPreviewStatus(item: CommitmentQueueItem) {
  if (item.acceptance === "candidate") {
    return { label: "Review", variant: "amber" as const };
  }
  if (item.state === "at_risk" || item.urgency === "overdue") {
    return { label: "At risk", variant: "red" as const };
  }
  return { label: "Confirmed", variant: "green" as const };
}

export function CommitmentQueue({
  className,
  entries,
  view = "we_owe",
  onViewChange,
  onExport,
  relationshipCount = 0,
  accounts = [],
  accountId,
  onAccountChange,
  owner = "",
  onOwnerChange,
  onIncludeCandidatesChange,
  sources,
  latestScan,
  failedScan,
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
  const [exporting, setExporting] = React.useState(false);
  const [selected, setSelected] = React.useState<CommitmentQueueItem | null>(null);
  const [editing, setEditing] = React.useState<CommitmentQueueItem | null>(null);
  const [correctedText, setCorrectedText] = React.useState("");
  const [correctedDueAt, setCorrectedDueAt] = React.useState("");
  const items = React.useMemo(() => toQueueItems(entries), [entries]);
  const scopeMissing =
    (view === "by_account" && !accountId) || (view === "by_owner" && !owner.trim());
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
  const googleNeedsReconnect = sourceNeedsReconnect(google);
  // A past failure is history; the source status says whether it is still true.
  // After a successful reconnect the old 401 must stop demanding another one —
  // it becomes "that audit did not finish", with a retry.
  const failure = scanFailure(failedScan, googleNeedsReconnect);
  // Coverage, read straight from the scan. An older scan that predates
  // these counters reports zero for them, so fall back to the sweep total
  // rather than claiming nothing was examined.
  const swept = latestScan?.threadsSeen ?? 0;
  const skipped = latestScan?.threadsSkipped ?? 0;
  const snippetOnly = latestScan?.threadsSnippetOnly ?? 0;
  const deepRead = latestScan?.threadsDeepRead ?? 0;
  const examined = deepRead + snippetOnly > 0 || skipped > 0 ? deepRead + snippetOnly : swept;
  const googleConnected = !googleNeedsReconnect && sourceConnected(google);

  const transition = async (
    item: CommitmentQueueItem,
    kind: AppendCommitmentTransitionInput["kind"],
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
      <SimProductPanel className="mx-3 mt-3 flex min-h-0 flex-1 flex-col">
        <SimProductHeader
          actions={`${filtered.length} row${filtered.length === 1 ? "" : "s"}`}
          icon={TableIcon}
          title="Commitment register"
        />
        <SimProductToolbar aria-label="Register views" role="tablist">
          {REGISTER_VIEWS.map((registerView) => (
            <Chip
              active={view === registerView.id}
              aria-selected={view === registerView.id}
              key={registerView.id}
              onClick={() => onViewChange?.(registerView.id)}
              role="tab"
              title={registerView.hint}
              type="button"
            >
              {registerView.label}
            </Chip>
          ))}
        </SimProductToolbar>
        <SimProductToolbar className="h-auto min-h-[38px] flex-wrap py-1.5">
          <div className="relative min-w-[180px] max-w-sm flex-1">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-icon)]" />
            <Input
              aria-label="Search commitments"
              className="h-8 border-[var(--border)] bg-[var(--bg)] pl-8 text-[13px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search commitments"
              value={query}
            />
          </div>
          {view === "by_account" ? (
            <Select onValueChange={onAccountChange} value={accountId}>
              <SelectTrigger aria-label="Choose account" className="h-8 w-44">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-none">
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {view === "by_owner" ? (
            <Input
              aria-label="Filter by owner"
              className="h-8 w-44 border-[var(--border)] bg-[var(--bg)] text-[13px]"
              onChange={(event) => onOwnerChange?.(event.target.value)}
              placeholder="Owner name or email"
              value={owner}
            />
          ) : null}
          <Select
            onValueChange={(value) => {
              setFilter(value);
              onIncludeCandidatesChange?.(value === "review");
            }}
            value={filter}
          >
            <SelectTrigger aria-label="Filter commitments" className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-none">
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="review">Needs review</SelectItem>
              <SelectItem value="due">Due soon or overdue</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Chip leftIcon={ListFilter}>Filter</Chip>
          <span className="ml-auto hidden items-center gap-1 2xl:inline-flex">
            <Chip leftIcon={Columns3}>Columns</Chip>
          </span>
          <Button
            className="hidden 2xl:inline-flex"
            onClick={onOpenRecoveryQueue}
            size="sm"
            type="button"
            variant="outline"
          >
            Recovery drafts
          </Button>
          <div className="flex items-center gap-2">
            {!googleNeedsReconnect && !googleConnected ? (
              <Button onClick={onOpenConnectors} size="sm" type="button" variant="outline">
                <Plugs /> Connect Gmail & Calendar
              </Button>
            ) : googleConnected ? (
              <Button
                className="hidden h-8 items-center gap-1.5 text-[12px] text-emerald-400 hover:bg-transparent hover:text-emerald-400 2xl:flex"
                onClick={onOpenAccounts}
                type="button"
                variant="ghost"
              >
                <Badge className="size-1.5 rounded-full bg-emerald-400 p-0" variant="default" />{" "}
                Google connected
              </Button>
            ) : null}
            {googleNeedsReconnect ? (
              <Button
                className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
                onClick={onOpenConnectors}
                size="sm"
                type="button"
              >
                <Plugs /> Reconnect Google
              </Button>
            ) : (
              <Button
                className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
                disabled={scanning}
                onClick={onScan}
                size="sm"
                type="button"
              >
                {scanning ? <Spinner className="size-4" /> : <MagnifyingGlass />}
                <Label className="hidden font-normal xl:inline">
                  {scanning
                    ? `Scanning ${REVENUE_EVIDENCE_LOOKBACK_LABEL}`
                    : "Run 6-month Promise Leak Audit"}
                </Label>
                <Label className="font-normal xl:hidden">
                  {scanning ? "Scanning" : "Run audit"}
                </Label>
              </Button>
            )}
          </div>
        </SimProductToolbar>

        {latestScan?.status === "completed" ? (
          <div className="flex min-h-12 flex-wrap items-center gap-4 border-b border-border bg-background-50 px-3 text-[12px] text-primary/55">
            <Label className="font-medium text-primary">
              Latest {latestScan.lookbackDays}-day audit
            </Label>
            <dl className="flex items-center gap-4">
              {/* "Conversations reviewed" used to show every thread swept,
                including inbox mail the audit never judged. It now counts what
                was actually examined, and says separately what was passed
                over, so the number cannot imply a depth the scan did not have. */}
              <div className="flex items-center gap-1.5">
                <dd className="font-medium text-primary">{examined}</dd>
                <dt>Conversations reviewed</dt>
              </div>
              {skipped > 0 ? (
                <div
                  className="flex items-center gap-1.5"
                  title="Swept but not judged: no message from you in the thread, so there was no promise of yours to find. Usually newsletters, receipts and notifications."
                >
                  <dd className="font-medium text-primary/70">{skipped}</dd>
                  <dt>Not a conversation</dt>
                </div>
              ) : null}
              {snippetOnly > 0 ? (
                <div
                  className="hidden items-center gap-1.5 xl:flex"
                  title="Judged on a short preview because the message body could not be read. A promise further down the message can be missed."
                >
                  <dd className="font-medium text-amber-500">{snippetOnly}</dd>
                  <dt>Preview only</dt>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <dd className="font-medium text-primary">{latestScan.relationshipsCreated ?? 0}</dd>
                <dt>New relationships</dt>
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
                Review relationships
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* A broken source is not only an empty-register problem. With rows on
          screen the register still looks authoritative while it is quietly
          going out of date, so the warning rides above the list too — the
          empty state below repeats it at full size when there is nothing else
          to show. */}
        {failure && items.length > 0 ? (
          <Alert
            className="mx-3 mt-3 rounded-none border-destructive/40 bg-destructive/[0.04]"
            variant="destructive"
          >
            <Warning className="size-4" />
            <AlertTitle className="text-[13px]">{failure.headline}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-destructive/80">
              {failure.needsReconnect
                ? "This register is not being updated until you reconnect."
                : "The last audit did not finish, so this register may be incomplete."}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7 border-destructive/40 px-2 text-[12px] text-destructive"
                onClick={failure.needsReconnect ? onOpenConnectors : onScan}
                disabled={!failure.needsReconnect && scanning}
              >
                {failure.needsReconnect ? "Reconnect Google" : "Run the audit again"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="m-3 rounded-none border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-primary/55">
            <Spinner className="size-4" /> Loading commitments…
          </div>
        ) : scopeMissing ? (
          <div className="flex min-h-[520px] flex-1 flex-col items-center px-6 pt-[120px] text-center">
            <h2 className="text-[20px] font-semibold leading-6 text-primary">
              {view === "by_account" ? "Choose an account" : "Enter an owner"}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-primary/55">
              {view === "by_account"
                ? "Select one relationship to see its two-sided promise history."
                : "Use a name or email to see what that person has promised."}
            </p>
          </div>
        ) : filtered.length === 0 && scanning ? (
          // Mid-scan the register is empty because nothing has been read yet, not
          // because nothing was found. Saying "no promises were found" here reads
          // as a result and it is the wrong one.
          <div className="flex min-h-[520px] flex-1 flex-col items-center px-6 pt-[120px] text-center">
            <Spinner className="mb-3 size-7 text-primary/40" />
            <h2 className="text-[20px] font-semibold leading-6 text-primary">
              Reading your last {REVENUE_EVIDENCE_LOOKBACK_LABEL}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-primary/55">
              This takes a few minutes. You can keep working and come back.
            </p>
          </div>
        ) : filtered.length === 0 && failure ? (
          // The empty register and the reason for it, together.
          <div className="flex min-h-[520px] flex-1 flex-col items-center px-6 pt-[120px] text-center">
            <Warning className="mb-3 size-7 text-destructive" />
            <h2 className="text-[20px] font-semibold leading-6 text-primary">{failure.headline}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-primary/55">{failure.detail}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {failure.needsReconnect ? (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#3478f6] text-white"
                  onClick={onOpenConnectors}
                >
                  <Plugs /> Reconnect Google
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#3478f6] text-white"
                  onClick={onScan}
                  disabled={scanning}
                >
                  {scanning ? <Spinner className="size-4" /> : <MagnifyingGlass />}
                  Run the audit again
                </Button>
              )}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[520px] flex-1 flex-col items-center px-6 pt-[84px] text-center">
            <WorkspaceEmptyIllustration image="commitments" />
            <h2 className="text-[20px] font-semibold leading-6 text-primary">
              {items.length === 0 ? "Commitment Queue" : "No commitments match this view"}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-primary/55">
              {items.length === 0
                ? googleConnected
                  ? "No explicit promises were found. Run another audit after new conversations or import reviewed meeting evidence."
                  : googleNeedsReconnect
                    ? "Reconnect Google to resume finding who promised what, when it is due, and the exact evidence behind it."
                    : "Connect Gmail and Calendar to find who promised what, when it is due, and the exact evidence behind it."
                : "Change the filter or search query."}
            </p>
            {items.length === 0 ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {!googleConnected ? (
                  <Button
                    type="button"
                    size="sm"
                    className="bg-[#3478f6] text-white"
                    onClick={onOpenConnectors}
                  >
                    <Plugs />{" "}
                    {googleNeedsReconnect ? "Reconnect Google" : "Connect Gmail & Calendar"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="bg-[#3478f6] text-white"
                    onClick={onScan}
                    disabled={scanning}
                  >
                    <MagnifyingGlass /> Run 6-month audit
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
                  <Button
                    className="flex h-[72px] items-center justify-start gap-3 rounded-none border border-border bg-background-50 px-3 text-left text-[13px] font-normal text-primary/80 hover:bg-background-100"
                    onClick={onOpenAccounts}
                    type="button"
                    variant="ghost"
                  >
                    <Avatar className="size-10 rounded-none">
                      <AvatarFallback className="rounded-none border border-border bg-background text-primary/45">
                        <Check className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                    Confirm promises with exact evidence
                  </Button>
                  <Button
                    className="flex h-[72px] items-center justify-start gap-3 rounded-none border border-border bg-background-50 px-3 text-left text-[13px] font-normal text-primary/80 hover:bg-background-100"
                    onClick={onOpenRecoveryQueue}
                    type="button"
                    variant="ghost"
                  >
                    <Avatar className="size-10 rounded-none">
                      <AvatarFallback className="rounded-none border border-border bg-background text-primary/45">
                        <ArrowClockwise className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                    Approve recovery before anything is sent
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0 flex-1 overflow-auto">
            <table
              aria-label="Commitments"
              className="w-full min-w-[620px] table-fixed border-collapse text-left"
            >
              <colgroup>
                <col className="w-10" />
                <col className="w-[174px]" />
                <col className="w-[82px]" />
                <col className="w-[138px]" />
                <col className="w-[184px]" />
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-10 h-[34px] border-[var(--border)] border-b bg-[var(--bg)]">
                  <th className="border-[var(--border)] border-r text-center font-normal text-[var(--text-muted)]">
                    #
                  </th>
                  {REGISTER_COLUMNS.map(({ name, icon: Icon }) => (
                    <th
                      className="border-[var(--border)] border-r px-2.5 font-normal last:border-r-0"
                      key={name}
                      scope="col"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className="size-[14px] text-[var(--text-icon)]" />
                        {name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const previewStatus = registerPreviewStatus(item);
                  return (
                    <tr
                      className={cn(
                        "group h-[37px] cursor-pointer border-[var(--border)] border-b hover:bg-[var(--surface-hover)]",
                        index === 0 && "bg-[var(--surface-3)]",
                      )}
                      key={item.id}
                      onClick={() => setSelected(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(item);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td className="border-[var(--border)] border-r text-center text-[var(--text-muted)] tabular-nums">
                        {index + 1}
                      </td>
                      <td className="border-[var(--border)] border-r px-2.5">
                        <span className="block truncate font-medium text-[var(--text-primary)]">
                          {item.relationshipName}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                          {item.text}
                        </span>
                      </td>
                      <td className="border-[var(--border)] border-r px-2.5 tabular-nums">
                        {item.confidence}
                      </td>
                      <td className="border-[var(--border)] border-r px-2.5">
                        <SimBadge variant={previewStatus.variant}>{previewStatus.label}</SimBadge>
                      </td>
                      <td className="truncate px-2.5 text-[var(--text-secondary)]">
                        {item.counterparty}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex h-9 items-center gap-2 px-3 text-[var(--text-muted)]">
              <Plus className="size-[14px]" />
              <span>New row</span>
            </div>
          </div>
        )}
      </SimProductPanel>

      {selected ? (
        <div className="fixed inset-y-0 right-0 z-40 flex bg-background md:left-[285px]">
          <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-background">
            <div className="flex h-12 items-center gap-2 border-b border-border px-3">
              <Button
                className="size-8 rounded-none text-primary/50 hover:bg-background-100 hover:text-primary"
                onClick={() => setSelected(null)}
                type="button"
                aria-label="Close commitment"
                size="icon-xs"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
              <Label className="text-[12px] font-normal text-primary/45">Commitment record</Label>
              {/* One-pager §3: a record that cannot leave the tool cannot
                  settle an argument. */}
              {onExport ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 px-2 text-[12px]"
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true);
                    void onExport(selected).finally(() => setExporting(false));
                  }}
                >
                  {exporting ? <Spinner className="size-4" /> : <Export />}
                  Export record
                </Button>
              ) : null}
            </div>
            <div className="border-b border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-none bg-[#3478f6] text-white">
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
                selected.acceptance !== "candidate" ? (
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
                      <Spinner className="size-4" />
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
                    selected.missingEvidence.length ? selected.missingEvidence.join(", ") : "None"
                  }
                />
              </dl>
            </div>
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <Tabs defaultValue="overview">
              <TabsList className="h-12 w-full justify-start rounded-none border-b border-border bg-transparent px-4">
                <TabsTrigger
                  className="rounded-none bg-background-200 px-3 py-1.5 text-[13px] data-[state=active]:bg-background-200"
                  value="overview"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  className="rounded-none px-2 text-[13px] text-primary/45"
                  value="evidence"
                >
                  Evidence
                </TabsTrigger>
                <TabsTrigger
                  className="rounded-none px-2 text-[13px] text-primary/45"
                  value="activity"
                >
                  Activity
                </TabsTrigger>
              </TabsList>
            </Tabs>
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
                <DetailCard label="Acceptance" value={acceptanceLabel(selected.acceptance)} />
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
                  <Badge className="text-[12px] font-normal text-primary/40" variant="secondary">
                    Exact quote
                  </Badge>
                </div>
                <blockquote className="mt-3 rounded-none border border-border bg-background-50 p-4 text-[14px] leading-6 text-primary/75">
                  {selected.quote ? `“${selected.quote}”` : "No exact quote is attached yet."}
                </blockquote>
              </section>
              <section className="mt-8">
                <h3 className="text-sm font-medium text-primary/60">Next action</h3>
                <Card className="mt-3 gap-3 py-4">
                  <CardContent className="px-4 text-[14px] text-primary">
                    {selected.nextAction}
                  </CardContent>
                  {selected.missingEvidence.length > 0 ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-400">
                      <Warning /> Missing {selected.missingEvidence.join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selected.acceptance === "candidate" ? (
                      <ActionButton
                        busy={busy === `${selected.id}:internally_confirmed`}
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "internally_confirmed")}
                      >
                        <Check /> Confirm promise
                      </ActionButton>
                    ) : null}
                    {["internally_confirmed", "offered", "disputed"].includes(
                      selected.acceptance,
                    ) ? (
                      <ActionButton
                        busy={busy === `${selected.id}:accepted`}
                        disabled={busy !== null}
                        onClick={() => void transition(selected, "accepted")}
                      >
                        <Check /> Mark accepted
                      </ActionButton>
                    ) : null}
                    {selected.acceptance === "accepted" || selected.acceptance === "offered" ? (
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
                    {selected.acceptance === "accepted" ? (
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
                    {selected.blocker ? (
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
                    {["internally_confirmed", "accepted"].includes(selected.acceptance) ||
                    selected.blocker ? (
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
                </Card>
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
              {busy === `${editing?.id}:corrected` ? <Spinner className="size-4" /> : null}
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
    <Card className="min-h-24 gap-3 bg-background-50 py-3">
      <CardHeader className="px-3 pb-0">
        <CardDescription className="text-[12px]">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-3 pt-0 text-[14px] font-medium text-primary">{value}</CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label asChild className="text-[10px] font-normal uppercase tracking-wide text-primary/40">
        <dt>{label}</dt>
      </Label>
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
        state === "met" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
        state === "at_risk" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
        (state === "missed" || state === "disputed") &&
          "border-red-500/40 text-red-600 dark:text-red-400",
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
      {busy ? <Spinner className="size-4" /> : children}
    </Button>
  );
}
