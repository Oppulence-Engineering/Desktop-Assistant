"use client";

import * as React from "react";
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
  DownloadSimple,
  Graph,
  ListBullets,
  MagnifyingGlass,
  Plus,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";

import { EmptyBlock, errMessage, ListSkeleton, ModeChip } from "@/components/revenue/shared";
import { RelationshipGraphWorkspace } from "@/components/revenue/relationship-graph";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { DateTimePicker } from "@oppulence/ui/components/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Input } from "@oppulence/ui/components/input";
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
import { ToggleGroup, ToggleGroupItem } from "@oppulence/ui/components/toggle-group";
import {
  ACTION_TYPE_LABELS,
  acknowledgeMissionControl,
  decideIdentityCandidate,
  decideRelationshipAttention,
  approveRecommendation,
  correctConversationReview,
  decideConversationReview,
  correctRelationship,
  createRelationship,
  deletePerson,
  DETECTOR_LABELS,
  getRelationship,
  getRelationshipBetaDiagnostics,
  getRelationshipChanges,
  getRelationshipEvidence,
  getRelationshipTimeline,
  ingestRelationshipObservations,
  listRelationships,
  listIdentityCandidates,
  listRelationshipAttention,
  listRelationshipSources,
  listRelationshipSourceStatuses,
  disconnectRelationshipSource,
  resyncRelationshipSource,
  rejectRecommendation,
  resolveRelationshipContradiction,
  runCommitmentRecovery,
  appendCommitmentTransition,
  createMutualActionPlan,
  approveMutualActionPlan,
  shareMutualActionPlan,
  requestConversationDeletion,
  retractRelationshipAssertion,
  RELATIONSHIP_KIND_LABELS,
  RevenueAPIError,
  relativeTime,
  semanticSearch,
  type SemanticMatch,
} from "@/lib/revenue";
import type {
  ConversationReviewItem,
  MissionControlReadModel,
  RelationshipIdentityCandidate,
  RelationshipAttentionItem,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipSourceStatus,
  RelationshipSourceInventoryItem,
  RelationshipStateSnapshot,
  RevenueRelationship,
} from "@/types/revenue";

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

const humanize = (value?: string) => (value || "unknown").replaceAll("_", " ");

