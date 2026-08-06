"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AUTHORITY_LABELS,
  buildImportedTranscriptObservation,
  COMPLETENESS_LABELS,
  MISSION_CONTROL_QUESTIONS,
  RELATIONSHIP_DIMENSION_LABELS,
  completenessTone,
  relationshipLabel,
} from "@oppulence/relationship-contract";
import {
  AddressBook,
  ArrowClockwise,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  DotsThree,
  DownloadSimple,
  Graph,
  ListBullets,
  MagnifyingGlass,
  Microphone,
  Plus,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";
import type {
  ConversationReviewItem,
  MissionControlReadModel,
  RelationshipAttentionItem,
  RelationshipIdentityCandidate,
  Relationship,
  RelationshipAction,
  RelationshipActionAudit,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipSemanticMatch,
  RelationshipSourceInventoryItem,
  RelationshipSourceStatus,
  RelationshipStateSnapshot,
} from "@x/shared/src/relationships.js";
import type {
  MeetingDoctorCheck,
  MeetingRelationshipTarget,
  MeetingSessionSummary,
} from "@x/shared/src/meetings.js";

import { RelationshipGraphWorkspace } from "@/components/relationship-graph";
import {
  relationshipSourceHealth,
  relationshipSourceHealthSummary,
  relationshipSourceStatusLabel,
} from "@/lib/relationship-source-health";
import { meetingBlockerDescription } from "@/lib/meeting-readiness";
import { userFacingError } from "@/lib/user-facing-error";
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
import { DateTimePicker } from "@oppulence/ui/components/date-time-picker";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@oppulence/ui/components/dropdown-menu";
import { Textarea } from "@oppulence/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@oppulence/ui/components/sheet";

const KIND_OPTIONS = ["person", "company", "customer", "opportunity", "referral", "partner"];
const LIFECYCLE_OPTIONS = [
  "prospect",
  "evaluation",
  "contracting",
  "onboarding",
  "active_customer",
  "renewal",
  "churned",
  "former_customer",
];
const HEALTH_OPTIONS = ["unknown", "healthy", "needs_attention", "critical"];
const ENGAGEMENT_OPTIONS = ["unknown", "increasing", "steady", "declining", "dormant"];

const HEALTH_TONE: Record<string, string> = {
  healthy: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  needs_attention: "border-amber-500/30 text-amber-600 dark:text-amber-400",
  critical: "border-red-500/30 text-red-600 dark:text-red-400",
  unknown: "text-primary/45",
};

const DETECTOR_LABELS: Record<string, string> = {
  requested_follow_up_due: "Follow-up due",
  unanswered_proposal: "Unanswered proposal",
  waiting_on_me: "Waiting on you",
  dormant_warm_opportunity: "Dormant opportunity",
  neglected_referral: "Neglected referral",
  former_customer_reconnect: "Former customer",
  conversation_action_pack: "Conversation action pack",
  commitment_due: "Commitment due",
  manual: "Manual",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  warm_follow_up: "Warm follow-up",
  proposal_nudge: "Proposal nudge",
  referral_reconnect: "Referral reconnect",
  customer_risk: "Customer risk",
  meeting_follow_up: "Meeting follow-up",
  meeting_recap: "Meeting recap",
  crm_update: "CRM update",
  follow_up_task: "Follow-up task",
  calendar_hold: "Calendar hold",
  commitment_rescue: "Commitment rescue",
};

const MANUAL_OUTCOME_OPTIONS = [
  { value: "replied", label: "They replied" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "bad_recommendation", label: "Bad recommendation" },
] as const;

const humanize = (value?: string) => (value || "unknown").replaceAll("_", " ");
const titleize = (value?: string) =>
  humanize(value).replace(/\b\w/g, (character) => character.toUpperCase());

function relativeTime(value?: string): string {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(1, Math.round((Date.now() - time) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

function formatSourceLag(seconds?: number): string {
  if (!seconds || seconds < 60) return "Up to date";
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))}m behind`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h behind`;
  return `${Math.round(seconds / 86_400)}d behind`;
}

function sourceConnectionGuidance(inventory: RelationshipSourceInventoryItem[]): string {
  const connected = inventory.filter((item) =>
    item.accounts.some(
      (account) => account.status !== "disconnected" && account.status !== "reconnect_required",
    ),
  );
  const missing = inventory.filter((item) => item.accounts.length === 0);
  if (connected.length === 0) {
    return "Connect Google plus Slack or HubSpot to build relationship history. Actions remain approval-gated.";
  }
  if (missing.length > 0) {
    return "Finish connecting sources and restore any source that needs attention. Existing evidence remains available.";
  }
  return "Restore the sources that need attention so recommendations use current evidence. Actions remain approval-gated.";
}

function formatRelationshipChangeValue(value: unknown): string {
  if (value == null || value === "") return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") return humanize(value);
  if (Array.isArray(value)) {
    return value.length > 0
      ? value.map((item) => formatRelationshipChangeValue(item)).join(", ")
      : "None";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return formatRelationshipChangeValue(record.value);
    const readable = Object.entries(record)
      .filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry))
      .slice(0, 3)
      .map(([key, entry]) => `${humanize(key)}: ${formatRelationshipChangeValue(entry)}`);
    return readable.length > 0 ? readable.join(" · ") : "Updated details";
  }
  return "Updated";
}

export type RelationshipSection = "accounts" | "attention";

