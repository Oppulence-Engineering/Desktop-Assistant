"use client";

import * as React from "react";
import {
  AddressBook,
  ArrowClockwise,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  MagnifyingGlass,
  Plus,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";
import type {
  ConversationReviewItem,
  Relationship,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipSemanticMatch,
  RelationshipSourceStatus,
  RelationshipStateSnapshot,
} from "@x/shared/src/relationships.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

export function RelationshipsView({ initialId }: { initialId?: string | null }) {
  const [rows, setRows] = React.useState<Relationship[]>([]);
  const [sources, setSources] = React.useState<RelationshipSourceStatus[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<string | null>(initialId ?? null);
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [health, setHealth] = React.useState("all");
  const [lifecycle, setLifecycle] = React.useState("all");
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [relationships, sourceStatuses] = await Promise.all([
        window.ipc.invoke("relationships:list", {
          q: query.trim() || undefined,
          health: health === "all" ? undefined : health,
          lifecycle: lifecycle === "all" ? undefined : lifecycle,
        }),
        window.ipc.invoke("relationships:sources", null),
      ]);
      setRows(relationships.relationships);
      setSources(sourceStatuses.sources);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load relationship intelligence.",
      );
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

  return (
    <div className="app-shell min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6">
        <section className="rounded-[2px] border border-border bg-background-50 p-4 dark:bg-background-100/30">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
                Account mission control
              </p>
              <h1 className="mt-1 text-base font-semibold text-primary">
                Which relationship needs action now?
              </h1>
              <p className="mt-1 max-w-2xl text-xs text-primary/55">
                One living state across email, meetings, Slack, CRM, and revenue evidence. Every
                recommendation explains what changed and waits for approval.
              </p>
            </div>
            <SourceHealth statuses={sources} />
          </div>
        </section>

        <SemanticSearch onError={setError} />

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
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail ? (
        <RelationshipSheet
          id={detail}
          onClose={() => setDetail(null)}
          onError={setError}
          onChanged={() => void load()}
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

function SourceHealth({ statuses }: { statuses: RelationshipSourceStatus[] }) {
  if (statuses.length === 0) {
    return (
      <Badge variant="outline" className="w-fit rounded-[2px] font-normal text-primary/45">
        No evidence sources yet
      </Badge>
    );
  }
  const stale = statuses.filter((source) => source.status !== "connected").length;
  return (
    <div className="flex max-w-sm flex-wrap justify-end gap-1.5">
      {statuses.slice(0, 4).map((source) => (
        <Badge
          key={`${source.source}:${source.sourceAccountId}`}
          variant="outline"
          title={source.lastError || source.lastObservationAt}
          className={`rounded-[2px] font-normal capitalize ${
            source.status === "connected" ? "border-emerald-500/30" : "border-amber-500/30"
          }`}
        >
          {source.source} · {source.status}
        </Badge>
      ))}
      {stale > 0 ? (
        <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <Warning /> {stale} need attention
        </span>
      ) : null}
    </div>
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

function RelationshipSheet({
  id,
  onClose,
  onError,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onError: (message: string | null) => void;
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<RelationshipDetail | null>(null);
  const [timeline, setTimeline] = React.useState<RelationshipObservation[]>([]);
  const [changes, setChanges] = React.useState<RelationshipStateSnapshot[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<Record<string, unknown>>({});

  const load = React.useCallback(async () => {
    try {
      const [nextData, nextTimeline, nextChanges] = await Promise.all([
        window.ipc.invoke("relationships:get", { id }),
        window.ipc.invoke("relationships:timeline", { id, limit: 50 }),
        window.ipc.invoke("relationships:changes", { id }),
      ]);
      setData(nextData);
      setTimeline(nextTimeline.observations);
      setChanges(nextChanges.snapshots);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not load the relationship.");
    }
  }, [id, onError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      await load();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update this relationship.");
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

            <section>
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
                                window.ipc.invoke("relationships:approve", {
                                  actionId: action.id,
                                  acceptRisk: false,
                                }),
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
                                window.ipc.invoke("relationships:reject", {
                                  actionId: action.id,
                                  reason: "Not the right next move",
                                }),
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

            <section>
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
              {data.intelligence?.delta.contradictions.length ? (
                <ul className="mb-3 space-y-2 rounded-[2px] border border-amber-500/30 p-3 text-xs text-primary/60">
                  {data.intelligence.delta.contradictions.map((item) => (
                    <li key={item.contradictedAssertionId}>
                      <span className="font-medium capitalize text-primary">
                        {humanize(item.dimension)}:
                      </span>{" "}
                      “{item.contradictedValue}” was superseded by “{item.currentValue}”.
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

function CorrectionReview({
  items,
  disabled,
  onCorrect,
}: {
  items: ConversationReviewItem[];
  disabled: boolean;
  onCorrect: (item: ConversationReviewItem, correctedValue: string) => void;
}) {
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (items.length === 0) return null;
  return (
    <section className="rounded-[2px] border border-amber-500/30 bg-amber-500/5 p-3">
      <SectionTitle title={`Focused evidence review (${items.length})`} />
      <p className="mb-3 text-xs text-primary/55">
        Only low-confidence words, speakers, entities, and material claims appear here.
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !draft.trim() || draft.trim() === item.currentValue}
                  onClick={() => onCorrect(item, draft.trim())}
                >
                  Correct
                </Button>
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
    <section className="rounded-[2px] border border-dashed border-border p-3">
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
