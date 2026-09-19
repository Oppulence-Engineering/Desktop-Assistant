"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRelationshipSourceStatuses } from "@/hooks/queries/use-relationship-sources";
import { useRelationshipRefreshBlocker } from "@/hooks/queries/use-workflows";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
import { ArrowClockwise, LinkSimple, Plugs, ShieldCheck } from "@/lib/icons";
import { Badge as SimBadge, Chip } from "@sim/emcn";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import { Skeleton } from "@oppulence/ui/components/skeleton";
import { Spinner } from "@oppulence/ui/components/spinner";
import { Input } from "@oppulence/ui/components/input";
import {
  linkWorkspace,
  relativeTime,
  resyncRelationshipSource,
  RevenueAPIError,
} from "@/lib/revenue";
import { ConnectorSettings } from "@/components/features/connectors/connector-settings";
import {
  SimProductHeader,
  SimProductPanel,
} from "@/components/features/sim-product/sim-product-frame";
import { Field, errMessage } from "@/components/revenue/shared";
import { capture, RevenueEvents } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { RelationshipSourceStatus, RevenueWorkspace } from "@/types/revenue";

const CONNECTORS_SECTION_ID = "sources-connectors";

function scrollToConnectors() {
  document
    .getElementById(CONNECTORS_SECTION_ID)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
  const queryClient = useQueryClient();
  const sourcesQuery = useRelationshipSourceStatuses();
  const autoRefreshQuery = useRelationshipRefreshBlocker();

  const [orgId, setOrgId] = React.useState("");
  const [wsId, setWsId] = React.useState("");
  const [linkBusy, setLinkBusy] = React.useState(false);

  const refreshSources = React.useCallback(
    async (updated: RelationshipSourceStatus) => {
      queryClient.setQueryData<RelationshipSourceStatus[]>(
        relationshipSourceKeys.list(),
        (current) =>
          (current ?? []).map((item) =>
            item.connectionId === updated.connectionId ? updated : item,
          ),
      );
      await queryClient.invalidateQueries({ queryKey: relationshipSourceKeys.lists() });
    },
    [queryClient],
  );

  if (!workspace) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full rounded-[2px]" />
      </div>
    );
  }

  const linked = workspace.mode === "linked" && workspace.status === "active";
  const sources = sourcesQuery.data;
  const autoRefreshBlocker = autoRefreshQuery.data ?? "";

  const submitLink = async () => {
    if (!wsId.trim()) return;
    setLinkBusy(true);
    onError("");
    try {
      const ws = await linkWorkspace({
        outboundWorkspaceId: wsId.trim(),
        outboundOrganizationId: orgId.trim() || undefined,
      });
      onLinked(ws);
      capture(RevenueEvents.WorkspaceLinked);
      onNotice("Workspace linked — governed sending is now enabled.");
    } catch (error) {
      onError(
        error instanceof RevenueAPIError && error.code === "facade_unavailable"
          ? "Policy preflight isn't configured on the server yet, so linking can't be completed. Drafting still works in local mode."
          : errMessage(error, "Could not link the workspace."),
      );
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col gap-3 p-3" data-slot="sources-view">
      <SimProductPanel className="flex min-h-0 flex-1 flex-col">
        <SimProductHeader
          actions={
            sourcesQuery.isLoading
              ? "Loading…"
              : `${sources?.length ?? 0} source${sources?.length === 1 ? "" : "s"}`
          }
          title="Connected sources"
        />
        {sourcesQuery.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-16 w-full rounded-[2px]" />
          </div>
        ) : sourcesQuery.isError || !sources?.length ? (
          <div className="flex flex-col gap-3 px-4 py-6 text-sm text-[var(--text-secondary)]">
            <p>
              No evidence sources are connected yet. Connect Gmail, Calendar, Slack, or CRM below.
            </p>
            <Button onClick={scrollToConnectors} size="sm" type="button">
              <Plugs /> Connect sources
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {sources.map((source) => (
              <SourceRow
                autoRefreshBlocker={autoRefreshBlocker}
                key={`${source.source}:${source.sourceAccountId}`}
                onError={onError}
                onNotice={onNotice}
                onOpenConnectors={scrollToConnectors}
                onUpdated={refreshSources}
                source={source}
              />
            ))}
          </div>
        )}
      </SimProductPanel>

      <SimProductPanel className="flex flex-col" id={CONNECTORS_SECTION_ID}>
        <SimProductHeader
          actions={
            onOpenConnectors ? (
              <button
                className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                onClick={onOpenConnectors}
                type="button"
              >
                All settings
              </button>
            ) : null
          }
          title="Connectors"
        />
        <div className="sources-connectors px-1 py-2">
          <ConnectorSettings showHeading={false} />
        </div>
      </SimProductPanel>

      <SimProductPanel>
        <SimProductHeader
          actions={
            <SimBadge variant={linked ? "green" : "amber"}>
              {linked ? "Linked" : "Local mode"}
            </SimBadge>
          }
          title="Workspace"
        />
        <div className="divide-y divide-[var(--border)] text-sm">
          <MetadataRow label="Mode" value={workspace.mode} />
          <MetadataRow label="Status" value={workspace.status} />
          <MetadataRow
            label="Preflight"
            value={workspace.preflightAvailable ? "Available" : "Unavailable (drafts only)"}
          />
          {workspace.outboundOrganizationId ? (
            <MetadataRow label="Organization" mono value={workspace.outboundOrganizationId} />
          ) : null}
          {workspace.outboundWorkspaceId ? (
            <MetadataRow
              label="OutboundConsole workspace"
              mono
              value={workspace.outboundWorkspaceId}
            />
          ) : null}
          {workspace.lastVerifiedAt ? (
            <MetadataRow label="Last verified" value={relativeTime(workspace.lastVerifiedAt)} />
          ) : null}
        </div>
      </SimProductPanel>

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

          <SimProductPanel>
            <SimProductHeader title="Link a governed workspace" />
            <div className="flex flex-col gap-3 px-4 py-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Connect an OutboundConsole workspace to turn on policy-checked sending.
              </p>
              <Field label="OutboundConsole workspace ID">
                <Input
                  onChange={(event) => setWsId(event.target.value)}
                  placeholder="ws_…"
                  value={wsId}
                />
              </Field>
              <Field label="Organization ID (optional)">
                <Input
                  onChange={(event) => setOrgId(event.target.value)}
                  placeholder="org_…"
                  value={orgId}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={linkBusy || !wsId.trim()}
                  onClick={() => void submitLink()}
                  size="sm"
                >
                  {linkBusy ? <Spinner /> : <LinkSimple />} Link workspace
                </Button>
              </div>
            </div>
          </SimProductPanel>
        </>
      )}
    </div>
  );
}

