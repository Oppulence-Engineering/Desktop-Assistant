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
  ArrowClockwise,
  Buildings,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  DownloadSimple,
  EnvelopeSimple,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@oppulence/ui/components/dropdown-menu";
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
  enrichPendingCompanies,
  enrichPendingPersons,
  getPersonAttributes,
  resyncRelationshipSource,
  getResearchEstimate,
  getCompanyResearchEstimate,
  getResearchStatus,
  rejectRecommendation,
  resolveRelationshipContradiction,
  runCommitmentRecovery,
  safeResearchCitationURL,
  appendCommitmentTransition,
  createMutualActionPlan,
  approveMutualActionPlan,
  shareMutualActionPlan,
  requestConversationDeletion,
  retractRelationshipAssertion,
  setResearchConsent,
  companyLinkedInURL,
  interactionCountLabel,
  RevenueAPIError,
  relativeTime,
} from "@/lib/revenue";
import type {
  ConversationReviewItem,
  MissionControlReadModel,
  RelationshipIdentityCandidate,
  RelationshipAttentionItem,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipPersonAttribute,
  RelationshipSourceStatus,
  RelationshipSourceInventoryItem,
  RelationshipStateSnapshot,
  RevenueRelationship,
  ResearchEstimate,
  ResearchStatus,
} from "@/types/revenue";

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

type OptionalCompanyColumn = "people" | "emails" | "health" | "nextAction";

const OPTIONAL_COMPANY_COLUMNS: Array<{ id: OptionalCompanyColumn; label: string }> = [
  { id: "people", label: "People" },
  { id: "emails", label: "Emails" },
  { id: "health", label: "Health" },
  { id: "nextAction", label: "Next action" },
];

const companyName = (relationship: RevenueRelationship) => {
  if (
    relationship.accountDomain &&
    (relationship.displayName === relationship.accountDomain ||
      relationship.displayName.includes("@"))
  ) {
    return relationship.accountDomain
      .split(".")[0]
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ");
  }
  return relationship.displayName;
};

const formatResearchCost = (usd: number) =>
  usd < 0.01 ? "less than a cent" : `$${usd.toFixed(2)}`;