export function RelationshipsView({
  onError,
  onNotice,
  onOpenConnectors,
}: {
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onOpenConnectors?: () => void;
}) {
  const [rows, setRows] = React.useState<RevenueRelationship[]>([]);
  const [sources, setSources] = React.useState<RelationshipSourceStatus[]>([]);
  const [identityCandidates, setIdentityCandidates] = React.useState<
    RelationshipIdentityCandidate[]
  >([]);
  const [attention, setAttention] = React.useState<RelationshipAttentionItem[]>([]);
  const [sourceInventory, setSourceInventory] = React.useState<RelationshipSourceInventoryItem[]>(
    [],
  );
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [health, setHealth] = React.useState("all");
  const [lifecycle, setLifecycle] = React.useState("all");
  const [surface, setSurface] = React.useState<"list" | "graph">("list");

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("graph") !== "1") return;
    const timer = window.setTimeout(() => setSurface("graph"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [
        relationships,
        sourceStatuses,
        inventory,
        pendingCandidates,
        deferredCandidates,
        attentionItems,
      ] = await Promise.all([
        listRelationships({
          q: query.trim() || undefined,
          health: health === "all" ? undefined : health,
          lifecycle: lifecycle === "all" ? undefined : lifecycle,
        }),
        listRelationshipSourceStatuses(),
        listRelationshipSources(),
        listIdentityCandidates("pending"),
        listIdentityCandidates("deferred"),
        listRelationshipAttention("open"),
      ]);
      setRows(relationships);
      setSources(sourceStatuses);
      setSourceInventory(inventory);
      setIdentityCandidates([...pendingCandidates, ...deferredCandidates]);
      setAttention(attentionItems);
    } catch (e) {
      if (e instanceof RevenueAPIError && e.status === 404) return;
      onError(errMessage(e, "Could not load relationship intelligence."));
    } finally {
      setLoading(false);
    }
  }, [health, lifecycle, onError, query]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const exportDiagnostics = React.useCallback(async () => {
    try {
      const bundle = await getRelationshipBetaDiagnostics();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `oppulence-beta-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      onNotice("Redacted beta diagnostics exported.");
    } catch (error) {
      onError(errMessage(error, "Could not export beta diagnostics."));
    }
  }, [onError, onNotice]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[2px] border border-border bg-background-50 p-4 dark:bg-background-100/30">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
              Account mission control
            </p>
            <h2 className="mt-1 text-base font-semibold text-primary">
              Which relationship needs action now?
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-primary/55">
              One living state across email, meetings, Slack, CRM, and revenue evidence. Every
              recommendation explains what changed and waits for approval.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SourceHealth statuses={sources} />
            <ToggleGroup
              type="single"
              value={surface}
              onValueChange={(value) => {
                if (value === "list" || value === "graph") setSurface(value);
              }}
              variant="outline"
              size="sm"
              aria-label="Relationship view"
            >
              <ToggleGroupItem value="list" aria-label="Show accounts">
                <ListBullets /> Accounts
              </ToggleGroupItem>
              <ToggleGroupItem
                value="graph"
                aria-label="Show relationship graph"
                data-capability="relationship-graph graph-query graph-saved-views graph-governed-actions"
              >
                <Graph /> Graph
              </ToggleGroupItem>
            </ToggleGroup>
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
          relationships={rows}
          onOpenRelationship={setDetail}
          onError={onError}
          onNotice={onNotice}
        />
      ) : (
        <>
          <PortfolioAttentionQueue
            items={attention}
            onOpenRelationship={setDetail}
            onError={onError}
            onChanged={() => void load()}
          />

          <SemanticSearch onError={onError} />

          <SourceConnectionCards
            inventory={sourceInventory}
            onOpenConnectors={onOpenConnectors}
            onError={onError}
            onChanged={() => void load()}
          />

          <IdentityReviewInbox
            candidates={identityCandidates}
            onError={onError}
            onChanged={() => {
              onNotice("Identity decision applied.");
              void load();
            }}
          />

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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDetail(relationship.id)}
                    className="h-auto w-full justify-start rounded-none px-4 py-3 text-left hover:bg-background-100/60 dark:hover:bg-background-100/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-primary">
                          {relationship.displayName}
                        </span>
                        <Badge variant="outline" className="rounded-[2px] font-normal capitalize">
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
                        {relationship.openActions} action{relationship.openActions === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {detail ? (
        <RelationshipSheet
          id={detail}
          onClose={() => setDetail(null)}
          onError={onError}
          onChanged={() => {
            onNotice("Relationship state updated.");
            void load();
          }}
        />
      ) : null}

      {creating ? (
        <CreateRelationshipDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onNotice("Relationship added.");
            void load();
          }}
          onError={onError}
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
}: {
  items: RelationshipAttentionItem[];
  onOpenRelationship: (id: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  if (items.length === 0) return null;

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
      await decideRelationshipAttention(item.id, {
        decision,
        reason,
        expectedVersion: item.version,
        snoozedUntil:
          decision === "snooze"
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : undefined,
      });
      onChanged();
    } catch (error) {
      onError(errMessage(error, "Could not update the attention item."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="portfolio-attention-heading"
      className="space-y-2"
      data-capability="attention-queue"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
            Portfolio attention
          </p>
          <h3 id="portfolio-attention-heading" className="text-sm font-medium text-primary">
            {items.length} relationship{items.length === 1 ? "" : "s"} need review
          </h3>
        </div>
        <span className="text-[11px] text-primary/40">Deterministic order · factors visible</span>
      </div>
      <ol className="space-y-2">
        {items.slice(0, 10).map((item) => (
          <li key={item.id} className="rounded-[2px] border border-border p-3">
            <div className="flex flex-wrap items-start gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start rounded-[8px] p-0 text-left hover:bg-transparent"
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
                    {relationshipLabel(item.reasonCode)} · {item.rankScore}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-primary/60">{item.explanation}</p>
              </Button>
              <div className="flex flex-wrap gap-1">
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
                  Review
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void decide(item, "snooze")}
                >
                  Snooze 1d
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void decide(item, "dismiss")}
                >
                  Dismiss
                </Button>
              </div>
            </div>
            <details className="mt-2 text-[11px] text-primary/50">
              <summary className="cursor-pointer">Why this rank?</summary>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(item.rankFactors).map(([factor, contribution]) => (
                  <span key={factor}>
                    {relationshipLabel(factor)}: {contribution >= 0 ? "+" : ""}
                    {contribution}
                  </span>
                ))}
                {item.sourceRequirements.length > 0 ? (
                  <span>Requires: {item.sourceRequirements.join(", ")}</span>
                ) : null}
                <span>
                  State v{item.relationshipStateVersion} · detector v{item.detectorVersion}
                </span>
              </div>
            </details>
          </li>
        ))}
      </ol>
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
  const needsRepair = statuses.filter(
    (source) => !["connected", "backfilling", "live"].includes(source.status),
  ).length;
  return (
    <div className="flex max-w-sm flex-wrap justify-end gap-1.5">
      {statuses.slice(0, 4).map((source) => (
        <Badge
          key={`${source.source}:${source.sourceAccountId}`}
          variant="outline"
          title={source.lastError || source.lastObservationAt}
          className={`rounded-[2px] font-normal capitalize ${
            source.status === "live"
              ? "border-emerald-500/30"
              : ["connected", "backfilling"].includes(source.status)
                ? "border-sky-500/30"
                : "border-amber-500/30"
          }`}
        >
          {source.source} · {source.status}
        </Badge>
      ))}
      {needsRepair > 0 ? (
        <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <Warning /> {needsRepair} need attention
        </span>
      ) : null}
    </div>
  );
}

function SourceConnectionCards({
  inventory,
  onOpenConnectors,
  onChanged,
  onError,
}: {
  inventory: RelationshipSourceInventoryItem[];
  onOpenConnectors?: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const needsAttention = inventory.filter(
    (item) =>
      item.accounts.length === 0 ||
      item.accounts.some(
        (account) => account.status !== "live" || account.missingScopes.length > 0,
      ),
  );
  if (needsAttention.length === 0) return null;

  const mutate = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      onChanged();
    } catch (error) {
      onError(errMessage(error, "Could not update the evidence source."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="source-connections-heading"
      className="space-y-3"
      data-capability="source-lifecycle"
    >
      <div>
        <h3 id="source-connections-heading" className="text-sm font-medium text-primary">
          Evidence sources
        </h3>
        <p className="mt-0.5 text-xs text-primary/55">
          Connect Google plus Slack or HubSpot. Read access builds history; action scopes remain
          approval-gated.
        </p>
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
                <h4 className="text-sm font-medium text-primary">{item.displayName}</h4>
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
                    {account.lagSeconds ? ` · ${Math.round(account.lagSeconds / 60)}m lag` : ""}
                  </p>
                  {account.missingScopes.length > 0 ? (
                    <p className="text-amber-600">Missing: {account.missingScopes.join(", ")}</p>
                  ) : null}
                  {account.lastError ? (
                    <p className="text-destructive">{account.lastError}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!account ||
                account.status === "disconnected" ||
                account.status === "reconnect_required" ? (
                  <Button type="button" size="sm" onClick={onOpenConnectors}>
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
                      void mutate(`${item.source}:resync`, () =>
                        resyncRelationshipSource(item.source, account.sourceAccountId),
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
                    onClick={() =>
                      void mutate(`${item.source}:disconnect`, () =>
                        disconnectRelationshipSource(item.source, account.sourceAccountId),
                      )
                    }
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
  onError: (message: string) => void;
}) {
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  if (candidates.length === 0) return null;

  const decide = async (candidate: RelationshipIdentityCandidate, decision: string) => {
    setBusy(`${candidate.id}:${decision}`);
    try {
      await decideIdentityCandidate(candidate.id, {
        decision,
        reason: reasons[candidate.id]?.trim() || `Reviewed in the identity inbox: ${decision}.`,
        expectedVersion: candidate.version,
        idempotencyKey: crypto.randomUUID(),
      });
      onChanged();
    } catch (error) {
      onError(errMessage(error, "Could not apply the identity decision. Refresh and try again."));
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
          <h3 id="identity-review-heading" className="text-sm font-medium text-primary">
            Identity review
          </h3>
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

function SemanticSearch({ onError }: { onError: (m: string) => void }) {
  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<SemanticMatch[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);

  if (unavailable) return null;

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    onError("");
    try {
      const result = await semanticSearch(query.trim());
      if (!result.available) {
        setUnavailable(true);
        return;
      }
      setMatches(result.matches);
    } catch (error) {
      onError(errMessage(error, "Search failed."));
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
        className={`border p-3 ${
          tone === "safe"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : tone === "caution"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-red-500/30 bg-red-500/5"
        }`}
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
          if (question.key === "state") {
            answer = `${relationshipLabel(String(model.evidence.lifecycle?.value ?? "unknown"))} · ${relationshipLabel(String(model.evidence.health?.value ?? "unknown"))}`;
          } else if (question.key === "change") {
            answer = model.changedSinceReview
              ? model.changes
                  .map(
                    (change) =>
                      RELATIONSHIP_DIMENSION_LABELS[change.dimension] ??
                      relationshipLabel(change.dimension),
                  )
                  .join(", ") || "State changed"
              : "Nothing changed since your last review.";
          } else if (question.key === "evidence") {
            answer = `${supported} of ${total} dimensions have an accessible winning assertion.`;
          } else if (question.key === "action") {
            answer = model.activeRecommendation?.reason || "No action is currently recommended.";
          }
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
              {item.supported && item.authorityRank ? (
                <p className="mt-1 text-primary/40">
                  {relationshipLabel(item.status)} · authority rank {item.authorityRank} · value
                  schema v{item.valueSchemaVersion ?? 1} ·{" "}
                  {item.extractorVersion || "unknown extractor"}
                </p>
              ) : null}
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
  const [occurredAt, setOccurredAt] = React.useState(() => new Date().toISOString());
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
      <DateTimePicker value={occurredAt} onChange={setOccurredAt} aria-label="Conversation time" />
      <Textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder={"Avery: We can renew next week.\nYou: I will send the paperwork."}
        aria-label="Imported transcript text"
        className="min-h-40"
      />
      <label
        htmlFor={disclosureId}
        className="flex cursor-pointer items-start gap-2 text-xs text-primary/60"
      >
        <Checkbox
          id={disclosureId}
          className="mt-0.5"
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
}: {
  id: string;
  onClose: () => void;
  onError: (m: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<RelationshipDetail | null>(null);
  const [timeline, setTimeline] = React.useState<RelationshipObservation[]>([]);
  const [changes, setChanges] = React.useState<RelationshipStateSnapshot[]>([]);
  const [identityCandidates, setIdentityCandidates] = React.useState<
    RelationshipIdentityCandidate[]
  >([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<Record<string, unknown>>({});

  const load = React.useCallback(async () => {
    try {
      const [nextData, nextTimeline, nextChanges, pending, deferred, resolved] = await Promise.all([
        getRelationship(id),
        getRelationshipTimeline(id),
        getRelationshipChanges(id),
        listIdentityCandidates("pending", id),
        listIdentityCandidates("deferred", id),
        listIdentityCandidates("resolved", id),
      ]);
      setData(nextData);
      setTimeline(nextTimeline);
      setChanges(nextChanges);
      setIdentityCandidates([...pending, ...deferred, ...resolved]);
    } catch (error) {
      onError(errMessage(error, "Could not load the relationship."));
    }
  }, [id, onError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, operation: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key);
    try {
      await operation();
      await load();
      onChanged();
      return true;
    } catch (error) {
      onError(errMessage(error, "Could not update this relationship."));
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
      const result = await getRelationshipEvidence(id, observation.id);
      setEvidence((current) => ({ ...current, [observation.id]: result.payload }));
    } catch (error) {
      onError(errMessage(error, "Could not open source evidence."));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
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
                State v{data.relationship.stateVersion}
                {data.relationship.lastChangedAt
                  ? ` · changed ${relativeTime(data.relationship.lastChangedAt)}`
                  : ""}
              </p>
            </section>

            <MissionControlOverview
              model={data.missionControl}
              busy={Boolean(busy)}
              onAcknowledge={() =>
                act("acknowledge", () =>
                  acknowledgeMissionControl(
                    id,
                    data.missionControl.stateVersion,
                    data.missionControl.stateHash,
                  ),
                )
              }
              onRetract={(assertionId, reason) =>
                void act(`retract:${assertionId}`, () =>
                  retractRelationshipAssertion(id, assertionId, reason),
                )
              }
            />

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
                  correctRelationship(id, { dimension, value, reason }),
                )
              }
            />

            <ImportedTranscriptPublisher
              relationshipId={id}
              disabled={Boolean(busy)}
              onPublish={(observation) =>
                act("publish-transcript", () => ingestRelationshipObservations([observation]))
              }
            />

            {data.intelligence ? (
              <CorrectionReview
                items={data.intelligence.reviewItems}
                disabled={Boolean(busy)}
                onCorrect={(item, correctedValue) =>
                  act(`review:${item.id}`, () =>
                    correctConversationReview(id, {
                      reviewItemId: item.id,
                      correctedValue,
                      reason: "User corrected conversation evidence during focused review.",
                    }),
                  )
                }
                onDecide={(item, kind, correctedValue, deferUntil) =>
                  act(`review:${item.id}:${kind}`, () =>
                    decideConversationReview(id, {
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
                      requestConversationDeletion(id, crypto.randomUUID()),
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
                  onClick={() => void act("recovery", () => runCommitmentRecovery(id))}
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

            <section data-capability="governed-actions">
              <SectionTitle title={`Recommendations (${data.recommendations.length})`} />
              {data.recommendations.length === 0 ? (
                <EmptyText>No action is currently recommended.</EmptyText>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.recommendations.map((action) => (
                    <li key={action.id} className="rounded-[2px] border border-border p-3">
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
                        <span>priority {action.priorityScore}</span>
                        <span>{action.policyStatus}</span>
                      </div>
                      {action.evidence.length > 0 ? (
                        <details className="mt-2 text-xs text-primary/55">
                          <summary className="cursor-pointer">Inspect supporting words</summary>
                          <ul className="mt-2 space-y-1 border-l border-border pl-3">
                            {action.evidence.map((item) => (
                              <li key={item.id}>
                                “{item.excerpt || "Evidence excerpt unavailable"}”
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {action.approvalStatus === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              void act(`approve:${action.id}`, () =>
                                approveRecommendation(action.id),
                              )
                            }
                            disabled={Boolean(busy)}
                          >
                            {busy === `approve:${action.id}` ? (
                              <CircleNotch className="animate-spin" />
                            ) : (
                              <Check />
                            )}
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void act(`reject:${action.id}`, () =>
                                rejectRecommendation(action.id, "Not the right next move"),
                              )
                            }
                            disabled={Boolean(busy)}
                          >
                            <X /> Reject
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="secondary" className="mt-3 capitalize">
                          {action.approvalStatus}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="grid gap-5 sm:grid-cols-2">
              <section data-capability="person-management">
                <SectionTitle title={`People (${data.participants.length})`} />
                {data.participants.length === 0 ? (
                  <EmptyText>None recorded.</EmptyText>
                ) : (
                  <ul className="flex flex-col gap-1.5" aria-label="People">
                    {data.participants.map((participant) => {
                      const departed = participant.person?.employmentStatus === "departed";
                      return (
                        <li
                          key={participant.id}
                          className="flex items-start justify-between gap-2 border border-border p-2 text-xs"
                        >
                          <span className={departed ? "text-primary/50" : undefined}>
                            {[participant.displayName, participant.role, participant.title]
                              .filter(Boolean)
                              .join(" · ")}
                            {departed ? (
                              <Badge variant="secondary" className="ml-2">
                                Left the company
                              </Badge>
                            ) : null}
                          </span>
                          {participant.person?.id ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="shrink-0"
                              disabled={busy === `delete-person:${participant.person.id}`}
                              onClick={() => {
                                const personId = participant.person!.id;
                                if (
                                  !window.confirm(
                                    `Remove ${participant.displayName} and everything derived from them? Their address is suppressed, so a later sync will not recreate them. This cannot be undone.`,
                                  )
                                )
                                  return;
                                void act(`delete-person:${personId}`, () => deletePerson(personId));
                              }}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section>
                <SectionTitle title={`Commitments (${data.commitments.length})`} />
                {data.commitments.length === 0 ? (
                  <EmptyText>None recorded.</EmptyText>
                ) : (
                  <ul className="flex flex-col gap-1.5" aria-label="Commitments">
                    {data.commitments.map((commitment) => (
                      <li key={commitment.id} className="border border-border p-2 text-xs">
                        {commitment.text}
                        {commitment.dueAt ? ` · ${relativeTime(commitment.dueAt)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

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
                      createMutualActionPlan(
                        id,
                        data.commitments
                          .filter(
                            (item) => item.acceptance === "accepted" && item.status === "open",
                          )
                          .map((item) => item.id),
                      ),
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
                            appendCommitmentTransition(id, item.id, {
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
                      <ul className="mt-1 list-disc pl-4 text-primary/60">
                        {plan.currentRevision.items.map((item) => (
                          <li key={item.itemId}>
                            {item.title} · {item.ownerParticipantRef}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-1.5">
                        {plan.status === "draft" || plan.status === "revised" ? (
                          <Button
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void act(`approve-plan:${plan.planId}`, () =>
                                approveMutualActionPlan(id, plan.planId),
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
                                shareMutualActionPlan(id, plan.planId),
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
                        {JSON.stringify(change.before ?? "unknown")} →{" "}
                        {JSON.stringify(change.after ?? "unknown")}
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
                                  resolveRelationshipContradiction(id, item.caseId, {
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
                          v{snapshot.version} · {relativeTime(snapshot.createdAt)}
                        </p>
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
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void revealEvidence(observation)}
                        className="h-auto w-full justify-start rounded-[8px] p-0 text-left hover:bg-transparent"
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
                      </Button>
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
  relationship: RevenueRelationship;
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
            <ul className="flex flex-col gap-1.5">
              {(items as string[]).map((item, index) => (
                <li key={`${item}:${index}`} className="text-xs text-primary/65">
                  · {item}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
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
  onError: (m: string) => void;
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
    onError("");
    try {
      await createRelationship({
        kind,
        displayName: displayName.trim(),
        primaryEmail: primaryEmail.trim() || undefined,
        accountDomain: accountDomain.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      onCreated();
    } catch (error) {
      onError(errMessage(error, "Could not create the relationship."));
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
                  {RELATIONSHIP_KIND_LABELS[item] ?? item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
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
