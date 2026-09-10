"use client";

import * as React from "react";
import { ArrowClockwise, CircleNotch, LinkSimple, Plugs, ShieldCheck } from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import {
  linkWorkspace,
  listRelationshipSourceStatuses,
  relativeTime,
  resyncRelationshipSource,
  RevenueAPIError,
} from "@/lib/revenue";
import { Field, errMessage } from "@/components/revenue/shared";
import { capture, RevenueEvents } from "@/lib/analytics";
import { listCloudRuns } from "@/lib/cloud-workflows";
import type { RelationshipSourceStatus, RevenueWorkspace } from "@/types/revenue";

export function WorkspaceView({
  workspace,
  onLinked,
  onError,
  onNotice,
  onOpenConnectors,
}: {
  workspace: RevenueWorkspace | null;
  onLinked: (ws: RevenueWorkspace) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onOpenConnectors?: () => void;
}) {
  // A page called "Sources" that says nothing about sources is where users
  // were sent when told to reconnect, and it showed them a workspace-linking
  // form instead. Connection health belongs here, above everything else.
  const [sources, setSources] = React.useState<RelationshipSourceStatus[] | null>(null);
  const [autoRefreshBlocker, setAutoRefreshBlocker] = React.useState("");
  React.useEffect(() => {
    let cancelled = false;
    void listRelationshipSourceStatuses()
      .then((rows) => {
        if (!cancelled) setSources(rows);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    void listCloudRuns({ slug: "oppulence-relationship-refresh" })
      .then(({ runs }) => {
        if (!cancelled) {
          const latest = runs[0];
          setAutoRefreshBlocker(latest?.status === "failed" ? latest.errorCode : "");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [orgId, setOrgId] = React.useState("");
  const [wsId, setWsId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (!workspace) return <p className="text-sm text-primary/50">Loading workspace…</p>;

  const linked = workspace.mode === "linked" && workspace.status === "active";

  const submit = async () => {
    if (!wsId.trim()) return;
    setBusy(true);
    onError("");
    try {
      const ws = await linkWorkspace({
        outboundWorkspaceId: wsId.trim(),
        outboundOrganizationId: orgId.trim() || undefined,
      });
      onLinked(ws);
      capture(RevenueEvents.WorkspaceLinked);
      onNotice("Workspace linked — governed sending is now enabled.");
    } catch (e) {
      onError(
        e instanceof RevenueAPIError && e.code === "facade_unavailable"
          ? "Policy preflight isn't configured on the server yet, so linking can't be completed. Drafting still works in local mode."
          : errMessage(e, "Could not link the workspace."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <section className="rounded-[2px] border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-primary">Connected sources</span>
          {onOpenConnectors ? (
            <Button onClick={onOpenConnectors} size="sm" variant="outline">
              Manage connectors
            </Button>
          ) : null}
        </div>
        {sources === null ? (
          <p className="px-4 py-3 text-sm text-primary/50">Loading sources…</p>
        ) : sources.length === 0 ? (
          <p className="px-4 py-3 text-sm text-primary/50">
            No sources are connected yet, so there is nothing to read promises from.
          </p>
        ) : (
          <dl className="divide-y divide-border text-sm">
            {sources.map((source) => (
              <SourceRow
                key={`${source.source}:${source.sourceAccountId}`}
                source={source}
                autoRefreshBlocker={autoRefreshBlocker}
                onError={onError}
                onNotice={onNotice}
                onUpdated={(updated) =>
                  setSources((current) =>
                    (current ?? []).map((item) =>
                      item.connectionId === updated.connectionId ? updated : item,
                    ),
                  )
                }
              />
            ))}
          </dl>
        )}
      </section>

      {/* status card */}
      <section className="rounded-[2px] border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-primary">Workspace</span>
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs " +
              (linked
                ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "border-border text-primary/55")
            }
          >
            <span
              className={"size-1.5 rounded-full " + (linked ? "bg-emerald-500" : "bg-primary/30")}
            />
            {linked ? "Linked" : "Local mode"}
          </span>
        </div>
        <dl className="divide-y divide-primary/10 text-sm">
          <Row label="Mode" value={workspace.mode} />
          <Row label="Status" value={workspace.status} />
          <Row
            label="Preflight"
            value={workspace.preflightAvailable ? "Available" : "Unavailable (drafts only)"}
          />
          {workspace.outboundOrganizationId ? (
            <Row label="Organization" value={workspace.outboundOrganizationId} mono />
          ) : null}
          {workspace.outboundWorkspaceId ? (
            <Row label="OutboundConsole workspace" value={workspace.outboundWorkspaceId} mono />
          ) : null}
          {workspace.lastVerifiedAt ? (
            <Row label="Last verified" value={relativeTime(workspace.lastVerifiedAt)} />
          ) : null}
        </dl>
      </section>

      {/* what local vs linked means */}
      {linked ? (
        <Alert>
          <ShieldCheck weight="fill" />
          <AlertTitle>Governed sending is on</AlertTitle>
          <AlertDescription>
            Sends run through OutboundConsole policy preflight — suppression, verification, and
            ownership are checked before anything leaves.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert>
            <Plugs weight="fill" />
            <AlertTitle>Local mode</AlertTitle>
            <AlertDescription>
              Observation, scans, and draft-first execution all work. Sending is disabled until you
              link a governed OutboundConsole workspace — drafts land in your own Gmail so you can
              send them yourself.
            </AlertDescription>
          </Alert>

          <section className="rounded-[2px] border border-border p-4">
            <h3 className="text-sm font-medium text-primary">Link a governed workspace</h3>
            <p className="mt-1 text-sm text-primary/60">
              Connect an OutboundConsole workspace to turn on policy-checked sending.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Field label="OutboundConsole workspace ID">
                <Input value={wsId} onChange={(e) => setWsId(e.target.value)} placeholder="ws_…" />
              </Field>
              <Field label="Organization ID (optional)">
                <Input
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder="org_…"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submit} disabled={busy || !wsId.trim()}>
                  {busy ? <CircleNotch className="animate-spin" /> : <LinkSimple />} Link workspace
                </Button>
                {onOpenConnectors ? (
                  <Button variant="ghost" size="sm" onClick={onOpenConnectors}>
                    Manage connectors
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Health in the words a reader uses, and never silent about a source that has
// stopped working.
function SourceRow({
  source,
  autoRefreshBlocker,
  onError,
  onNotice,
  onUpdated,
}: {
  source: RelationshipSourceStatus;
  autoRefreshBlocker: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onUpdated: (source: RelationshipSourceStatus) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const stopped = source.status === "reconnect_required" || source.status === "disconnected";
  const syncing =
    source.status === "backfilling" ||
    source.status === "rebuilding" ||
    source.backfillPhase === "queued" ||
    source.backfillPhase === "running";
  const supportsResync = ["google", "slack", "hubspot"].includes(source.source.toLowerCase());
  const stale = supportsResync && !stopped && !syncing && source.status === "stale";
  const incomplete =
    supportsResync && !stopped && !syncing && !stale && source.completeness !== "complete";
  const label = stopped
    ? source.status.replaceAll("_", " ")
    : syncing
      ? "syncing"
      : stale
        ? "stale"
        : incomplete
          ? "sync incomplete"
          : source.status.replaceAll("_", " ");
  const canResync = stale || incomplete;

  const retry = async () => {
    setBusy(true);
    onError("");
    try {
      onUpdated(await resyncRelationshipSource(source.source, source.sourceAccountId));
      onNotice(`${source.source} sync queued.`);
    } catch (error) {
      onError(errMessage(error, "Could not retry the source sync."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
      <div className="min-w-0">
        <span className="capitalize text-primary/80">{source.source}</span>
        {source.sourceAccountId && source.sourceAccountId !== "default" ? (
          <span className="ml-2 font-mono text-xs text-primary/45">{source.sourceAccountId}</span>
        ) : null}
        {stopped || stale || incomplete ? (
          <p className={`mt-0.5 text-xs ${stopped ? "text-destructive" : "text-amber-600"}`}>
            {stopped
              ? "This source has stopped reporting, so promises from it are not being read."
              : stale
                ? autoRefreshBlocker === "insufficient_credits"
                  ? "Automatic refresh is paused because this workspace is out of AI credits. The source is still connected; reconnecting will not fix it."
                  : autoRefreshBlocker === "upstream_credits_exhausted"
                    ? "Automatic refresh is paused because Oppulence's AI provider is temporarily unavailable. The source is still connected; reconnecting will not fix it."
                    : "No successful update arrived within the expected cadence. Refresh to catch up."
                : "The connection works, but its history is not fully synced."}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {canResync ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={retry}>
            {busy ? <CircleNotch className="animate-spin" /> : <ArrowClockwise />}{" "}
            {stale ? "Refresh now" : "Retry sync"}
          </Button>
        ) : null}
        <span
          className={
            stopped
              ? "shrink-0 border border-destructive/40 px-1.5 py-0.5 text-xs capitalize text-destructive"
              : stale || incomplete
                ? "shrink-0 border border-amber-500/40 px-1.5 py-0.5 text-xs capitalize text-amber-600"
                : "shrink-0 text-xs capitalize text-primary/60"
          }
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-primary/55">{label}</dt>
      <dd className={mono ? "font-mono text-xs text-primary/70" : "capitalize text-primary/80"}>
        {value}
      </dd>
    </div>
  );
}