export function RelationshipEnrichment({
  onError,
  onNotice,
  onChanged,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = React.useState<ResearchStatus | null>(null);
  const [personEstimate, setPersonEstimate] = React.useState<ResearchEstimate | null>(null);
  const [companyEstimate, setCompanyEstimate] = React.useState<ResearchEstimate | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const nextStatus = await getResearchStatus();
      setStatus(nextStatus);
      if (nextStatus.allowed && nextStatus.consent.consented) {
        const [people, companies] = await Promise.all([
          getResearchEstimate(),
          getCompanyResearchEstimate(),
        ]);
        setPersonEstimate(people);
        setCompanyEstimate(companies);
      } else {
        setPersonEstimate(null);
        setCompanyEstimate(null);
      }
    } catch (error) {
      onError(errMessage(error, "Could not load profile enrichment."));
    }
  }, [onError]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeConsent = async (consented: boolean) => {
    setBusy(true);
    try {
      await setResearchConsent(consented);
      setResult(null);
      onNotice(
        consented ? "Cited public-web enrichment enabled." : "Public-web enrichment disabled.",
      );
      await load();
    } catch (error) {
      onError(errMessage(error, "Could not update enrichment consent."));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!personEstimate || !companyEstimate) return;
    const people = personEstimate.people ?? 0;
    const companies = companyEstimate.companies ?? 0;
    if (people + companies === 0) return;
    if (
      !window.confirm(
        `Enrich ${companies} ${companies === 1 ? "company" : "companies"} and ${people} ${people === 1 ? "person" : "people"} for about ${formatResearchCost(companyEstimate.usd + personEstimate.usd)}? Only names, company domains, and known employers are sent.`,
      )
    )
      return;
    setBusy(true);
    setResult(null);
    try {
      const companyEnrichment = await enrichPendingCompanies(companyEstimate.batchSize);
      const personEnrichment = await enrichPendingPersons(personEstimate.batchSize);
      const companyMatches = companyEnrichment.outcomes.filter((outcome) => outcome.matched).length;
      const personMatches = personEnrichment.outcomes.filter((outcome) => outcome.matched).length;
      const written = [...companyEnrichment.outcomes, ...personEnrichment.outcomes].reduce(
        (total, outcome) => total + outcome.written,
        0,
      );
      setResult(
        `${companyMatches} of ${companyEnrichment.requested} companies and ${personMatches} of ${personEnrichment.requested} people matched · ${written} cited facts added`,
      );
      onChanged();
      await load();
    } catch (error) {
      onError(errMessage(error, "Could not enrich relationship profiles."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="border border-border bg-background p-4"
      data-capability="cited-profile-enrichment"
    >
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
            Relationship enrichment
          </p>
          <h3 className="mt-1 text-sm font-semibold text-primary">Know who is behind the inbox</h3>
          <p className="mt-1 max-w-3xl text-xs text-primary/55">
            Add company category, description, LinkedIn, plus person role, seniority, and location
            from public sources. Every fact keeps its source link. Message content, transcripts,
            notes, and full email addresses never leave Oppulence.
          </p>
        </div>
        {status?.consent.consented ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void changeConsent(false)}
          >
            Turn off
          </Button>
        ) : status?.available && status.reason === "consent_required" ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void changeConsent(true)}>
            {busy ? <CircleNotch className="animate-spin" /> : <Sparkle />}
            Allow cited enrichment
          </Button>
        ) : null}
      </div>

      {!status ? (
        <p className="mt-3 text-xs text-primary/45">Checking enrichment availability…</p>
      ) : status.allowed && status.consent.consented ? (
        <div className="mt-3 flex flex-col justify-between gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
          <div className="text-xs text-primary/65">
            {(personEstimate?.people ?? 0) + (companyEstimate?.companies ?? 0) === 0 ? (
              <p>
                Profiles are current. New eligible contacts and material company events are checked
                daily.
              </p>
            ) : personEstimate && companyEstimate ? (
              <p>
                {companyEstimate.companies ?? 0} companies · {personEstimate.people ?? 0} people ·
                about {formatResearchCost(companyEstimate.usd + personEstimate.usd)} · company
                events checked daily
              </p>
            ) : (
              <p>Calculating the enrichment estimate…</p>
            )}
            {result ? <p className="mt-1 text-primary">{result}</p> : null}
          </div>
          {personEstimate &&
          companyEstimate &&
          (personEstimate.people ?? 0) + (companyEstimate.companies ?? 0) > 0 ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void run()}>
              {busy ? <CircleNotch className="animate-spin" /> : <Sparkle />}
              Enrich companies &amp; people
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-xs text-primary/55">
          {!status.available
            ? `Unavailable until a workspace administrator configures the research provider${status.reason === "plan_required" ? ` and enables the ${status.requiredPlan} plan` : ""}.`
            : status.reason === "plan_required"
              ? `Available on the ${status.requiredPlan} plan.`
              : status.reason === "capability_disabled"
                ? "Cloud research is disabled for this workspace."
                : "Enrichment is off until you explicitly allow it."}
        </p>
      )}
    </section>
  );
}

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
  const [optionalColumns, setOptionalColumns] = React.useState<OptionalCompanyColumn[]>([]);
  const hasConnectedSource = sources.some((source) =>
    ["connected", "backfilling", "live"].includes(source.status),
  );
  const companies = rows.filter((relationship) => relationship.kind !== "person");
  const companyAttention = attention.filter((item) =>
    companies.some((relationship) => relationship.id === item.relationshipId),
  );

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
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <button
          className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-primary hover:bg-background-100"
          type="button"
        >
          <Buildings /> All companies <span className="text-primary/40">{companies.length}</span>
        </button>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={surface}
            onValueChange={(value) => {
              if (value === "list" || value === "graph") setSurface(value);
            }}
            variant="outline"
            size="sm"
            aria-label="Company view"
          >
            <ToggleGroupItem value="list" aria-label="Show accounts">
              <ListBullets /> List
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
            className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
            size="sm"
            onClick={() => setCreating(true)}
          >
            <Plus /> New company
          </Button>
        </div>
      </div>

      {surface === "graph" ? (
        <RelationshipGraphWorkspace
          relationships={companies}
          onOpenRelationship={setDetail}
          onError={onError}
          onNotice={onNotice}
        />
      ) : (
        <>
          <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary/35" />
              <Input
                aria-label="Filter companies"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search companies"
                className="h-8 border-border bg-background pl-8 text-[13px]"
              />
            </div>
            <Select value={health} onValueChange={setHealth}>
              <SelectTrigger className="h-8 w-36" size="sm">
                <SelectValue placeholder="Health" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-md">
                <SelectItem value="all">All health</SelectItem>
                {HEALTH_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanize(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lifecycle} onValueChange={setLifecycle}>
              <SelectTrigger className="h-8 w-40" size="sm">
                <SelectValue placeholder="Lifecycle" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-md">
                <SelectItem value="all">All lifecycle</SelectItem>
                {LIFECYCLE_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanize(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              className="h-8"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <ArrowClockwise className={loading ? "animate-spin" : ""} /> Refresh
            </Button>
            <details className="group relative ml-auto">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-background px-3 text-[12px] text-primary/65 outline-none hover:bg-background-100 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/20">
                <Sparkle /> Data health
                {companyAttention.length + identityCandidates.length > 0 ? (
                  <Badge variant="secondary">
                    {companyAttention.length + identityCandidates.length}
                  </Badge>
                ) : null}
              </summary>
              <div className="absolute right-0 top-9 z-30 grid min-w-0 max-h-[70vh] w-[640px] max-w-[calc(100vw-320px)] gap-4 overflow-x-hidden overflow-y-auto rounded-md border border-border bg-background p-4 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-primary">
                      Data health &amp; profile enrichment
                    </p>
                    <p className="mt-0.5 text-[12px] text-primary/45">
                      Sources, enrichment, and identity review
                    </p>
                  </div>
                  <SourceHealth statuses={sources} />
                </div>
                <PortfolioAttentionQueue
                  items={companyAttention}
                  onOpenRelationship={setDetail}
                  onError={onError}
                  onChanged={() => void load()}
                />
                <SourceConnectionCards
                  inventory={sourceInventory}
                  onOpenConnectors={onOpenConnectors}
                  onError={onError}
                  onChanged={() => void load()}
                />
                <RelationshipEnrichment
                  onError={onError}
                  onNotice={onNotice}
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
                <div>
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
            </details>
          </div>

          {loading ? (
            <div className="p-4">
              <ListSkeleton />
            </div>
          ) : companies.length === 0 ? (
            <EmptyBlock
              icon={<Buildings className="size-6" />}
              title="No matching companies"
              body={
                hasConnectedSource
                  ? "Gmail is connected. Run the 90-day audit from Commitments to discover companies and the people behind each conversation."
                  : "Connect Gmail to discover companies from real conversations, or add one by hand."
              }
            >
              <Button
                size="sm"
                className="bg-[#3478f6] text-white"
                onClick={() => setCreating(true)}
              >
                <Plus /> Add company
              </Button>
            </EmptyBlock>
          ) : (
            <div className="min-w-0 flex-1 overflow-auto">
              <table
                className="w-full min-w-[960px] table-fixed border-collapse text-left font-sans tracking-[-0.15px]"
                aria-label="Companies"
              >
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="h-10 border-b border-border text-[13px] font-medium text-primary/55">
                    <th className="sticky left-0 z-20 w-10 border-r border-border bg-background px-3">
                      <input
                        aria-label="Select all companies"
                        className="size-4 accent-[#3478f6]"
                        type="checkbox"
                      />
                    </th>
                    <th className="sticky left-10 z-20 w-[200px] border-r border-border bg-background px-3">
                      <div className="flex items-center justify-between gap-2">
                        <span>Company</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label="Add column"
                              className="flex size-6 items-center justify-center text-primary/35 hover:bg-background-100 hover:text-primary"
                              title="Add column"
                              type="button"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="app-shell rounded-none">
                            {OPTIONAL_COMPANY_COLUMNS.map((column) => (
                              <DropdownMenuCheckboxItem
                                key={column.id}
                                checked={optionalColumns.includes(column.id)}
                                className="rounded-none"
                                onCheckedChange={(checked) =>
                                  setOptionalColumns((current) =>
                                    checked
                                      ? [...current, column.id]
                                      : current.filter((id) => id !== column.id),
                                  )
                                }
                              >
                                {column.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </th>
                    <th className="w-32 border-r border-border px-3">Last interaction</th>
                    <th className="w-40 border-r border-border px-3">Connection strength</th>
                    <th className="w-[136px] border-r border-border px-3">Categories</th>
                    <th className="w-44 border-r border-border px-3">Domains</th>
                    <th className="w-[120px] border-r border-border px-3">LinkedIn</th>
                    {optionalColumns.includes("people") ? (
                      <th className="w-20 border-r border-border px-3 text-center">People</th>
                    ) : null}
                    {optionalColumns.includes("emails") ? (
                      <th className="w-20 border-r border-border px-3 text-center">Emails</th>
                    ) : null}
                    {optionalColumns.includes("health") ? (
                      <th className="w-28 border-r border-border px-3">Health</th>
                    ) : null}
                    {optionalColumns.includes("nextAction") ? (
                      <th className="w-56 border-r border-border px-3">Next action</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {companies.map((relationship) => (
                    <tr
                      key={relationship.id}
                      className="group h-9 border-b border-border hover:bg-background-100/70"
                    >
                      <td className="sticky left-0 z-[5] border-r border-border bg-background px-3 group-hover:bg-background-100">
                        <input
                          aria-label={`Select ${relationship.displayName}`}
                          className="size-4 accent-[#3478f6]"
                          type="checkbox"
                        />
                      </td>
                      <td className="sticky left-10 z-[5] border-r border-border bg-background px-3 group-hover:bg-background-100">
                        <button
                          className="flex w-full items-center gap-2 truncate text-left text-sm font-medium text-primary"
                          onClick={() => setDetail(relationship.id)}
                          type="button"
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-none border border-border bg-background-100 text-[10px] font-semibold text-primary/60">
                            {companyName(relationship).slice(0, 2).toUpperCase()}
                          </span>
                          <span className="truncate">{companyName(relationship)}</span>
                        </button>
                      </td>
                      <td className="border-r border-border px-3 text-[13px] text-primary/50">
                        {relationship.lastTouchAt ? relativeTime(relationship.lastTouchAt) : "—"}
                      </td>
                      <td className="border-r border-border px-3">
                        <span className="text-[13px] text-primary/55">
                          {interactionCountLabel(relationship.emailThreadCount ?? 0)}
                        </span>
                      </td>
                      <td className="border-r border-border px-3">
                        <span className="border border-border bg-background-100 px-2 py-1 text-[11px] capitalize text-primary/60">
                          {relationship.categories?.[0] ?? "—"}
                        </span>
                      </td>
                      <td className="truncate border-r border-border px-3 text-[13px]">
                        {relationship.accountDomain ? (
                          <a
                            className="text-primary/65 underline-offset-2 hover:text-primary hover:underline"
                            href={`https://${relationship.accountDomain}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {relationship.accountDomain}
                          </a>
                        ) : (
                          <span className="text-primary/35">—</span>
                        )}
                      </td>
                      <td className="border-r border-border px-3 text-[13px]">
                        <a
                          className="text-primary/55 underline-offset-2 hover:text-primary hover:underline"
                          href={companyLinkedInURL(
                            companyName(relationship),
                            relationship.resourceRefs,
                            relationship.linkedinUrl,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {relationship.linkedinUrl ||
                          relationship.resourceRefs.some((ref) =>
                            ref.startsWith("linkedin:company:"),
                          )
                            ? "View profile"
                            : "Find profile"}
                        </a>
                      </td>
                      {optionalColumns.includes("people") ? (
                        <td className="border-r border-border px-3 text-center text-[13px] text-primary/60">
                          {relationship.peopleCount ?? 0}
                        </td>
                      ) : null}
                      {optionalColumns.includes("emails") ? (
                        <td className="border-r border-border px-3 text-center text-[13px] text-primary/60">
                          {relationship.emailThreadCount ?? 0}
                        </td>
                      ) : null}
                      {optionalColumns.includes("health") ? (
                        <td className="border-r border-border px-3">
                          <span
                            className={`text-[13px] capitalize ${HEALTH_TONE[relationship.health] ?? HEALTH_TONE.unknown}`}
                          >
                            {humanize(relationship.health)}
                          </span>
                        </td>
                      ) : null}
                      {optionalColumns.includes("nextAction") ? (
                        <td className="truncate border-r border-border px-3 text-[13px] text-primary/60">
                          {relationship.nextAction ||
                            relationship.stateReason ||
                            (relationship.openActions
                              ? `${relationship.openActions} open action${relationship.openActions === 1 ? "" : "s"}`
                              : "No open action")}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {detail ? (
        <RelationshipSheet
          id={detail}
          position={Math.max(
            1,
            companies.findIndex((relationship) => relationship.id === detail) + 1,
          )}
          total={companies.length}
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
                className="h-auto min-w-0 flex-1 justify-start whitespace-normal rounded-[8px] p-0 text-left hover:bg-transparent"
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
      <div className="grid gap-2 sm:grid-cols-2">
        {needsAttention.map((item) => {
          const account = item.accounts[0];
          const progress =
            account && account.backfillTotal > 0
              ? Math.round((account.backfillCompleted / account.backfillTotal) * 100)
              : null;
          return (
            <article
              key={item.source}
              className="min-w-0 space-y-3 rounded-[2px] border border-border p-3"
            >
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

function MissionControlOverview({
  model,
  emailThreadCount,
  busy,
  onAcknowledge,
  onRetract,
}: {
  model: MissionControlReadModel;
  emailThreadCount: number;
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
            <p className="mt-1 text-xs text-primary/60">
              {emailThreadCount > 0 && supported === 0
                ? `${emailThreadCount} Gmail ${emailThreadCount === 1 ? "thread is" : "threads are"} linked. Health and lifecycle still need stronger evidence.`
                : model.completeness.explanation}
            </p>
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
  position,
  total,
  onClose,
  onError,
  onChanged,
}: {
  id: string;
  position: number;
  total: number;
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
  const [personAttributes, setPersonAttributes] = React.useState<
    Record<string, RelationshipPersonAttribute[]>
  >({});

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
      const people = nextData.participants
        .map((participant) => participant.person?.id)
        .filter((personId): personId is string => Boolean(personId));
      const attributes = await Promise.all(
        [...new Set(people)].map(
          async (personId) =>
            [personId, await getPersonAttributes(personId).catch(() => [])] as const,
        ),
      );
      setPersonAttributes(Object.fromEntries(attributes));
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

  const openSection = (section: string) =>
    document
      .getElementById(`${id}:${section}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  const primaryContact = data?.participants.find((participant) => participant.email);
  const companySource = data
    ? Object.values(data.relationship.companyEnrichmentRefs ?? {})
        .flat()
        .map(safeResearchCitationURL)
        .find((url): url is string => Boolean(url))
    : undefined;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        overlayClassName="bg-transparent"
        closeButtonClassName="left-4 right-auto"
        className="left-0 flex w-full flex-col gap-0 overflow-hidden border-l-0 p-0 shadow-none sm:max-w-none md:left-[274px] md:w-[calc(100%-274px)]"
      >
        <SheetHeader className="min-h-12 flex-row items-center border-b border-border py-2 pl-14 pr-3">
          <SheetTitle className="text-xs font-normal text-primary/55">
            {data ? `${position} of ${total} in All companies` : "Company"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {data?.relationship.primaryEmail}
            {data?.relationship.accountDomain ? ` · ${data.relationship.accountDomain}` : ""}
          </SheetDescription>
          <span className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-primary">
            Ask Oppulence
          </span>
        </SheetHeader>
        {!data ? (
          <p className="px-4 py-6 text-sm text-primary/50">Loading living state…</p>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="border-b border-border px-4 py-5 md:border-r md:border-b-0">
              <section>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background-100 text-xs font-semibold text-primary/60">
                    {companyName(data.relationship).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-primary">
                      {companyName(data.relationship)}
                    </h2>
                    <p className="truncate text-xs text-primary/45">
                      {data.relationship.accountDomain ||
                        data.relationship.primaryEmail ||
                        "Company"}
                    </p>
                  </div>
                </div>
                {primaryContact?.email ? (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="mt-4 w-full justify-center"
                  >
                    <a href={`mailto:${primaryContact.email}`}>
                      <EnvelopeSimple /> Compose email
                    </a>
                  </Button>
                ) : null}
              </section>
              <section className="mt-5 border-t border-border pt-4">
                <p className="mb-3 text-xs font-medium text-primary/55">Record details</p>
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
                <dl className="mt-5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
                  <dt className="text-primary/40">Domain</dt>
                  <dd className="truncate text-primary/75">
                    {data.relationship.accountDomain || "Not detected"}
                  </dd>
                  <dt className="text-primary/40">Company</dt>
                  <dd className="capitalize text-primary/75">{companyName(data.relationship)}</dd>
                  <dt className="text-primary/40">Category</dt>
                  <dd className="text-primary/75">
                    {data.relationship.categories?.join(", ") || "Not enriched"}
                  </dd>
                  <dt className="text-primary/40">Description</dt>
                  <dd className="text-primary/75">
                    {data.relationship.companyDescription ||
                      data.relationship.summary ||
                      data.relationship.stateReason ||
                      "Built from synced email activity"}
                  </dd>
                  <dt className="text-primary/40">LinkedIn</dt>
                  <dd className="text-primary/75">
                    {data.relationship.linkedinUrl ? (
                      <a
                        className="underline-offset-2 hover:underline"
                        href={data.relationship.linkedinUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View company
                      </a>
                    ) : (
                      "Not enriched"
                    )}
                  </dd>
                  {companySource ? (
                    <>
                      <dt className="text-primary/40">Source</dt>
                      <dd className="text-primary/75">
                        <a
                          className="underline-offset-2 hover:underline"
                          href={companySource}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Verify enrichment
                        </a>
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-primary/40">People</dt>
                  <dd className="text-primary/75">{data.participants.length}</dd>
                  <dt className="text-primary/40">Lifecycle</dt>
                  <dd className="capitalize text-primary/75">
                    {humanize(data.relationship.lifecycle)}
                  </dd>
                  <dt className="text-primary/40">Health</dt>
                  <dd className="capitalize text-primary/75">
                    {humanize(data.relationship.health)}
                  </dd>
                  <dt className="text-primary/40">Engagement</dt>
                  <dd className="capitalize text-primary/75">
                    {humanize(data.relationship.engagement)}
                  </dd>
                  <dt className="text-primary/40">Last activity</dt>
                  <dd className="text-primary/75">
                    {data.relationship.lastTouchAt
                      ? relativeTime(data.relationship.lastTouchAt)
                      : "No activity"}
                  </dd>
                </dl>
              </section>
              <section className="mt-6 border-t border-border pt-4">
                <p className="text-xs font-medium text-primary/55">Lists</p>
                <p className="mt-2 text-xs text-primary/40">Synced companies · Gmail</p>
              </section>
            </aside>

            <div className="min-w-0 overflow-y-auto">
              <nav className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border bg-background px-4 text-xs">
                <button
                  type="button"
                  onClick={() => openSection("overview")}
                  className="rounded-md bg-background-200 px-3 py-1.5 text-primary"
                >
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => openSection("activity")}
                  className="px-3 py-1.5 text-primary/50 hover:text-primary"
                >
                  Activity
                </button>
                <button
                  type="button"
                  onClick={() => openSection("activity")}
                  className="px-3 py-1.5 text-primary/50 hover:text-primary"
                >
                  Emails {data.emailThreads.length}
                </button>
                <button
                  type="button"
                  onClick={() => openSection("commitments")}
                  className="px-3 py-1.5 text-primary/50 hover:text-primary"
                >
                  Commitments {data.commitments.length}
                </button>
                <button
                  type="button"
                  onClick={() => openSection("people")}
                  className="px-3 py-1.5 text-primary/50 hover:text-primary"
                >
                  People {data.participants.length}
                </button>
              </nav>
              <div id={`${id}:overview`} className="flex scroll-mt-14 flex-col gap-6 px-5 py-5">
                <p className="text-xs font-medium text-primary/55">Highlights</p>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Health", humanize(data.relationship.health)],
                    ["Engagement", humanize(data.relationship.engagement)],
                    [
                      "Last interaction",
                      data.relationship.lastTouchAt
                        ? relativeTime(data.relationship.lastTouchAt)
                        : "No activity",
                    ],
                    ["People", String(data.participants.length)],
                    ["Email threads", String(data.emailThreads.length)],
                    [
                      "Open commitments",
                      String(data.commitments.filter((item) => item.status === "open").length),
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="min-h-24 rounded-md border border-border p-3">
                      <p className="text-[11px] text-primary/40">{label}</p>
                      <p className="mt-5 text-sm font-medium capitalize text-primary">{value}</p>
                    </div>
                  ))}
                </div>

                <section id={`${id}:activity`} className="scroll-mt-16">
                  <SectionTitle title={`Email activity (${data.emailThreads.length})`} />
                  {data.emailThreads.length === 0 ? (
                    <EmptyText>No Gmail threads linked yet.</EmptyText>
                  ) : (
                    <ul className="flex flex-col divide-y divide-primary/10 rounded-md border border-border">
                      {data.emailThreads.map((thread) => (
                        <li key={thread.id} className="flex items-start justify-between gap-4 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-primary">
                              {thread.subject || "Email conversation"}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-primary/45">
                              {thread.counterpartyEmail || "Gmail"} · {thread.messageCount}{" "}
                              {thread.messageCount === 1 ? "message" : "messages"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[11px] capitalize text-primary/55">
                              {humanize(thread.replyState)}
                            </p>
                            <p className="mt-1 text-[11px] text-primary/35">
                              {thread.lastActivityAt
                                ? relativeTime(thread.lastActivityAt)
                                : "Unknown date"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <MissionControlOverview
                  model={data.missionControl}
                  emailThreadCount={data.emailThreads.length}
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
                        <span>
                          Retention: {data.intelligence.effectivePolicy.retentionDays} days
                        </span>
                        <span>
                          Evidence:{" "}
                          {data.intelligence.effectivePolicy.publishEvidence
                            ? "allowed"
                            : "blocked"}
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
                        <li
                          key={evaluation.evaluationId}
                          className="border border-border p-3 text-xs"
                        >
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
                        <ul
                          key={evaluation.evaluationId}
                          className="mt-2 border-l border-border pl-3"
                        >
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
                  <section
                    id={`${id}:people`}
                    className="scroll-mt-16"
                    data-capability="person-management"
                  >
                    <SectionTitle title={`People (${data.participants.length})`} />
                    {data.participants.length === 0 ? (
                      <EmptyText>None recorded.</EmptyText>
                    ) : (
                      <ul className="flex flex-col gap-1.5" aria-label="People">
                        {data.participants.map((participant) => {
                          const person = participant.person;
                          const departed = person?.employmentStatus === "departed";
                          const profile = [
                            person?.title || participant.title,
                            person?.orgName,
                            person?.seniority,
                            person?.location,
                          ].filter(Boolean);
                          const cited = (personAttributes[person?.id ?? ""] ?? []).filter(
                            (attribute) =>
                              attribute.sourceType === "external_research" &&
                              attribute.status !== "retracted",
                          );
                          return (
                            <li
                              key={participant.id}
                              className="flex items-start justify-between gap-2 border border-border p-2 text-xs"
                            >
                              <div className={`min-w-0 ${departed ? "text-primary/50" : ""}`}>
                                <p className="font-medium text-primary">
                                  {participant.displayName}
                                  {participant.role ? ` · ${participant.role}` : ""}
                                  {departed ? (
                                    <Badge variant="secondary" className="ml-2">
                                      Left the company
                                    </Badge>
                                  ) : null}
                                </p>
                                <p className="mt-1 text-primary/60">
                                  {profile.length
                                    ? profile.join(" · ")
                                    : "Profile details not enriched yet"}
                                </p>
                                <p className="mt-1 text-[10px] uppercase tracking-wide text-primary/40">
                                  {profile.length}/4 profile fields
                                </p>
                                {cited.length ? (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer text-primary/60">
                                      Cited enrichment · {cited.length}{" "}
                                      {cited.length === 1 ? "fact" : "facts"}
                                    </summary>
                                    <ul className="mt-1 space-y-1 border-l border-border pl-2">
                                      {cited.map((attribute) => (
                                        <li key={attribute.id}>
                                          <span className="capitalize">
                                            {humanize(attribute.dimension)}
                                          </span>
                                          : {attribute.value}
                                          {` · ${Math.round(attribute.confidence * 100)}% confidence`}
                                          {(attribute.citations ?? []).map((citation, index) => {
                                            const href = safeResearchCitationURL(citation.url);
                                            return href ? (
                                              <a
                                                key={`${attribute.id}:${index}`}
                                                className="ml-1 text-oppulence-orange underline underline-offset-2"
                                                href={href}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                {citation.title || `Source ${index + 1}`}
                                              </a>
                                            ) : null;
                                          })}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                              </div>
                              {person?.id ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="shrink-0"
                                  disabled={busy === `delete-person:${person.id}`}
                                  onClick={() => {
                                    const personId = person.id;
                                    if (
                                      !window.confirm(
                                        `Remove ${participant.displayName} and everything derived from them? Their address is suppressed, so a later sync will not recreate them. This cannot be undone.`,
                                      )
                                    )
                                      return;
                                    void act(`delete-person:${personId}`, () =>
                                      deletePerson(personId),
                                    );
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
                  <section id={`${id}:commitments`} className="scroll-mt-16">
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
                    <SectionTitle
                      title={`Commitment graph (${data.commitmentDependencies.length})`}
                    />
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
                    <EmptyText>
                      Accept a commitment to build an evidence-backed shared plan.
                    </EmptyText>
                  )}
                </section>

                <section data-capability="contradiction-resolution">
                  <SectionTitle title={`What changed (${changes.length})`} />
                  {data.intelligence?.delta.changes.length ? (
                    <ul className="mb-3 flex flex-col gap-2">
                      {data.intelligence.delta.changes.map((change) => (
                        <li
                          key={change.dimension}
                          className="rounded-[2px] border border-border p-3"
                        >
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
                                  Use{" "}
                                  {String("value" in side.value ? side.value.value : side.source)}
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
                      <span className="font-medium text-primary">
                        Why the recommendation changed:
                      </span>{" "}
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
            </div>
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
        kind: "company",
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
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            Add a company now; synced conversations will fill in its people and activity.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Company name"
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