export function RelationshipsView({
  initialId,
  initialGraphState,
  initialSection = "accounts",
  onStartMeeting,
  meetingCaptureBlocker,
  onChatContextChange,
}: {
  initialId?: string | null;
  initialGraphState?: string | null;
  initialSection?: RelationshipSection;
  onStartMeeting?: (target: MeetingRelationshipTarget) => Promise<void>;
  meetingCaptureBlocker?: MeetingDoctorCheck | null;
  onChatContextChange?: (context: { label: string; detail?: string } | null) => void;
}) {
  const [rows, setRows] = React.useState<Relationship[]>([]);
  const [sources, setSources] = React.useState<RelationshipSourceStatus[]>([]);
  const [sourceInventory, setSourceInventory] = React.useState<RelationshipSourceInventoryItem[]>(
    [],
  );
  const [identityCandidates, setIdentityCandidates] = React.useState<
    RelationshipIdentityCandidate[]
  >([]);
  const [attention, setAttention] = React.useState<RelationshipAttentionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<string | null>(initialId ?? null);
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [health, setHealth] = React.useState("all");
  const [lifecycle, setLifecycle] = React.useState("all");
  const [error, setError] = React.useState<string | null>(null);
  const [surface, setSurface] = React.useState<"list" | "graph">(
    initialGraphState ? "graph" : "list",
  );
  const [section, setSection] = React.useState<RelationshipSection>(initialSection);

  React.useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  React.useEffect(() => {
    if (surface !== "list") return;
    if (section === "attention") {
      onChatContextChange?.({
        label: "Attention queue",
        detail: `${attention.length} open items to review`,
      });
      return;
    }
    const selected = rows.find((relationship) => relationship.id === detail);
    onChatContextChange?.(
      selected
        ? { label: selected.displayName, detail: "Open relationship record" }
        : { label: "Relationship Mission Control", detail: `${rows.length} accounts in view` },
    );
  }, [attention.length, detail, onChatContextChange, rows, section, surface]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        relationships,
        sourceStatuses,
        inventory,
        pendingCandidates,
        deferredCandidates,
        attentionItems,
      ] = await Promise.all([
        window.ipc.invoke("relationships:list", {
          q: query.trim() || undefined,
          health: health === "all" ? undefined : health,
          lifecycle: lifecycle === "all" ? undefined : lifecycle,
        }),
        window.ipc.invoke("relationships:sources", null),
        window.ipc.invoke("relationships:sourceInventory", null),
        window.ipc.invoke("relationships:listIdentityCandidates", { status: "pending" }),
        window.ipc.invoke("relationships:listIdentityCandidates", { status: "deferred" }),
        window.ipc.invoke("relationships:listAttention", { status: "open" }),
      ]);
      setRows(relationships.relationships);
      setSources(sourceStatuses.sources);
      setSourceInventory(inventory.sources);
      setIdentityCandidates([...pendingCandidates.candidates, ...deferredCandidates.candidates]);
      setAttention(attentionItems.items);
    } catch (cause) {
      setError(userFacingError(cause, "Could not load relationship intelligence."));
    } finally {
      setLoading(false);
    }
  }, [health, lifecycle, query]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  React.useEffect(() => {
    if (initialId) setDetail(initialId);
  }, [initialId]);

  const exportDiagnostics = React.useCallback(async () => {
    try {
      const bundle = await window.ipc.invoke("relationships:betaDiagnostics", null);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `oppulence-beta-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Redacted beta diagnostics exported.");
    } catch (cause) {
      setError(userFacingError(cause, "Could not export beta diagnostics."));
    }
  }, []);

  return (
    <div className="app-shell min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4 px-6 py-6">
        <section className="rounded-[2px] border border-border bg-background-50 p-4 dark:bg-background-100/30">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
                {section === "attention" ? "Attention queue" : "Account mission control"}
              </p>
              <h1 className="mt-1 text-base font-semibold text-primary">
                {section === "attention"
                  ? "What needs attention now?"
                  : "Which relationship needs action now?"}
              </h1>
              <p className="mt-1 max-w-2xl text-xs text-primary/55">
                {section === "attention"
                  ? "Review risks, commitments, and next actions with the evidence and decision controls beside each item."
                  : "One living state across email, meetings, Slack, CRM, and revenue evidence. Every recommendation explains what changed and waits for approval."}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <SourceHealth statuses={sources} />
              <div className="flex border border-border bg-background">
                <button
                  type="button"
                  onClick={() => setSurface("list")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${surface === "list" ? "bg-primary text-background" : "text-primary/55 hover:bg-primary/5"}`}
                >
                  <ListBullets /> {section === "attention" ? "Attention" : "Accounts"}
                </button>
                <button
                  type="button"
                  data-capability="relationship-graph graph-query graph-saved-views graph-governed-actions"
                  onClick={() => setSurface("graph")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${surface === "graph" ? "bg-primary text-background" : "text-primary/55 hover:bg-primary/5"}`}
                >
                  <Graph /> Graph
                </button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-capability="support-diagnostics"
                onClick={() => void exportDiagnostics()}
              >
                <DownloadSimple /> Export diagnostics
              </Button>
            </div>
          </div>
        </section>

        {surface === "graph" ? (
          <RelationshipGraphWorkspace
            key={initialGraphState ?? "default"}
            relationships={rows}
            initialState={initialGraphState ?? undefined}
            onOpenRelationship={setDetail}
            onError={setError}
            onContextChange={onChatContextChange}
          />
        ) : section === "attention" ? (
          <div className="flex flex-col gap-4">
            <PortfolioAttentionQueue
              items={attention}
              onOpenRelationship={setDetail}
              onError={setError}
              onChanged={() => void load()}
              emptyState
            />
            <div data-tour-target="evidence">
              <SemanticSearch onError={setError} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section aria-labelledby="relationship-accounts-heading" className="order-1 space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
                  Accounts
                </p>
                <h2 id="relationship-accounts-heading" className="text-sm font-medium text-primary">
                  Start with the customer
                </h2>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-primary/40" />
                  <Input
                    aria-label="Filter relationships"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter by account, domain, or contact"
                    className="pl-8"
                  />
                </div>
                <Select value={health} onValueChange={setHealth}>
                  <SelectTrigger className="w-full sm:w-44" size="sm">
                    <SelectValue placeholder="Health" />
                  </SelectTrigger>
                  <SelectContent className="app-shell rounded-[2px]">
                    <SelectItem value="all">All health</SelectItem>
                    {HEALTH_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {humanize(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={lifecycle} onValueChange={setLifecycle}>
                  <SelectTrigger className="w-full sm:w-44" size="sm">
                    <SelectValue placeholder="Lifecycle" />
                  </SelectTrigger>
                  <SelectContent className="app-shell rounded-[2px]">
                    <SelectItem value="all">All lifecycle</SelectItem>
                    {LIFECYCLE_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {humanize(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                  <Plus /> New
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-primary/45">{rows.length} relationships</span>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                  <ArrowClockwise className={loading ? "animate-spin" : ""} /> Refresh
                </Button>
              </div>

              {error ? (
                <div className="flex gap-2 rounded-[2px] border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <Warning className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              ) : null}

              {loading ? (
                <ListSkeleton />
              ) : rows.length === 0 ? (
                <EmptyBlock
                  icon={<AddressBook className="size-6" />}
                  title="No matching relationships"
                  body="Connect a source to build living relationship state, or add an account by hand."
                >
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus /> Add relationship
                  </Button>
                </EmptyBlock>
              ) : (
                <ul className="flex flex-col divide-y divide-primary/10 rounded-[2px] border border-border">
                  {rows.map((relationship) => (
                    <li key={relationship.id}>
                      <button
                        type="button"
                        onClick={() => setDetail(relationship.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background-100/60 dark:hover:bg-background-100/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-primary">
                              {relationship.displayName}
                            </span>
                            <Badge
                              variant="outline"
                              className="rounded-[2px] font-normal capitalize"
                            >
                              {humanize(relationship.lifecycle)}
                            </Badge>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${
                                HEALTH_TONE[relationship.health] ?? HEALTH_TONE.unknown
                              }`}
                            >
                              {humanize(relationship.health)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-primary/55">
                            {relationship.nextAction ||
                              relationship.stateReason ||
                              relationship.summary ||
                              "Waiting for enough evidence to recommend a next action."}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right md:block">
                          <p className="text-xs capitalize text-primary/55">
                            {humanize(relationship.engagement)}
                          </p>
                          <p className="text-[11px] text-primary/35">
                            {relationship.lastChangedAt
                              ? `changed ${relativeTime(relationship.lastChangedAt)}`
                              : relationship.lastTouchAt
                                ? `touched ${relativeTime(relationship.lastTouchAt)}`
                                : `state v${relationship.stateVersion}`}
                          </p>
                        </div>
                        {relationship.openActions ? (
                          <Badge variant="secondary" className="shrink-0">
                            {relationship.openActions} action
                            {relationship.openActions === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="order-2">
              <div data-tour-target="evidence">
                <SemanticSearch onError={setError} />
              </div>
            </div>

            <div className="order-3">
              <div data-tour-target="relationship-correction">
                <IdentityReviewInbox
                  candidates={identityCandidates}
                  onError={setError}
                  onChanged={() => void load()}
                />
              </div>
            </div>

            <div className="order-4">
              <SourceConnectionCards
                inventory={sourceInventory}
                onError={setError}
                onChanged={() => void load()}
              />
            </div>
          </div>
        )}
      </div>

      {detail ? (
        <RelationshipSheet
          id={detail}
          onClose={() => setDetail(null)}
          onError={setError}
          onChanged={() => void load()}
          onStartMeeting={onStartMeeting}
          meetingCaptureBlocker={meetingCaptureBlocker}
        />
      ) : null}

      {creating ? (
        <CreateRelationshipDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function PortfolioAttentionQueue({
  items,
  onOpenRelationship,
  onChanged,
  onError,
  emptyState = false,
}: {
  items: RelationshipAttentionItem[];
  onOpenRelationship: (id: string) => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
  emptyState?: boolean;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  if (items.length === 0 && !emptyState) return null;

  if (items.length === 0) {
    return (
      <section
        aria-labelledby="portfolio-attention-heading"
        className="space-y-2 border border-border p-4"
        data-capability="attention-queue"
        data-tour-target="attention-queue"
      >
        <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
          Portfolio attention
        </p>
        <h2 id="portfolio-attention-heading" className="text-sm font-medium text-primary">
          Nothing needs review right now
        </h2>
        <p className="text-xs text-primary/55">
          New risks, commitments, and next actions will appear here when relationship evidence
          changes.
        </p>
      </section>
    );
  }

  const customerItems = items.filter((item) => item.reasonCode !== "source_degradation");
  const maintenanceItems = items.filter((item) => item.reasonCode === "source_degradation");

  const decide = async (
    item: RelationshipAttentionItem,
    decision: "acknowledge" | "snooze" | "dismiss",
  ) => {
    const reason =
      decision === "dismiss"
        ? window.prompt("Why should this attention item be dismissed?", "Not relevant right now")
        : decision === "acknowledge"
          ? "Reviewed from the portfolio attention queue."
          : "Snoozed from the portfolio attention queue.";
    if (reason === null || (decision === "dismiss" && !reason.trim())) return;
    setBusy(`${item.id}:${decision}`);
    try {
      await window.ipc.invoke("relationships:decideAttention", {
        attentionId: item.id,
        decision,
        reason,
        expectedVersion: item.version,
        snoozedUntil:
          decision === "snooze"
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : undefined,
      });
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update the attention item.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="portfolio-attention-heading"
      className="space-y-2"
      data-capability="attention-queue"
      data-tour-target="attention-queue"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
            Portfolio attention
          </p>
          <h2 id="portfolio-attention-heading" className="text-sm font-medium text-primary">
            {customerItems.length} customer action{customerItems.length === 1 ? "" : "s"} to review
          </h2>
        </div>
        <span className="text-[11px] text-primary/40">Most urgent first</span>
      </div>
      <ol className="space-y-2">
        {customerItems.slice(0, showAll ? 10 : 3).map((item) => (
          <li key={item.id} className="rounded-[2px] border border-border p-3">
            <div className="flex flex-wrap items-start gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpenRelationship(item.relationshipId)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-primary">{item.relationshipName}</span>
                  <Badge
                    variant="outline"
                    className={`rounded-[2px] capitalize ${
                      item.urgencyBand === "critical"
                        ? "border-red-500/40 text-red-600"
                        : item.urgencyBand === "high"
                          ? "border-amber-500/40 text-amber-600"
                          : ""
                    }`}
                  >
                    {relationshipLabel(item.reasonCode)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-primary/60">{item.explanation}</p>
              </button>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  data-tour-target="relationship-action"
                  onClick={() => onOpenRelationship(item.relationshipId)}
                >
                  Open account
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void decide(item, "acknowledge")}
                >
                  {busy === `${item.id}:acknowledge` ? (
                    <CircleNotch className="animate-spin" />
                  ) : (
                    <Check />
                  )}{" "}
                  Mark reviewed
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="More actions">
                      <DotsThree />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="app-shell">
                    <DropdownMenuItem
                      disabled={busy !== null}
                      onClick={() => void decide(item, "snooze")}
                    >
                      Snooze for one day
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy !== null}
                      onClick={() => void decide(item, "dismiss")}
                    >
                      Dismiss…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <details className="mt-2 text-[11px] text-primary/50">
              <summary className="cursor-pointer">Why this matters</summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {Object.entries(item.rankFactors).map(([factor, contribution]) => (
                  <li key={factor}>
                    {relationshipLabel(factor)} {contribution >= 0 ? "raised" : "lowered"} the
                    priority.
                  </li>
                ))}
                {item.sourceRequirements.length > 0 ? (
                  <li>Evidence is still needed from {item.sourceRequirements.join(", ")}.</li>
                ) : null}
              </ul>
            </details>
          </li>
        ))}
      </ol>
      {customerItems.length > 3 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show top three" : `Show all ${customerItems.length} customer actions`}
        </Button>
      ) : null}
      {maintenanceItems.length > 0 ? (
        <details className="rounded-[2px] border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium text-primary">
            Data maintenance · {maintenanceItems.length} source issue
            {maintenanceItems.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-2 text-primary/60">
            {maintenanceItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded-[2px] border border-border p-2 text-left hover:bg-primary/5"
                onClick={() => onOpenRelationship(item.relationshipId)}
              >
                <span className="font-medium text-primary">{item.relationshipName}</span>
                <span className="mt-0.5 block">{item.explanation}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SourceHealth({ statuses }: { statuses: RelationshipSourceStatus[] }) {
  if (statuses.length === 0) {
    return (
      <Badge variant="outline" className="w-fit rounded-[2px] font-normal text-primary/45">
        No evidence sources yet
      </Badge>
    );
  }
  const { needsAttention, syncing } = relationshipSourceHealthSummary(statuses);
  return (
    <div className="flex max-w-sm flex-wrap justify-end gap-1.5">
      {statuses.slice(0, 4).map((source) => (
        <Badge
          key={`${source.source}:${source.sourceAccountId}`}
          variant="outline"
          title={source.lastError || source.lastObservationAt}
          className={`rounded-[2px] font-normal capitalize ${
            relationshipSourceHealth(source) === "healthy"
              ? "border-emerald-500/30"
              : relationshipSourceHealth(source) === "syncing"
                ? "border-sky-500/30"
                : "border-amber-500/30"
          }`}
        >
          {source.source} · {relationshipSourceStatusLabel(source)}
        </Badge>
      ))}
      {needsAttention.length > 0 ? (
        <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <Warning /> {needsAttention.length} need attention
        </span>
      ) : syncing.length > 0 ? (
        <span className="text-[11px] text-sky-600 dark:text-sky-400">
          {syncing.length} building history
        </span>
      ) : null}
    </div>
  );
}

function SourceConnectionCards({
  inventory,
  onChanged,
  onError,
}: {
  inventory: RelationshipSourceInventoryItem[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [hubspotKey, setHubspotKey] = React.useState("");

  const needsAttention = inventory.filter(
    (item) =>
      item.accounts.length === 0 ||
      item.accounts.some(
        (account) => account.status !== "live" || account.missingScopes.length > 0,
      ),
  );
  if (needsAttention.length === 0) return null;

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    onError(null);
    try {
      await operation();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update the evidence source.");
    } finally {
      setBusy(null);
    }
  };

  const connect = (source: string) =>
    run(`${source}:connect`, async () => {
      const item = inventory.find((candidate) => candidate.source === source);
      if (source === "hubspot") {
        await window.ipc.invoke("relationships:reportSourceAuthorization", {
          source,
          sourceAccountId: "default",
          state: "started",
        });
      }
      const fail = async (message: string) => {
        if (source === "hubspot") {
          await window.ipc
            .invoke("relationships:reportSourceAuthorization", {
              source,
              sourceAccountId: "default",
              state: "failed",
              errorCode: "authorization_failed",
            })
            .catch(() => undefined);
        }
        throw new Error(message);
      };
      if (source === "google") {
        const result = await window.ipc.invoke("oauth:connect", { provider: "google" });
        if (!result.success) await fail(result.error || "Could not start Google connection.");
        return;
      }
      if (source === "slack") {
        const result = await window.ipc.invoke("slack:connectWorkspace", null);
        if (!result.success) await fail(result.error || "Could not start Slack connection.");
        return;
      }
      const result = await window.ipc.invoke("connectors:saveApiKey", {
        connector: "hubspot",
        apiKey: hubspotKey.trim(),
      });
      if (!result.success) {
        await fail(result.error || "Could not save the HubSpot private app token.");
      }
      const status = await window.ipc.invoke("relationships:reportSourceAuthorization", {
        source,
        sourceAccountId: "default",
        state: "completed",
        grantedScopes: item?.readScopes || [],
      });
      await window.ipc.invoke("relationships:resyncSource", {
        source,
        sourceAccountId: status.sourceAccountId,
      });
      setHubspotKey("");
    });

  const disconnect = (source: string, sourceAccountId: string) =>
    run(`${source}:disconnect`, async () => {
      if (source === "google") {
        await window.ipc.invoke("oauth:disconnect", { provider: "google" });
      }
      if (source === "slack") {
        await window.ipc.invoke("slack:disconnectWorkspace", {
          teamId: sourceAccountId === "default" ? undefined : sourceAccountId,
        });
      }
      if (source === "hubspot") {
        await window.ipc.invoke("connectors:disconnect", { connector: "hubspot" });
      }
      await window.ipc.invoke("relationships:disconnectSource", { source, sourceAccountId });
    });

  return (
    <section
      aria-labelledby="source-connections-heading"
      className="space-y-3"
      data-capability="source-lifecycle"
    >
      <div>
        <h2 id="source-connections-heading" className="text-sm font-medium text-primary">
          Evidence sources
        </h2>
        <p className="mt-0.5 text-xs text-primary/55">{sourceConnectionGuidance(inventory)}</p>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {needsAttention.map((item) => {
          const account = item.accounts[0];
          const progress =
            account && account.backfillTotal > 0
              ? Math.round((account.backfillCompleted / account.backfillTotal) * 100)
              : null;
          return (
            <article key={item.source} className="space-y-3 rounded-[2px] border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-primary">{item.displayName}</h3>
                <Badge variant="outline" className="rounded-[2px] capitalize">
                  {humanize(account?.status || "not_connected")}
                </Badge>
              </div>
              <p className="text-xs text-primary/55">{item.scopeExplanation}</p>
              <details className="text-[11px] text-primary/55">
                <summary className="cursor-pointer">Permissions and capabilities</summary>
                <p className="mt-1">
                  <span className="font-medium">Read:</span> {item.readScopes.join(", ")}
                </p>
                <p className="mt-1">
                  <span className="font-medium">On approval:</span> {item.writeScopes.join(", ")}
                </p>
              </details>
              {account ? (
                <div className="space-y-1 text-[11px] text-primary/50">
                  <p>
                    {humanize(account.completeness)}
                    {progress !== null ? ` · backfill ${progress}%` : ""}
                    {` · ${formatSourceLag(account.lagSeconds)}`}
                  </p>
                  {account.lastSuccessAt ? (
                    <p>Last successful sync {relativeTime(account.lastSuccessAt)}</p>
                  ) : null}
                  {account.missingScopes.length > 0 ? (
                    <p className="text-amber-600">Missing: {account.missingScopes.join(", ")}</p>
                  ) : null}
                  {account.lastError ? (
                    <p className="text-destructive">{account.lastError}</p>
                  ) : null}
                </div>
              ) : null}
              {!account && item.source === "hubspot" ? (
                <Input
                  type="password"
                  value={hubspotKey}
                  onChange={(event) => setHubspotKey(event.target.value)}
                  placeholder="HubSpot private app token"
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!account ||
                account.status === "disconnected" ||
                account.status === "reconnect_required" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null || (item.source === "hubspot" && !hubspotKey.trim())}
                    onClick={() => void connect(item.source)}
                  >
                    {busy === `${item.source}:connect` ? (
                      <CircleNotch className="animate-spin" />
                    ) : null}{" "}
                    Connect
                  </Button>
                ) : null}
                {account && item.supportsResync ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`${item.source}:resync`, () =>
                        window.ipc.invoke("relationships:resyncSource", {
                          source: item.source,
                          sourceAccountId: account.sourceAccountId,
                        }),
                      )
                    }
                  >
                    {busy === `${item.source}:resync` ? (
                      <CircleNotch className="animate-spin" />
                    ) : (
                      <ArrowClockwise />
                    )}{" "}
                    Resync
                  </Button>
                ) : null}
                {account && account.status !== "disconnected" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void disconnect(item.source, account.sourceAccountId)}
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function IdentityReviewInbox({
  candidates,
  onChanged,
  onError,
}: {
  candidates: RelationshipIdentityCandidate[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  if (candidates.length === 0) return null;

  const decide = async (
    candidate: RelationshipIdentityCandidate,
    decision: "merge" | "keep_separate" | "move_evidence" | "defer" | "split" | "undo",
  ) => {
    setBusy(`${candidate.id}:${decision}`);
    try {
      await window.ipc.invoke("relationships:decideIdentityCandidate", {
        candidateId: candidate.id,
        decision,
        reason: reasons[candidate.id]?.trim() || `Reviewed in the identity inbox: ${decision}.`,
        expectedVersion: candidate.version,
        idempotencyKey: crypto.randomUUID(),
      });
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not apply the identity decision. Refresh and try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="identity-review-heading"
      className="space-y-2 rounded-[2px] border border-amber-500/30 bg-amber-500/5 p-3"
      data-capability="identity-review"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="identity-review-heading" className="text-sm font-medium text-primary">
            Identity review
          </h2>
          <p className="mt-0.5 text-xs text-primary/55">
            {candidates.length} ambiguous relationship{candidates.length === 1 ? "" : "s"} cannot
            receive actions until reviewed.
          </p>
        </div>
        <Badge variant="outline" className="rounded-[2px] border-amber-500/40">
          Human decision required
        </Badge>
      </div>
      {candidates.map((candidate) => (
        <article key={candidate.id} className="space-y-3 border-t border-amber-500/20 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-primary">
                {candidate.proposedRelationship.displayName} may match{" "}
                {candidate.existingRelationship.displayName}
              </p>
              <p className="mt-0.5 text-xs text-primary/55">
                Exact {humanize(candidate.anchorKind)} anchor
                {candidate.anchorProvider ? ` from ${candidate.anchorProvider}` : ""}:{" "}
                {candidate.anchorPreview || "preview withheld"}
              </p>
            </div>
            <span className="text-xs text-primary/45">
              {candidate.evidenceCount} evidence item{candidate.evidenceCount === 1 ? "" : "s"} ·{" "}
              {Math.round(candidate.recommendationConfidence * 100)}% recommendation confidence
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-primary/55">
            {Object.entries(candidate.impact).map(([kind, count]) => (
              <span key={kind} className="border border-border px-2 py-1">
                {count} {humanize(kind)}
              </span>
            ))}
          </div>
          <Input
            aria-label={`Reason for identity decision about ${candidate.proposedRelationship.displayName}`}
            value={reasons[candidate.id] ?? ""}
            onChange={(event) =>
              setReasons((current) => ({ ...current, [candidate.id]: event.target.value }))
            }
            placeholder="Optional audit reason"
          />
          <div className="flex flex-wrap gap-2">
            {(candidate.status === "resolved"
              ? (["split", "undo"] as const)
              : (["merge", "keep_separate", "move_evidence", "defer"] as const)
            ).map((decision) => (
              <Button
                key={decision}
                type="button"
                size="sm"
                variant={candidate.recommendedDecision === decision ? "default" : "outline"}
                disabled={busy !== null}
                onClick={() => void decide(candidate, decision)}
              >
                {busy === `${candidate.id}:${decision}` ? (
                  <CircleNotch className="animate-spin" />
                ) : null}
                {relationshipLabel(decision)}
              </Button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function SemanticSearch({ onError }: { onError: (message: string | null) => void }) {
  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<RelationshipSemanticMatch[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);

  if (unavailable) return null;

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const result = await window.ipc.invoke("relationships:search", { query: query.trim() });
      if (!result.available) {
        setUnavailable(true);
        return;
      }
      setMatches(result.matches);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={run} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkle className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-oppulence-orange" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask across relationships — “Which renewals lost engagement this month?”"
            className="pl-8"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || !query.trim()}>
          {busy ? <CircleNotch className="animate-spin" /> : <Sparkle />} Ask
        </Button>
      </div>
      {matches !== null ? (
        matches.length === 0 ? (
          <p className="text-xs text-primary/45">No evidence matched that question.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10 rounded-[2px] border border-border">
            {matches.map((match) => (
              <li key={match.threadId} className="flex items-center gap-3 px-3 py-2">
                <Badge variant="outline" className="rounded-[2px] font-normal capitalize">
                  {match.classification}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-primary/80">
                    {match.subject || match.counterparty}
                  </div>
                  <div className="truncate text-xs text-primary/45">{match.summary}</div>
                </div>
                <span className="text-xs tabular-nums text-primary/40">
                  {Math.round(match.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </form>
  );
}

function MissionControlOverview({
  model,
  busy,
  onAcknowledge,
  onRetract,
}: {
  model: MissionControlReadModel;
  busy: boolean;
  onAcknowledge: () => void;
  onRetract: (assertionId: string, reason: string) => void;
}) {
  const tone = completenessTone(model.completeness.status);
  const supported = Object.values(model.evidence).filter((item) => item.supported).length;
  const total = Object.keys(model.evidence).length;
  return (
    <section
      aria-labelledby="mission-control-heading"
      className="space-y-3"
      data-capability="mission-control evidence-inspection assertion-retraction"
    >
      <div
        className={`border p-3 ${tone === "safe" ? "border-emerald-500/30 bg-emerald-500/5" : tone === "caution" ? "border-amber-500/30 bg-amber-500/5" : "border-red-500/30 bg-red-500/5"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="mission-control-heading" className="text-sm font-medium text-primary">
              {COMPLETENESS_LABELS[model.completeness.status] ??
                relationshipLabel(model.completeness.status)}
            </h3>
            <p className="mt-1 text-xs text-primary/60">{model.completeness.explanation}</p>
          </div>
          <Badge variant="outline" className="rounded-[2px] font-normal">
            {supported}/{total} state dimensions sourced
          </Badge>
        </div>
        {model.completeness.unresolvedIdentityCount > 0 ? (
          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
            {model.completeness.unresolvedIdentityCount} identity review
            {model.completeness.unresolvedIdentityCount === 1 ? "" : "s"} block acting.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {MISSION_CONTROL_QUESTIONS.map((question) => {
          let answer = "No supported answer yet.";
          if (question.key === "state")
            answer = `${relationshipLabel(String(model.evidence.lifecycle?.value ?? "unknown"))} · ${relationshipLabel(String(model.evidence.health?.value ?? "unknown"))}`;
          else if (question.key === "change")
            answer = model.changedSinceReview
              ? model.changes
                  .map(
                    (change) =>
                      RELATIONSHIP_DIMENSION_LABELS[change.dimension] ??
                      relationshipLabel(change.dimension),
                  )
                  .join(", ") || "State changed"
              : "Nothing changed since your last review.";
          else if (question.key === "evidence")
            answer = `${supported} of ${total} dimensions have an accessible winning assertion.`;
          else if (question.key === "action")
            answer = model.activeRecommendation?.reason || "No action is currently recommended.";
          return (
            <div key={question.key} className="border border-border p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary/45">
                {question.label}
              </p>
              <p className="mt-1 text-xs text-primary/75">{answer}</p>
            </div>
          );
        })}
      </div>
      <details className="border border-border p-3 text-xs">
        <summary className="cursor-pointer font-medium text-primary">
          Inspect dimension evidence
        </summary>
        <ul className="mt-3 space-y-2">
          {Object.values(model.evidence).map((item) => (
            <li key={item.dimension} className="border-l border-border pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {RELATIONSHIP_DIMENSION_LABELS[item.dimension] ??
                    relationshipLabel(item.dimension)}
                </span>
                <Badge variant="outline" className="rounded-[2px] font-normal">
                  {item.supported
                    ? (AUTHORITY_LABELS[item.authority ?? ""] ?? relationshipLabel(item.authority))
                    : "Explicitly incomplete"}
                </Badge>
                {!item.fresh ? <span className="text-amber-600">stale</span> : null}
              </div>
              <p className="mt-1 text-primary/55">{item.reason || item.missingReason}</p>
              {item.evidence.length ? (
                <p className="mt-1 text-primary/40">
                  {item.evidence
                    .map(
                      (ref) => `${relationshipLabel(ref.source)} · ${relativeTime(ref.observedAt)}`,
                    )
                    .join("; ")}
                </p>
              ) : null}
              {item.authority === "user_correction" && item.assertionId ? (
                <CorrectionRetraction
                  assertionId={item.assertionId}
                  disabled={busy}
                  onRetract={onRetract}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      {model.changedSinceReview ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onAcknowledge}>
          <Check /> Mark state v{model.stateVersion} reviewed
        </Button>
      ) : (
        <p className="text-[11px] text-primary/40">
          Reviewed through state v{model.previousReviewedStateVersion} · as of{" "}
          {new Date(model.asOf).toLocaleString()}
        </p>
      )}
    </section>
  );
}

function CorrectionRetraction({
  assertionId,
  disabled,
  onRetract,
}: {
  assertionId: string;
  disabled: boolean;
  onRetract: (assertionId: string, reason: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Retract correction
      </Button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is this correction no longer valid?"
        aria-label="Correction retraction reason"
      />
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={disabled || !reason.trim()}
        onClick={() => onRetract(assertionId, reason.trim())}
      >
        Confirm retraction
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function ImportedTranscriptPublisher({
  relationshipId,
  disabled,
  onPublish,
}: {
  relationshipId: string;
  disabled: boolean;
  onPublish: (
    observation: ReturnType<typeof buildImportedTranscriptObservation>,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [transcript, setTranscript] = React.useState("");
  const [disclosureConfirmed, setDisclosureConfirmed] = React.useState(false);
  const [occurredAt, setOccurredAt] = React.useState(() => new Date().toISOString().slice(0, 16));
  const disclosureId = React.useId();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Import transcript
      </Button>
    );
  }

  return (
    <section
      className="space-y-2 border border-border p-3"
      data-capability="transcript-publication"
    >
      <SectionTitle title="Publish an imported transcript" />
      <p className="text-xs text-primary/55">
        Paste reviewed transcript text. Prefix lines with a speaker name and colon when known.
        Imported text is preserved as evidence and does not become a trusted claim automatically.
      </p>
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Conversation title"
        aria-label="Imported transcript title"
      />
      <DateTimePicker
        value={occurredAt}
        onChange={setOccurredAt}
        aria-label="Conversation time"
        placeholder="Conversation time"
      />
      <Textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder={"Avery: We can renew next week.\nYou: I will send the paperwork."}
        aria-label="Imported transcript text"
        className="min-h-40"
      />
      <label htmlFor={disclosureId} className="flex items-start gap-2 text-xs text-primary/60">
        <Checkbox
          id={disclosureId}
          className="mt-0.5 size-4 accent-current"
          checked={disclosureConfirmed}
          onCheckedChange={(checked) => setDisclosureConfirmed(checked === true)}
        />
        <span>
          I confirm this transcript may be stored under workspace policy and participants were
          notified where required.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || !transcript.trim() || !occurredAt || !disclosureConfirmed}
          onClick={async () => {
            const published = await onPublish(
              buildImportedTranscriptObservation({
                relationshipId,
                title,
                transcript,
                occurredAt: new Date(occurredAt).toISOString(),
              }),
            );
            if (!published) return;
            setOpen(false);
            setTitle("");
            setTranscript("");
            setDisclosureConfirmed(false);
          }}
        >
          Publish reviewed evidence
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function RelationshipSheet({
  id,
  onClose,
  onError,
  onChanged,
  onStartMeeting,
  meetingCaptureBlocker,
}: {
  id: string;
  onClose: () => void;
  onError: (message: string | null) => void;
  onChanged: () => void;
  onStartMeeting?: (target: MeetingRelationshipTarget) => Promise<void>;
  meetingCaptureBlocker?: MeetingDoctorCheck | null;
}) {
  const [data, setData] = React.useState<RelationshipDetail | null>(null);
  const [timeline, setTimeline] = React.useState<RelationshipObservation[]>([]);
  const [changes, setChanges] = React.useState<RelationshipStateSnapshot[]>([]);
  const [identityCandidates, setIdentityCandidates] = React.useState<
    RelationshipIdentityCandidate[]
  >([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<Record<string, unknown>>({});
  const [sessions, setSessions] = React.useState<MeetingSessionSummary[]>([]);

  const loadSessions = React.useCallback(async () => {
    try {
      const result = await window.ipc.invoke("meeting:listSessions", null);
      setSessions(result.sessions);
    } catch {
      // Renderer-only devices have no native session catalogue. Relationship review
      // remains usable and the direct capture entry still uses the renderer pipeline.
      setSessions([]);
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      const [nextData, nextTimeline, nextChanges, pending, deferred, resolved] = await Promise.all([
        window.ipc.invoke("relationships:get", { id }),
        window.ipc.invoke("relationships:timeline", { id, limit: 50 }),
        window.ipc.invoke("relationships:changes", { id }),
        window.ipc.invoke("relationships:listIdentityCandidates", {
          status: "pending",
          relationshipId: id,
        }),
        window.ipc.invoke("relationships:listIdentityCandidates", {
          status: "deferred",
          relationshipId: id,
        }),
        window.ipc.invoke("relationships:listIdentityCandidates", {
          status: "resolved",
          relationshipId: id,
        }),
      ]);
      setData(nextData);
      setTimeline(nextTimeline.observations);
      setChanges(nextChanges.snapshots);
      setIdentityCandidates([
        ...pending.candidates,
        ...deferred.candidates,
        ...resolved.candidates,
      ]);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not load the relationship.");
    }
  }, [id, onError]);

  React.useEffect(() => {
    void load();
    void loadSessions();
  }, [load, loadSessions]);

  const act = async (key: string, operation: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key);
    try {
      await operation();
      await load();
      onChanged();
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update this relationship.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const revealEvidence = async (observation: RelationshipObservation) => {
    if (observation.id in evidence) {
      setEvidence((current) => {
        const next = { ...current };
        delete next[observation.id];
        return next;
      });
      return;
    }
    try {
      const result = await window.ipc.invoke("relationships:evidence", {
        relationshipId: id,
        evidenceId: observation.id,
      });
      setEvidence((current) => ({ ...current, [observation.id]: result.payload }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not open source evidence.");
    }
  };

  const target = data
    ? {
        relationshipId: data.relationship.id,
        displayName: data.relationship.displayName,
        ...(data.relationship.primaryEmail ? { primaryEmail: data.relationship.primaryEmail } : {}),
        ...(data.relationship.accountDomain
          ? { accountDomain: data.relationship.accountDomain }
          : {}),
      }
    : null;
  const historicalActions = data
    ? data.actions.filter(
        (action) => !data.recommendations.some((recommendation) => recommendation.id === action.id),
      )
    : [];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(880px,92vw)]">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
          <SheetTitle>{data?.relationship.displayName ?? "Relationship"}</SheetTitle>
          <SheetDescription>
            {data?.relationship.primaryEmail}
            {data?.relationship.accountDomain ? ` · ${data.relationship.accountDomain}` : ""}
          </SheetDescription>
        </SheetHeader>
        {!data ? (
          <p className="px-4 py-6 text-sm text-primary/50">Loading living state…</p>
        ) : (
          <div className="flex flex-col gap-6 px-4 py-5">
            <section>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-[2px] capitalize">
                  {humanize(data.relationship.lifecycle)}
                </Badge>
                <Badge
                  variant="outline"
                  className={`rounded-[2px] capitalize ${HEALTH_TONE[data.relationship.health]}`}
                >
                  {humanize(data.relationship.health)}
                </Badge>
                <Badge variant="secondary" className="capitalize">
                  {humanize(data.relationship.engagement)}
                </Badge>
                <Badge variant="secondary" className="capitalize">
                  {humanize(data.relationship.sentiment)}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-primary/75">
                {data.relationship.stateReason ||
                  data.relationship.summary ||
                  "The state engine is waiting for more evidence."}
              </p>
              <p className="mt-1 text-[11px] text-primary/40">
                {data.relationship.lastChangedAt
                  ? `Updated ${relativeTime(data.relationship.lastChangedAt)}`
                  : "Waiting for the first verified update"}
              </p>
              {target ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {onStartMeeting ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={Boolean(busy) || Boolean(meetingCaptureBlocker)}
                      title={
                        meetingCaptureBlocker
                          ? meetingBlockerDescription(meetingCaptureBlocker)
                          : undefined
                      }
                      onClick={() =>
                        act("start-meeting", async () => {
                          await onStartMeeting(target);
                        })
                      }
                    >
                      <Microphone />
                      {meetingCaptureBlocker
                        ? "Microphone unavailable"
                        : "Record meeting for this account"}
                    </Button>
                  ) : null}
                  {meetingCaptureBlocker ? (
                    <p className="w-full text-xs text-amber-600 dark:text-amber-400" role="status">
                      {meetingBlockerDescription(meetingCaptureBlocker)} Open Transcription in
                      Settings after granting access.
                    </p>
                  ) : null}
                  {sessions.some(
                    (session) =>
                      session.transcribed &&
                      (!session.relationshipTarget ||
                        session.relationshipTarget.relationshipId === target.relationshipId),
                  ) ? (
                    <details className="w-full border border-border p-3 text-xs">
                      <summary className="cursor-pointer font-medium text-primary">
                        Attach a completed recording
                      </summary>
                      <ul className="mt-3 space-y-2">
                        {sessions
                          .filter(
                            (session) =>
                              session.transcribed &&
                              (!session.relationshipTarget ||
                                session.relationshipTarget.relationshipId ===
                                  target.relationshipId),
                          )
                          .slice(0, 10)
                          .map((session) => {
                            const attached =
                              session.relationshipTarget?.relationshipId === target.relationshipId;
                            return (
                              <li
                                key={session.id}
                                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                              >
                                <div>
                                  <p className="font-medium text-primary">
                                    {new Date(session.startedAt).toLocaleString()}
                                  </p>
                                  <p className="text-primary/45">
                                    {session.segmentCount ?? 0} transcript segments
                                    {session.warnings.length
                                      ? ` · ${session.warnings.length} capture warning${session.warnings.length === 1 ? "" : "s"}`
                                      : ""}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={attached || Boolean(busy)}
                                  onClick={() =>
                                    act(`publish-session:${session.id}`, async () => {
                                      const result = await window.ipc.invoke(
                                        "meeting:publishSessionEvidence",
                                        { sessionId: session.id, relationshipTarget: target },
                                      );
                                      if (!result.queued) {
                                        throw new Error(
                                          result.reason || "Recording could not be queued.",
                                        );
                                      }
                                      if (result.published) {
                                        toast.success(
                                          `Published to shared relationship state v${result.relationshipStateVersion ?? "accepted"}.`,
                                        );
                                      } else {
                                        toast.info(
                                          `Saved for publication${result.pending ? ` · ${result.pending} pending` : ""}.`,
                                        );
                                      }
                                      await loadSessions();
                                    })
                                  }
                                >
                                  {attached ? "Attached" : "Attach and publish"}
                                </Button>
                              </li>
                            );
                          })}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </section>

            <MissionControlOverview
              model={data.missionControl}
              busy={Boolean(busy)}
              onAcknowledge={() =>
                act("acknowledge", () =>
                  window.ipc.invoke("relationships:acknowledge", {
                    id,
                    stateVersion: data.missionControl.stateVersion,
                    stateHash: data.missionControl.stateHash,
                  }),
                )
              }
              onRetract={(assertionId, reason) =>
                void act(`retract:${assertionId}`, () =>
                  window.ipc.invoke("relationships:retractAssertion", {
                    relationshipId: id,
                    assertionId,
                    reason,
                  }),
                )
              }
            />

            <details className="rounded-[2px] border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">
                Review model and evidence
              </summary>
              <p className="mt-1 text-xs text-primary/50">
                Identity decisions, manual corrections, imported transcripts, and live cues.
              </p>
              <div className="mt-4 flex flex-col gap-5">
                <IdentityReviewInbox
                  candidates={identityCandidates}
                  onError={onError}
                  onChanged={() => {
                    void load();
                    onChanged();
                  }}
                />

                <StateCorrection
                  key={data.relationship.stateVersion}
                  relationship={data.relationship}
                  disabled={Boolean(busy)}
                  onCorrect={(dimension, value, reason) =>
                    act(`correct:${dimension}`, () =>
                      window.ipc.invoke("relationships:correct", {
                        id,
                        dimension,
                        value,
                        reason,
                      }),
                    )
                  }
                />

                <ImportedTranscriptPublisher
                  relationshipId={id}
                  disabled={Boolean(busy)}
                  onPublish={(observation) =>
                    act("publish-transcript", () =>
                      window.ipc.invoke("relationships:ingestObservations", {
                        observations: [observation],
                      }),
                    )
                  }
                />

                {data.intelligence ? (
                  <CorrectionReview
                    items={data.intelligence.reviewItems}
                    disabled={Boolean(busy)}
                    onCorrect={(item, correctedValue) =>
                      act(`review:${item.id}`, () =>
                        window.ipc.invoke("relationships:correctConversation", {
                          id,
                          reviewItemId: item.id,
                          correctedValue,
                          reason: "User corrected conversation evidence during focused review.",
                        }),
                      )
                    }
                    onDecide={(item, kind, correctedValue, deferUntil) =>
                      act(`review:${item.id}:${kind}`, () =>
                        window.ipc.invoke("relationships:decideConversation", {
                          id,
                          reviewItemId: item.id,
                          kind,
                          correctedValue,
                          deferUntil,
                          reason: "User decided a proposed conversation change.",
                        }),
                      )
                    }
                  />
                ) : null}

                {data.intelligence?.liveCues.length ? (
                  <section>
                    <SectionTitle title={`Live cue cards (${data.intelligence.liveCues.length})`} />
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {data.intelligence.liveCues.map((cue) => (
                        <li
                          key={cue.id}
                          className="rounded-[2px] border border-amber-500/30 bg-amber-500/5 p-3"
                        >
                          <p className="text-xs font-medium text-primary">{cue.title}</p>
                          <p className="mt-1 text-xs text-primary/60">{cue.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </details>

            <TwoColumnList
              leftTitle="Risks"
              left={data.relationship.risks}
              rightTitle="Milestones"
              right={data.relationship.milestones}
            />

            {data.intelligence?.effectivePolicy ? (
              <div
                className="border border-border p-3 text-xs text-primary/60"
                data-capability="privacy-deletion"
              >
                <details>
                  <summary className="cursor-pointer font-medium text-primary">
                    Privacy policy · {humanize(data.intelligence.effectivePolicy.modelRoute)}
                  </summary>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <span>Capture: {humanize(data.intelligence.effectivePolicy.capture)}</span>
                    <span>Retention: {data.intelligence.effectivePolicy.retentionDays} days</span>
                    <span>
                      Evidence:{" "}
                      {data.intelligence.effectivePolicy.publishEvidence ? "allowed" : "blocked"}
                    </span>
                    <span>
                      External share:{" "}
                      {data.intelligence.effectivePolicy.externalShare ? "allowed" : "blocked"}
                    </span>
                  </div>
                  <p className="mt-2 break-all text-[11px]">
                    {data.intelligence.effectivePolicy.policyVersion} ·{" "}
                    {data.intelligence.governanceDecisions.length} recorded decisions
                  </p>
                  {data.intelligence.deletionReceipts[0] ? (
                    <p className="mt-1">
                      Last deletion: {humanize(data.intelligence.deletionReceipts[0].status)}
                    </p>
                  ) : null}
                </details>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={busy === "delete-conversation"}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Delete shared conversation evidence for this relationship? Device and provider copies will remain pending until separately confirmed.",
                      )
                    )
                      return;
                    void act("delete-conversation", () =>
                      window.ipc.invoke("relationships:requestConversationDeletion", {
                        relationshipId: id,
                        requestId: crypto.randomUUID(),
                      }),
                    );
                  }}
                >
                  Delete conversation data
                </Button>
              </div>
            ) : null}

            <section data-capability="commitment-management">
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionTitle
                  title={`Commitment recovery (${data.intelligence?.recoveryEvaluations.length ?? 0})`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === "recovery"}
                  onClick={() =>
                    void act("recovery", () =>
                      window.ipc.invoke("relationships:runCommitmentRecovery", { id }),
                    )
                  }
                >
                  {busy === "recovery" ? <CircleNotch className="animate-spin" /> : null}
                  Reconcile now
                </Button>
              </div>
              {data.intelligence?.recoveryEvaluations.length ? (
                <ul className="space-y-2">
                  {data.intelligence.recoveryEvaluations.map((evaluation) => (
                    <li key={evaluation.evaluationId} className="border border-border p-3 text-xs">
                      <p className="font-medium capitalize text-primary">
                        {humanize(evaluation.classification)}
                      </p>
                      <p className="mt-1 text-primary/60">{evaluation.explanation}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyText>No due commitment has been reconciled yet.</EmptyText>
              )}
              {data.intelligence?.recommendationEvaluations.length ? (
                <details className="mt-2 text-xs text-primary/55">
                  <summary className="cursor-pointer">Inspect ranking factors</summary>
                  {data.intelligence.recommendationEvaluations.map((evaluation) => (
                    <ul key={evaluation.evaluationId} className="mt-2 border-l border-border pl-3">
                      {evaluation.factors.map((factor) => (
                        <li key={factor.factor}>
                          {humanize(factor.factor)}: {factor.contribution >= 0 ? "+" : ""}
                          {factor.contribution} · {factor.reason}
                        </li>
                      ))}
                    </ul>
                  ))}
                </details>
              ) : null}
            </section>

            <section data-capability="governed-actions" data-tour-target="relationship-action">
              <SectionTitle title={`Recommendations (${data.recommendations.length})`} />
              {data.recommendations.length === 0 ? (
                <EmptyText>No action is currently recommended.</EmptyText>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.recommendations.map((action) => (
                    <RecommendationReviewCard
                      key={`${action.id}:${action.revision}`}
                      action={action}
                      busy={busy}
                      act={act}
                    />
                  ))}
                </ul>
              )}
            </section>

            {historicalActions.length ? (
              <details className="rounded-[2px] border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Action history ({historicalActions.length})
                </summary>
                <p className="mb-2 text-xs text-primary/50">
                  Inspect revisions, policy decisions, provider receipts, original evidence, and
                  observed outcomes after an action leaves the active queue.
                </p>
                <ul className="flex flex-col gap-2">
                  {historicalActions.map((action) => (
                    <RecommendationReviewCard
                      key={`${action.id}:${action.revision}`}
                      action={action}
                      busy={busy}
                      act={act}
                    />
                  ))}
                </ul>
              </details>
            ) : null}

            <TwoColumnList
              leftTitle={`People (${data.participants.length})`}
              left={data.participants.map((person) =>
                [person.displayName, person.role, person.title].filter(Boolean).join(" · "),
              )}
              rightTitle={`Commitments (${data.commitments.length})`}
              right={data.commitments.map(
                (commitment) =>
                  `${commitment.text}${commitment.dueAt ? ` · ${relativeTime(commitment.dueAt)}` : ""}`,
              )}
            />

            {data.commitmentDependencies.length ? (
              <section>
                <SectionTitle title={`Commitment graph (${data.commitmentDependencies.length})`} />
                <ul className="mt-2 space-y-2 text-xs">
                  {data.commitmentDependencies.map((dependency) => {
                    const from = data.commitments.find(
                      (item) => item.id === dependency.fromCommitmentId,
                    );
                    const to = data.commitments.find(
                      (item) => item.id === dependency.toCommitmentId,
                    );
                    return (
                      <li key={dependency.dependencyId} className="border border-border p-3">
                        <span>{from?.text ?? "Unknown commitment"}</span>
                        <Badge variant="secondary" className="mx-2 capitalize">
                          {dependency.kind}
                        </Badge>
                        <span>{to?.text ?? "Unknown commitment"}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section data-capability="mutual-action-plans">
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionTitle
                  title={`Mutual action plans (${data.intelligence?.mutualActionPlans.length ?? 0})`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    Boolean(busy) ||
                    !data.commitments.some((item) => item.acceptance === "accepted")
                  }
                  onClick={() =>
                    void act("create-plan", () =>
                      window.ipc.invoke("relationships:createMutualActionPlan", {
                        relationshipId: id,
                        commitmentIds: data.commitments
                          .filter(
                            (item) => item.acceptance === "accepted" && item.status === "open",
                          )
                          .map((item) => item.id),
                      }),
                    )
                  }
                >
                  Create from accepted promises
                </Button>
              </div>
              {data.commitments.some((item) => item.acceptance === "internally_confirmed") ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {data.commitments
                    .filter((item) => item.acceptance === "internally_confirmed")
                    .map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(`accept:${item.id}`, () =>
                            window.ipc.invoke("relationships:appendCommitmentTransition", {
                              relationshipId: id,
                              commitmentId: item.id,
                              kind: "accepted",
                              idempotencyKey: `user-accepted:${item.id}`,
                              reason: "User confirmed counterparty acceptance.",
                              evidenceRefs: [`user-decision:${item.id}:accepted`],
                            }),
                          )
                        }
                      >
                        Confirm accepted: {item.text}
                      </Button>
                    ))}
                </div>
              ) : null}
              {data.intelligence?.mutualActionPlans.length ? (
                <ul className="space-y-2">
                  {data.intelligence.mutualActionPlans.map((plan) => (
                    <li key={plan.planId} className="border border-border p-3 text-xs">
                      <p className="font-medium capitalize text-primary">
                        {humanize(plan.status)} · revision {plan.currentRevision.version}
                      </p>
                      <PlanItemEditor
                        planId={plan.planId}
                        relationshipId={id}
                        items={plan.currentRevision.items}
                        editable={plan.status === "draft" || plan.status === "revised"}
                        busy={Boolean(busy)}
                        onRevise={(items) =>
                          act(`revise-plan:${plan.planId}`, () =>
                            window.ipc.invoke("relationships:reviseMutualActionPlan", {
                              relationshipId: id,
                              planId: plan.planId,
                              items,
                            }),
                          )
                        }
                      />
                      <div className="mt-2 flex gap-1.5">
                        {plan.status === "draft" || plan.status === "revised" ? (
                          <Button
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void act(`approve-plan:${plan.planId}`, () =>
                                window.ipc.invoke("relationships:approveMutualActionPlan", {
                                  relationshipId: id,
                                  planId: plan.planId,
                                }),
                              )
                            }
                          >
                            Approve revision
                          </Button>
                        ) : null}
                        {plan.status === "internally_approved" ? (
                          <Button
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void act(`share-plan:${plan.planId}`, () =>
                                window.ipc.invoke("relationships:shareMutualActionPlan", {
                                  relationshipId: id,
                                  planId: plan.planId,
                                }),
                              )
                            }
                          >
                            Queue exact revision for sharing
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyText>Accept a commitment to build an evidence-backed shared plan.</EmptyText>
              )}
            </section>

            <section data-capability="contradiction-resolution">
              <SectionTitle title={`What changed (${changes.length})`} />
              {data.intelligence?.delta.changes.length ? (
                <ul className="mb-3 flex flex-col gap-2">
                  {data.intelligence.delta.changes.map((change) => (
                    <li key={change.dimension} className="rounded-[2px] border border-border p-3">
                      <p className="text-xs font-medium capitalize text-primary">
                        {humanize(change.dimension)}
                      </p>
                      <p className="mt-1 text-xs text-primary/60">
                        Changed from {formatRelationshipChangeValue(change.before)} to{" "}
                        {formatRelationshipChangeValue(change.after)}.
                      </p>
                      {change.reason ? (
                        <p className="mt-1 text-[11px] text-primary/40">{change.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {data.intelligence?.contradictionCases.length ? (
                <ul className="mb-3 space-y-2 rounded-[2px] border border-amber-500/30 p-3 text-xs text-primary/60">
                  {data.intelligence.contradictionCases.map((item) => (
                    <li key={item.caseId}>
                      <span className="font-medium capitalize text-primary">
                        {humanize(item.dimension)}:
                      </span>{" "}
                      {item.status === "open"
                        ? `Choose the current value from ${item.sides.length} evidence-backed options.`
                        : item.reason}
                      <span className="ml-1 text-primary/40">
                        ({item.sides.map((side) => side.source).join(" vs ")})
                      </span>
                      {item.status === "open" ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.sides.map((side) => (
                            <Button
                              key={side.assertionId}
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy === item.caseId}
                              onClick={() =>
                                void act(item.caseId, () =>
                                  window.ipc.invoke("relationships:resolveContradiction", {
                                    id,
                                    caseId: item.caseId,
                                    selectedAssertionId: side.assertionId,
                                    reason: `Selected ${side.source} as current evidence.`,
                                  }),
                                )
                              }
                            >
                              Use {String("value" in side.value ? side.value.value : side.source)}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {data.intelligence?.delta.uncertainClaimIds.length ? (
                <p className="mb-3 text-xs text-primary/50">
                  {data.intelligence.delta.uncertainClaimIds.length} material claim
                  {data.intelligence.delta.uncertainClaimIds.length === 1
                    ? " remains"
                    : "s remain"}{" "}
                  uncertain and queued for focused review.
                </p>
              ) : null}
              {data.intelligence?.delta.recommendationReason ? (
                <p className="mb-3 rounded-[2px] border border-border p-3 text-xs text-primary/60">
                  <span className="font-medium text-primary">Why the recommendation changed:</span>{" "}
                  {data.intelligence.delta.recommendationReason}
                </p>
              ) : null}
              {changes.length === 0 ? (
                <EmptyText>No projected state changes yet.</EmptyText>
              ) : (
                <ul className="flex flex-col gap-2">
                  {changes.map((snapshot) => (
                    <li key={snapshot.id} className="flex gap-3 border-l border-border pl-3">
                      <ClockCounterClockwise className="mt-0.5 size-4 shrink-0 text-primary/35" />
                      <div>
                        <p className="text-xs text-primary/70">
                          {snapshot.changedDimensions.map(humanize).join(", ")}
                        </p>
                        <p className="text-[11px] text-primary/35">
                          Changed {relativeTime(snapshot.createdAt)}
                        </p>
                        <details className="mt-1 text-[11px] text-primary/35">
                          <summary className="cursor-pointer">Audit details</summary>
                          State version {snapshot.version}
                        </details>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.intelligence?.governanceReceipts.length ? (
              <section>
                <SectionTitle title="Consent and governance" />
                <ul className="flex flex-col gap-2">
                  {data.intelligence.governanceReceipts.slice(0, 5).map((receipt) => (
                    <li
                      key={receipt.receiptId}
                      className="rounded-[2px] border border-border p-3 text-xs text-primary/60"
                    >
                      <p>
                        {humanize(receipt.capturePolicy)} · {humanize(receipt.routing)}
                      </p>
                      <p className="mt-1 text-[11px] text-primary/40">
                        {receipt.region} · retention {receipt.retention} · disclosure{" "}
                        {humanize(receipt.participantDisclosure)} ·{" "}
                        {humanize(receipt.deletionOutcome)}
                      </p>
                      <p className="mt-1 text-[11px] text-primary/40">
                        legal hold {receipt.legalHold ? "active" : "off"} · evidence clip{" "}
                        {humanize(receipt.evidenceClip)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <SectionTitle title={`Evidence timeline (${timeline.length})`} />
              {timeline.length === 0 ? (
                <EmptyText>No observations yet.</EmptyText>
              ) : (
                <ul className="flex flex-col divide-y divide-primary/10 rounded-[2px] border border-border">
                  {timeline.map((observation) => (
                    <li key={observation.id} className="p-3">
                      <button
                        type="button"
                        onClick={() => void revealEvidence(observation)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium capitalize text-primary">
                            {observation.source} · {humanize(observation.eventType)}
                          </span>
                          <span className="text-[11px] text-primary/35">
                            {relativeTime(observation.occurredAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-primary/55">
                          {observation.summary || "Open the source evidence"}
                        </p>
                      </button>
                      {observation.id in evidence ? (
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-[2px] bg-background-100 p-2 text-[11px] text-primary/60 dark:bg-background-200">
                          {JSON.stringify(evidence[observation.id], null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RecommendationReviewCard({
  action,
  busy,
  act,
}: {
  action: RelationshipAction;
  busy: string | null;
  act: (key: string, operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [subject, setSubject] = React.useState(action.proposedSubject ?? "");
  const [message, setMessage] = React.useState(action.proposedMessage ?? "");
  const dirty =
    subject !== (action.proposedSubject ?? "") || message !== (action.proposedMessage ?? "");
  const uncertain =
    action.executionStatus === "ambiguous" || action.reconciliationStatus === "manual_review";
  const canApprove =
    action.approvalStatus === "pending" &&
    (action.policyStatus === "passed" || action.policyStatus === "review_required");
  const canExecute =
    action.approvalStatus === "approved" &&
    action.approvedRevision === action.revision &&
    action.executionStatus === "pending";
  const canEditContent = action.executionStatus === "pending" && action.queueStatus === "open";

  return (
    <li className="rounded-[2px] border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-primary">
            {ACTION_TYPE_LABELS[action.actionType] ?? action.actionType}
          </p>
          <p className="mt-1 text-xs text-primary/60">{action.reason}</p>
        </div>
        <ModeChip mode={action.executionMode} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-primary/40">
        <span>{DETECTOR_LABELS[action.detector] ?? action.detector}</span>
        <span>{humanize(action.channel)}</span>
        {action.policyStatus === "review_required" ? <span>Policy review required</span> : null}
      </div>
      <details className="mt-2 text-[11px] text-primary/45">
        <summary className="cursor-pointer">Audit details</summary>
        <p className="mt-1">
          Priority score {action.priorityScore} · revision {action.revision} · policy{" "}
          {humanize(action.policyStatus)}
        </p>
      </details>

      {uncertain ? (
        <div className="mt-3 border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-medium">Provider result uncertain — do not retry</p>
          <p className="mt-1">
            Oppulence is checking the provider read-only. Status:{" "}
            {humanize(action.reconciliationStatus || "pending")}
            {action.reconciliationAttempts
              ? ` after ${action.reconciliationAttempts} attempt${action.reconciliationAttempts === 1 ? "" : "s"}`
              : ""}
            .
          </p>
          {action.reconciliationError ? <p className="mt-1">{action.reconciliationError}</p> : null}
        </div>
      ) : null}
      {action.executionStatus === "failed" ? (
        <div className="mt-3 border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
          Provider rejected or failed the action.{" "}
          {action.executionError || "Review the destination and policy before retrying."}
        </div>
      ) : null}
      {action.executionStatus === "sent" ? (
        <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          Provider accepted this exact revision
          {action.providerMessageId ? ` · receipt ${action.providerMessageId}` : ""}.
        </div>
      ) : null}

      {action.evidence.length > 0 ? (
        <details className="mt-2 text-xs text-primary/55">
          <summary className="cursor-pointer">Inspect supporting words</summary>
          <ul className="mt-2 space-y-1 border-l border-border pl-3">
            {action.evidence.map((item) => (
              <li key={item.id}>“{item.excerpt || "Evidence excerpt unavailable"}”</li>
            ))}
          </ul>
        </details>
      ) : null}

      {action.proposedSubject ||
      action.proposedMessage ||
      action.channel === "email" ||
      action.channel === "slack" ? (
        <details className="mt-3" open={action.approvalStatus === "pending"}>
          <summary className="cursor-pointer text-xs font-medium text-primary">
            Review exact content and destination
          </summary>
          <div className="mt-2 space-y-2">
            {action.recipientEmail ? (
              <Input value={action.recipientEmail} readOnly aria-label="Action destination" />
            ) : null}
            {action.channel === "email" ? (
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={!canEditContent}
                aria-label="Action subject"
                placeholder="Subject"
              />
            ) : null}
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!canEditContent}
              aria-label="Action message"
              placeholder="Message"
            />
            {dirty && canEditContent ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(`edit:${action.id}`, () =>
                    window.ipc.invoke("relationships:editAction", {
                      actionId: action.id,
                      proposedSubject: subject,
                      proposedMessage: message,
                      reason: "User edited the exact proposed content.",
                    }),
                  )
                }
              >
                Save as new revision
              </Button>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {action.policyStatus === "pending" || action.policyStatus === "stale" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(`evaluate:${action.id}`, () =>
                window.ipc.invoke("relationships:evaluateAction", { actionId: action.id }),
              )
            }
          >
            {busy === `evaluate:${action.id}` ? <CircleNotch className="animate-spin" /> : null}{" "}
            Check policy
          </Button>
        ) : null}
        {canApprove ? (
          <Button
            type="button"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(`approve:${action.id}`, () =>
                window.ipc.invoke("relationships:approve", {
                  actionId: action.id,
                  acceptRisk: action.policyStatus === "review_required",
                }),
              )
            }
          >
            {busy === `approve:${action.id}` ? <CircleNotch className="animate-spin" /> : <Check />}{" "}
            Approve exact revision
          </Button>
        ) : null}
        {canExecute ? (
          <Button
            type="button"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(`execute:${action.id}`, () =>
                window.ipc.invoke("relationships:executeAction", { actionId: action.id }),
              )
            }
          >
            {busy === `execute:${action.id}` ? <CircleNotch className="animate-spin" /> : null}
            {action.executionMode === "send"
              ? `Execute ${humanize(action.channel)} action`
              : "Create provider draft"}
          </Button>
        ) : null}
        {action.approvalStatus === "pending" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(`reject:${action.id}`, () =>
                window.ipc.invoke("relationships:reject", {
                  actionId: action.id,
                  reason: "Not the right next move",
                }),
              )
            }
          >
            <X /> Reject
          </Button>
        ) : null}
        {action.queueStatus === "open" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void act(`snooze:${action.id}`, () =>
                  window.ipc.invoke("relationships:snoozeAction", {
                    actionId: action.id,
                    until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                  }),
                )
              }
            >
              Snooze 1d
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void act(`dismiss:${action.id}`, () =>
                  window.ipc.invoke("relationships:dismissAction", {
                    actionId: action.id,
                    reason: "Dismissed from Account Mission Control.",
                  }),
                )
              }
            >
              Dismiss
            </Button>
          </>
        ) : null}
      </div>
      <ActionAuditPanel action={action} busy={busy} act={act} />
    </li>
  );
}

function ActionAuditPanel({
  action,
  busy,
  act,
}: {
  action: RelationshipAction;
  busy: string | null;
  act: (key: string, operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [audit, setAudit] = React.useState<RelationshipActionAudit | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [sourceBody, setSourceBody] = React.useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = React.useState(false);
  const [outcome, setOutcome] =
    React.useState<(typeof MANUAL_OUTCOME_OPTIONS)[number]["value"]>("replied");

  const loadAudit = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setAudit(await window.ipc.invoke("relationships:actionAudit", { actionId: action.id }));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not load action history.");
    } finally {
      setLoading(false);
    }
  }, [action.id]);

  const loadSourceBody = async () => {
    setSourceLoading(true);
    try {
      setSourceBody(
        await window.ipc.invoke("relationships:actionSourceBody", { actionId: action.id }),
      );
    } catch {
      setSourceBody("(No original source body is linked to this action.)");
    } finally {
      setSourceLoading(false);
    }
  };

  return (
    <details
      className="mt-3 border-t border-border pt-3 text-xs"
      data-capability="action-audit outcome-observation"
      onToggle={(event) => {
        if (event.currentTarget.open && !audit && !loading) void loadAudit();
      }}
    >
      <summary className="cursor-pointer font-medium text-primary">
        Audit history and outcomes
      </summary>
      {loading && !audit ? <p className="mt-2 text-primary/45">Loading history…</p> : null}
      {loadError ? <p className="mt-2 text-destructive">{loadError}</p> : null}
      {audit ? (
        <div className="mt-3 space-y-4">
          <div>
            <p className="font-medium text-primary">Lifecycle</p>
            <p className="mt-1 text-primary/55">
              Created {relativeTime(audit.action.createdAt)} · policy{" "}
              {humanize(audit.action.policyStatus)}
              {audit.action.approvedAt
                ? ` · approved ${relativeTime(audit.action.approvedAt)}`
                : ""}
              {audit.action.executedAt
                ? ` · executed ${relativeTime(audit.action.executedAt)}`
                : ""}
            </p>
          </div>
          <div>
            <p className="font-medium text-primary">Revisions ({audit.revisions.length})</p>
            <ul className="mt-1 space-y-1 text-primary/55">
              {audit.revisions.map((revision) => (
                <li key={revision.revision} className="border-l border-border pl-2">
                  Rev {revision.revision} · {humanize(revision.actionType)} ·{" "}
                  {humanize(revision.channel)} · {revision.revisionHash.slice(0, 14)}…
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-primary">Policy decisions ({audit.decisions.length})</p>
            {audit.decisions.length ? (
              <ul className="mt-1 space-y-1 text-primary/55">
                {audit.decisions.map((decision) => (
                  <li key={decision.id} className="border-l border-border pl-2">
                    Rev {decision.revision} · {humanize(decision.status)} ·{" "}
                    {relativeTime(decision.evaluatedAt)}
                    {decision.reasonCodes?.length ? ` · ${decision.reasonCodes.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-primary/45">No preflight has run yet.</p>
            )}
          </div>
          <div>
            <p className="font-medium text-primary">Outcomes ({audit.outcomes.length})</p>
            {audit.outcomes.length ? (
              <ul className="mt-1 space-y-1 text-primary/55">
                {audit.outcomes.map((item) => (
                  <li key={item.id} className="border-l border-border pl-2">
                    {titleize(item.kind)} · {item.source} · {relativeTime(item.occurredAt)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-primary/45">No outcomes recorded yet.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                value={outcome}
                onValueChange={(value) => setOutcome(value as typeof outcome)}
              >
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="app-shell rounded-[2px]">
                  {MANUAL_OUTCOME_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(`outcome:${action.id}`, async () => {
                    await window.ipc.invoke("relationships:recordOutcome", {
                      actionId: action.id,
                      kind: outcome,
                      sourceEventId: `manual:${crypto.randomUUID()}`,
                      occurredAt: new Date().toISOString(),
                    });
                    await loadAudit();
                  })
                }
              >
                {busy === `outcome:${action.id}` ? (
                  <CircleNotch className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Log outcome
              </Button>
            </div>
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={sourceLoading}
              onClick={() => void loadSourceBody()}
            >
              {sourceLoading ? <CircleNotch className="animate-spin" /> : null}
              View original source body
            </Button>
            {sourceBody !== null ? (
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap bg-background-100 p-2 text-[11px] text-primary/60 dark:bg-background-200">
                {sourceBody}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}

function CorrectionReview({
  items,
  disabled,
  onCorrect,
  onDecide,
}: {
  items: ConversationReviewItem[];
  disabled: boolean;
  onCorrect: (item: ConversationReviewItem, correctedValue: string) => void;
  onDecide: (
    item: ConversationReviewItem,
    kind: "approve" | "correct" | "reject" | "defer",
    correctedValue?: string,
    deferUntil?: string,
  ) => void;
}) {
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (items.length === 0) return null;
  return (
    <section
      className="rounded-[2px] border border-amber-500/30 bg-amber-500/5 p-3"
      data-capability="conversation-review"
    >
      <SectionTitle title={`Focused evidence review (${items.length})`} />
      <p className="mb-3 text-xs text-primary/55">
        Approve, correct, reject, or defer each proposed material change before it affects state.
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = drafts[item.id] ?? item.currentValue;
          return (
            <li key={item.id} className="rounded-[2px] border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-primary">{item.label}</p>
                <span className="text-[11px] text-primary/40">
                  {Math.round(item.confidence * 100)}% · {item.kind}
                </span>
              </div>
              {item.exactQuote ? (
                <blockquote className="my-2 border-l border-border pl-2 text-xs text-primary/55">
                  “{item.exactQuote}”
                </blockquote>
              ) : null}
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
                {item.batchId ? (
                  <>
                    <Button size="sm" disabled={disabled} onClick={() => onDecide(item, "approve")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled || !draft.trim() || draft.trim() === item.currentValue}
                      onClick={() => onDecide(item, "correct", draft.trim())}
                    >
                      Correct
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onDecide(item, "reject")}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        onDecide(
                          item,
                          "defer",
                          undefined,
                          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        )
                      }
                    >
                      Defer 1 day
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || !draft.trim() || draft.trim() === item.currentValue}
                    onClick={() => onCorrect(item, draft.trim())}
                  >
                    Correct
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StateCorrection({
  relationship,
  disabled,
  onCorrect,
}: {
  relationship: Relationship;
  disabled: boolean;
  onCorrect: (
    dimension: "lifecycle" | "engagement" | "sentiment" | "health",
    value: string,
    reason: string,
  ) => void;
}) {
  const [dimension, setDimension] = React.useState<
    "lifecycle" | "engagement" | "sentiment" | "health"
  >("health");
  const [value, setValue] = React.useState<string>(relationship.health);
  const [reason, setReason] = React.useState("");
  const options =
    dimension === "lifecycle"
      ? LIFECYCLE_OPTIONS
      : dimension === "engagement"
        ? ENGAGEMENT_OPTIONS
        : dimension === "sentiment"
          ? ["unknown", "positive", "mixed", "negative"]
          : HEALTH_OPTIONS;

  return (
    <section
      className="rounded-[2px] border border-dashed border-border p-3"
      data-capability="state-correction"
    >
      <SectionTitle title="Correct the model" />
      <div className="grid gap-2 sm:grid-cols-[130px_150px_1fr_auto]">
        <Select
          value={dimension}
          onValueChange={(next) => {
            const nextDimension = next as typeof dimension;
            setDimension(nextDimension);
            setValue(relationship[nextDimension]);
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="app-shell rounded-[2px]">
            {["health", "lifecycle", "engagement", "sentiment"].map((item) => (
              <SelectItem key={item} value={item}>
                {humanize(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="app-shell rounded-[2px]">
            {options.map((item) => (
              <SelectItem key={item} value={item}>
                {humanize(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is the model wrong?"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !reason.trim() || value === relationship[dimension]}
          onClick={() => onCorrect(dimension, value, reason.trim())}
        >
          Correct
        </Button>
      </div>
    </section>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-primary/45">{title}</h3>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-primary/45">{children}</p>;
}

function TwoColumnList({
  leftTitle,
  left,
  rightTitle,
  right,
}: {
  leftTitle: string;
  left: string[];
  rightTitle: string;
  right: string[];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {[
        [leftTitle, left],
        [rightTitle, right],
      ].map(([title, items]) => (
        <section key={title as string}>
          <SectionTitle title={title as string} />
          {(items as string[]).length === 0 ? (
            <EmptyText>None recorded.</EmptyText>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label={title as string}>
              {(items as string[]).map((item, index) => (
                <li
                  key={`${item}:${index}`}
                  className="flex gap-1.5 text-xs text-primary/65"
                  aria-label={item}
                >
                  <span aria-hidden="true">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <Badge variant="outline" className="rounded-[2px] font-normal capitalize">
      {humanize(mode)}
    </Badge>
  );
}

function ListSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-[2px] border border-border p-4 text-sm text-primary/45">
      <CircleNotch className="size-4 animate-spin" />
      Loading relationship state…
    </div>
  );
}

function EmptyBlock({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2px] border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-background-200 text-primary/50 dark:bg-background-100">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-medium text-primary">{title}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-primary/60">{body}</p>
      </div>
      {children}
    </div>
  );
}

function CreateRelationshipDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string | null) => void;
}) {
  const [kind, setKind] = React.useState("company");
  const [displayName, setDisplayName] = React.useState("");
  const [primaryEmail, setPrimaryEmail] = React.useState("");
  const [accountDomain, setAccountDomain] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!displayName.trim()) return;
    setBusy(true);
    onError(null);
    try {
      await window.ipc.invoke("relationships:create", {
        kind,
        displayName: displayName.trim(),
        primaryEmail: primaryEmail.trim() || undefined,
        accountDomain: accountDomain.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      onCreated();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not create the relationship.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New relationship</DialogTitle>
          <DialogDescription>
            Create a canonical account or contact. Connected evidence will enrich its state.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-[2px]">
              {KIND_OPTIONS.map((item) => (
                <SelectItem key={item} value={item}>
                  {titleize(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            autoFocus
            aria-label="Account or person name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Account or person name"
          />
          <Input
            value={accountDomain}
            onChange={(event) => setAccountDomain(event.target.value)}
            placeholder="Account domain (optional)"
          />
          <Input
            value={primaryEmail}
            onChange={(event) => setPrimaryEmail(event.target.value)}
            placeholder="Primary email (optional)"
          />
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Relationship context (optional)"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !displayName.trim()}>
            {busy ? <CircleNotch className="animate-spin" /> : <Plus />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PlanItem = {
  itemId: string;
  commitmentId?: string;
  milestoneRef?: string;
  title: string;
  ownerParticipantRef: string;
  dependencyItemIds: string[];
  dueAt?: string;
  status: "open" | "blocked" | "completed" | "cancelled";
  evidenceRefs: string[];
};

const PLAN_ITEM_STATUSES = ["open", "blocked", "completed", "cancelled"] as const;

/**
 * Edit a mutual action plan before approving it.
 *
 * `relationships:reviseMutualActionPlan` had a handler and no caller: the plan
 * could be created, approved and shared, but never changed. A plan assembled
 * from accepted commitments was take-it-or-leave-it, and the only way to fix a
 * wrong owner or a stale due date was to not approve it at all.
 *
 * Two deliberate limits. Items can be edited and dropped but not invented,
 * because every item carries `evidenceRefs` tying it to something that actually
 * happened — a hand-typed row would be an assertion with no evidence behind it,
 * which is the one thing this whole model refuses to do. And the last item
 * cannot be removed: the API requires at least one, and an empty plan is a
 * deletion wearing a revision's clothes.
 */
function PlanItemEditor({
  items,
  editable,
  busy,
  onRevise,
}: {
  planId: string;
  relationshipId: string;
  items: PlanItem[];
  editable: boolean;
  busy: boolean;
  onRevise: (items: PlanItem[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState<PlanItem[] | null>(null);

  const edit = (index: number, patch: Partial<PlanItem>) => {
    setDraft((current) =>
      (current ?? items).map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const drop = (index: number) => {
    setDraft((current) => {
      const next = (current ?? items).filter((_, i) => i !== index);
      return next.length === 0 ? (current ?? items) : next;
    });
  };

  if (!editable || draft === null) {
    return (
      <>
        <ul className="mt-1 list-disc pl-4 text-primary/60">
          {items.map((item) => (
            <li key={item.itemId}>
              {item.title} · {item.ownerParticipantRef}
              {item.status !== "open" ? ` · ${item.status}` : ""}
            </li>
          ))}
        </ul>
        {editable ? (
          <button
            type="button"
            className="mt-1 text-[11px] underline underline-offset-2 text-primary/60 hover:text-primary"
            onClick={() => setDraft(items)}
          >
            Revise items
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {draft.map((item, index) => (
        <div key={item.itemId} className="border border-border/60 p-2">
          <input
            value={item.title}
            onChange={(e) => edit(index, { title: e.target.value })}
            className="w-full bg-transparent text-xs outline-none"
            aria-label="Item title"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input
              value={item.ownerParticipantRef}
              onChange={(e) => edit(index, { ownerParticipantRef: e.target.value })}
              className="min-w-0 flex-1 border border-border/60 bg-transparent px-1.5 py-0.5 text-[11px] outline-none"
              aria-label="Item owner"
            />
            <select
              value={item.status}
              onChange={(e) => edit(index, { status: e.target.value as PlanItem["status"] })}
              className="border border-border/60 bg-transparent px-1 py-0.5 text-[11px]"
              aria-label="Item status"
            >
              {PLAN_ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={item.dueAt ? item.dueAt.slice(0, 10) : ""}
              onChange={(e) =>
                edit(index, {
                  dueAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                })
              }
              className="border border-border/60 bg-transparent px-1 py-0.5 text-[11px]"
              aria-label="Item due date"
            />
            <button
              type="button"
              className="text-[11px] text-primary/50 underline underline-offset-2 hover:text-destructive disabled:opacity-40"
              disabled={draft.length === 1}
              title={draft.length === 1 ? "A plan needs at least one item" : "Remove this item"}
              onClick={() => drop(index)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            void onRevise(draft).then((ok) => {
              if (ok) setDraft(null);
            });
          }}
        >
          Save revision
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