function SourceRow({
  source,
  autoRefreshBlocker,
  onError,
  onNotice,
  onOpenConnectors,
  onUpdated,
}: {
  source: RelationshipSourceStatus;
  autoRefreshBlocker: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onOpenConnectors: () => void;
  onUpdated: (source: RelationshipSourceStatus) => Promise<void>;
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
      const updated = await resyncRelationshipSource(source.source, source.sourceAccountId);
      await onUpdated(updated);
      onNotice(`${source.source} sync queued.`);
    } catch (error) {
      onError(errMessage(error, "Could not retry the source sync."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <div className="font-normal capitalize text-[var(--text-primary)]">
          {source.source}
          {source.sourceAccountId && source.sourceAccountId !== "default" ? (
            <Badge
              className="ml-2 font-mono text-xs font-normal text-[var(--text-muted)]"
              variant="outline"
            >
              {source.sourceAccountId}
            </Badge>
          ) : null}
        </div>
        {stopped || stale || incomplete ? (
          <p
            className={cn(
              "mt-1 text-sm",
              stopped ? "text-destructive" : "text-amber-600 dark:text-amber-400",
            )}
          >
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
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {stopped ? (
          <Chip onClick={onOpenConnectors} type="button">
            Reconnect
          </Chip>
        ) : null}
        {canResync ? (
          <Button
            disabled={busy}
            onClick={() => void retry()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy ? <Spinner /> : <ArrowClockwise />} {stale ? "Refresh now" : "Retry sync"}
          </Button>
        ) : null}
        <SimBadge variant={stopped || stale || incomplete ? "amber" : "gray"}>{label}</SimBadge>
      </div>
    </div>
  );
}

function MetadataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <Label className="font-normal text-[var(--text-secondary)]">{label}</Label>
      <span className={cn("text-[var(--text-primary)]", mono ? "font-mono text-xs" : "capitalize")}>
        {value}
      </span>
    </div>
  );
}
