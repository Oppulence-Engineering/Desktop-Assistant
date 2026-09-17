"use client";

import * as React from "react";
import { ArrowClockwise, LinkSimple, Plugs, ShieldCheck } from "@/lib/icons";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@oppulence/ui/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@oppulence/ui/components/item";
import { Label } from "@oppulence/ui/components/label";
import { Skeleton } from "@oppulence/ui/components/skeleton";
import { Spinner } from "@oppulence/ui/components/spinner";
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

  if (!workspace) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full rounded-[2px]" />
      </div>
    );
  }

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
      <Card className="gap-0 rounded-[2px] border-border py-0 shadow-none">
        <CardHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <CardTitle className="text-sm font-medium text-primary">Connected sources</CardTitle>
          {onOpenConnectors ? (
            <CardAction>
              <Button onClick={onOpenConnectors} size="sm" variant="outline">
                Manage connectors
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {sources === null ? (
            <div className="flex flex-col gap-2 px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : sources.length === 0 ? (
            <p className="px-4 py-3 text-sm text-primary/50">
              No sources are connected yet, so there is nothing to read promises from.
            </p>
          ) : (
            <ItemGroup className="text-sm">
              {sources.map((source, index) => (
                <React.Fragment key={`${source.source}:${source.sourceAccountId}`}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <SourceRow
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
                </React.Fragment>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 rounded-[2px] border-border py-0 shadow-none">
        <CardHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <CardTitle className="text-sm font-medium text-primary">Workspace</CardTitle>
          <Badge
            variant="outline"
            className={
              linked
                ? "gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "gap-1.5 border-border text-primary/55"
            }
          >
            <Badge
              className={
                "size-1.5 rounded-full p-0 " + (linked ? "bg-emerald-500" : "bg-primary/30")
              }
              variant="default"
            />
            {linked ? "Linked" : "Local mode"}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <ItemGroup className="text-sm">
            <Row label="Mode" value={workspace.mode} />
            <ItemSeparator />
            <Row label="Status" value={workspace.status} />
            <ItemSeparator />
            <Row
              label="Preflight"
              value={workspace.preflightAvailable ? "Available" : "Unavailable (drafts only)"}
            />
            {workspace.outboundOrganizationId ? (
              <>
                <ItemSeparator />
                <Row label="Organization" value={workspace.outboundOrganizationId} mono />
              </>
            ) : null}
            {workspace.outboundWorkspaceId ? (
              <>
                <ItemSeparator />
                <Row label="OutboundConsole workspace" value={workspace.outboundWorkspaceId} mono />
              </>
            ) : null}
            {workspace.lastVerifiedAt ? (
              <>
                <ItemSeparator />
                <Row label="Last verified" value={relativeTime(workspace.lastVerifiedAt)} />
              </>
            ) : null}
          </ItemGroup>
        </CardContent>
      </Card>

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

          <Card className="gap-0 rounded-[2px] border-border py-0 shadow-none">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-sm font-medium text-primary">
                Link a governed workspace
              </CardTitle>
              <CardDescription className="text-sm text-primary/60">
                Connect an OutboundConsole workspace to turn on policy-checked sending.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <div className="flex flex-col gap-3">
                <Field label="OutboundConsole workspace ID">
                  <Input
                    value={wsId}
                    onChange={(e) => setWsId(e.target.value)}
                    placeholder="ws_…"
                  />
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
                    {busy ? <Spinner /> : <LinkSimple />} Link workspace
                  </Button>
                  {onOpenConnectors ? (
                    <Button variant="ghost" size="sm" onClick={onOpenConnectors}>
                      Manage connectors
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
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
    <Item size="sm" className="flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
      <ItemContent className="min-w-0">
        <ItemTitle className="font-normal capitalize text-primary/80">
          {source.source}
          {source.sourceAccountId && source.sourceAccountId !== "default" ? (
            <Badge variant="outline" className="ml-2 font-mono text-xs font-normal text-primary/45">
              {source.sourceAccountId}
            </Badge>
          ) : null}
        </ItemTitle>
        {stopped || stale || incomplete ? (
          <ItemDescription className={stopped ? "text-destructive" : "text-amber-600"}>
            {stopped
              ? "This source has stopped reporting, so promises from it are not being read."
              : stale
                ? autoRefreshBlocker === "insufficient_credits"
                  ? "Automatic refresh is paused because this workspace is out of AI credits. The source is still connected; reconnecting will not fix it."
                  : autoRefreshBlocker === "upstream_credits_exhausted"
                    ? "Automatic refresh is paused because Oppulence's AI provider is temporarily unavailable. The source is still connected; reconnecting will not fix it."
                    : "No successful update arrived within the expected cadence. Refresh to catch up."
                : "The connection works, but its history is not fully synced."}
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>
        {canResync ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={retry}>
            {busy ? <Spinner /> : <ArrowClockwise />} {stale ? "Refresh now" : "Retry sync"}
          </Button>
        ) : null}
        <Badge
          variant="outline"
          className={
            stopped
              ? "shrink-0 border-destructive/40 capitalize text-destructive"
              : stale || incomplete
                ? "shrink-0 border-amber-500/40 capitalize text-amber-600"
                : "shrink-0 border-transparent capitalize text-primary/60"
          }
        >
          {label}
        </Badge>
      </ItemActions>
    </Item>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Item size="sm" className="justify-between px-4 py-2.5">
      <ItemContent className="flex-row items-center justify-between gap-4">
        <Label className="font-normal text-primary/55">{label}</Label>
        <Badge
          className={
            mono
              ? "font-mono text-xs font-normal text-primary/70"
              : "capitalize font-normal text-primary/80"
          }
          variant="secondary"
        >
          {value}
        </Badge>
      </ItemContent>
    </Item>
  );
}
