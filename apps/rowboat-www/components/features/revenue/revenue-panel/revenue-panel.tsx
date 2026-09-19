"use client";

import "client-only";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkle, WarningCircle } from "@/lib/icons";
import { useCommitmentRegister } from "@/hooks/queries/use-commitments";
import { useReportScan, useReportScanList } from "@/hooks/queries/use-report";
import { useRelationshipSourceStatuses } from "@/hooks/queries/use-relationship-sources";
import { useWorkspace } from "@/hooks/queries/use-workspace";
import { commitmentKeys } from "@/hooks/queries/utils/commitment-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
import { downloadMarkdown } from "@/lib/content/download-markdown";
import { DashboardRequestError } from "@/lib/api/request-json";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import type { RevenueTab } from "@/components/features/dashboard/app-shell/app-shell";
import { capture, RevenueEvents } from "@/lib/analytics/analytics";
import {
  appendCommitmentTransition,
  friendlyRevenueError,
  googleNeedsReconnect,
  getCommitmentRecordMarkdown,
  REVENUE_EVIDENCE_LOOKBACK_DAYS,
  RevenueAPIError,
  runCommitmentRecovery,
  startScan,
} from "@/lib/revenue/revenue";
import {
  CommitmentQueue,
  type CommitmentQueueItem,
  type CommitmentQueueTransition,
  type RegisterView,
} from "@/components/features/revenue/commitment-queue/commitment-queue";
import { ImpactView } from "@/components/features/revenue/impact-view/impact-view";
import { QueueView } from "@/components/features/revenue/queue-view/queue-view";
import { RelationshipsView } from "@/components/features/revenue/relationships-view/relationships-view";
import {
  NotesView,
  PeopleView,
  TasksView,
} from "@/components/features/revenue/workspace-records/workspace-records-view";
import { ScansView } from "@/components/features/revenue/scans-view/scans-view";
import { WorkspaceView } from "@/components/features/revenue/workspace-view/workspace-view";
import { ActionsView } from "@/components/features/actions/actions-view/actions-view";
import type { RevenueLeakScan, RevenueWorkspace } from "@/lib/revenue/types";

// The register's own failures, in words a customer can act on. A raw "not
// found" from the proxy tells them nothing; worse, the old code showed no
// message at all and rendered the onboarding prompt instead.
function registerErrorMessage(reason: unknown): string {
  const status = reason instanceof RevenueAPIError ? reason.status : 0;
  const code = reason instanceof RevenueAPIError ? reason.code : undefined;
  if (status === 404) {
    return "The commitment register is unavailable on this server. This usually means the app is newer than the API it is talking to.";
  }
  if (status === 403) {
    return "You do not have access to the commitment register in this workspace.";
  }
  if (status === 503) {
    if (code === "session_unavailable") {
      return friendlyRevenueError("session refresh is temporarily unavailable");
    }
    return friendlyRevenueError("Request failed (503)");
  }
  if (reason instanceof Error && reason.message.trim()) {
    return friendlyRevenueError(reason.message);
  }
  return "The commitment register could not be loaded.";
}

export function RevenuePanel({
  tab,
  onTabChange,
  onOpenConnectors,
}: {
  tab: RevenueTab;
  onTabChange: (tab: RevenueTab) => void;
  onOpenConnectors?: () => void;
}) {
  const [workspaceOverride, setWorkspace] = React.useState<RevenueWorkspace | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [scans, setScans] = React.useState<RevenueLeakScan[]>([]);
  const [activeScan, setActiveScan] = React.useState<RevenueLeakScan | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const workspaceQuery = useWorkspace();
  const scanListQuery = useReportScanList();
  const workspace = workspaceOverride ?? workspaceQuery.data ?? null;

  const setBanner = React.useCallback((msg: string | null) => setError(msg || null), []);
  const setNoticeMsg = React.useCallback((msg: string) => {
    setNotice(msg);
    setError(null);
  }, []);

  const queryClient = useQueryClient();
  const sourceStatusQuery = useRelationshipSourceStatuses();
  const reconnectBeforeAudit = googleNeedsReconnect(sourceStatusQuery.data ?? []);

  const activeScanIsRunning = activeScan?.status === "running" || activeScan?.status === "pending";
  const scanQuery = useReportScan(activeScanIsRunning ? (activeScan?.id ?? null) : null, {
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2_000;
    },
  });
  // The register comes from its own route now. The relationship graph is still
  // fetched, but only for the account count in the empty state — the rows
  // themselves are no longer reassembled from graph nodes in the browser.
  const [registerView, setRegisterView] = React.useState<RegisterView>("we_owe");
  const [registerAccountId, setRegisterAccountId] = React.useState("");
  const [registerOwner, setRegisterOwner] = React.useState("");
  const [includeCandidates, setIncludeCandidates] = React.useState(false);
  const commitmentQuery = useCommitmentRegister(
    {
      view: registerView,
      accountId: registerAccountId,
      owner: registerOwner,
      includeCandidates,
    },
    { enabled: tab === "commitments" },
  );

  React.useEffect(() => {
    const reason = workspaceQuery.error;
    if (!reason) return;
    if (
      reason instanceof DashboardRequestError &&
      (reason.status === 401 || reason.status === 404)
    ) {
      return;
    }
    if (reason instanceof RevenueAPIError && (reason.status === 401 || reason.status === 404)) {
      return;
    }
    setError(registerErrorMessage(reason));
  }, [workspaceQuery.error]);

  React.useEffect(() => {
    if (!scanListQuery.data) return;
    setScans(scanListQuery.data);
  }, [scanListQuery.data]);

  // Reconcile query data into the existing panel state while this feature is
  // incrementally migrated from local state to query-owned server state.
  React.useEffect(() => {
    const next = scanQuery.data;
    if (!next) return;
    setActiveScan(next);
    setScans((previous) => {
      const scansById = new Map(previous.map((scan) => [scan.id, scan]));
      scansById.set(next.id, next);
      return [...scansById.values()];
    });
    if (next.status === "completed" || next.status === "failed") {
      setScanning(false);
      if (next.status === "failed") setError(next.error || "The scan failed.");
      // Either outcome changes the sources: a failed audit marks a dead grant.
      // Refetching only after success left the page saying "the connection
      // looks healthy" beside the reconnect error it had just shown.
      void queryClient.invalidateQueries({ queryKey: relationshipSourceKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: commitmentKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.lists() });
    }
  }, [scanQuery.data, queryClient]);

  const runScan = React.useCallback(async () => {
    // Every audit button routes here. With every Google account needing a
    // reconnect the audit can only fail, so send the user to the fix instead.
    if (reconnectBeforeAudit && onOpenConnectors) {
      onOpenConnectors();
      return;
    }
    setError(null);
    setNotice(null);
    setScanning(true);
    capture(RevenueEvents.ScanStarted);
    try {
      const s = await startScan(REVENUE_EVIDENCE_LOOKBACK_DAYS);
      setActiveScan(s);
      setScans((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
    } catch (e) {
      setScanning(false);
      if (e instanceof RevenueAPIError && e.code === "scan_unavailable") {
        setError("Connect Gmail and Calendar before running a Promise Leak Audit.");
      } else {
        setError(e instanceof Error ? e.message : "Could not start the scan.");
      }
    }
  }, [reconnectBeforeAudit, onOpenConnectors]);

  const transitionCommitment = React.useCallback(
    async (item: CommitmentQueueItem, transition: CommitmentQueueTransition) => {
      try {
        await appendCommitmentTransition(item.relationshipId, item.id, transition);
        await commitmentQuery.refetch();
        setNoticeMsg("Commitment review recorded.");
        return true;
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Could not update the commitment.");
        return false;
      }
    },
    [commitmentQuery, setBanner, setNoticeMsg],
  );

  // The record leaves the tool as Markdown, because the place it gets used is
  // an email thread and Markdown pastes.
  const exportRecord = React.useCallback(
    async (item: CommitmentQueueItem) => {
      try {
        const markdown = await getCommitmentRecordMarkdown(item.id);
        downloadMarkdown(`commitment-${item.id}.md`, markdown);
        capture(RevenueEvents.CommitmentExported, { commitmentId: item.id, state: item.state });
        setNoticeMsg("Commitment record exported.");
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Could not export the record.");
      }
    },
    [setBanner, setNoticeMsg],
  );

  const draftRecovery = React.useCallback(
    async (relationshipId: string) => {
      try {
        const result = await runCommitmentRecovery(relationshipId);
        await queryClient.invalidateQueries({ queryKey: commitmentKeys.lists() });
        await queryClient.invalidateQueries({ queryKey: revenueActionKeys.lists() });
        await commitmentQuery.refetch();
        const evaluations = result.evaluations;
        setNoticeMsg(
          Array.isArray(evaluations) && evaluations.length > 0
            ? "Recovery draft created. Review and approve it before sending."
            : "No due commitment needed a recovery draft.",
        );
        return true;
      } catch (error) {
        setBanner(error instanceof Error ? error.message : "Could not draft commitment recovery.");
        return false;
      }
    },
    [commitmentQuery, setBanner, setNoticeMsg],
  );

  const scansNewestFirst = (activeScan ? [activeScan, ...scans] : scans).sort((left, right) =>
    (right.completedAt || right.startedAt || "").localeCompare(
      left.completedAt || left.startedAt || "",
    ),
  );
  const latestCompletedScan = scansNewestFirst.find((scan) => scan.status === "completed");
  // A failed audit is the answer to "why is my register empty", and it was only
  // visible on the audits screen — somewhere a user has no reason to open. The
  // failure belongs next to the empty register that it caused.
  const latestScanFailure = scansNewestFirst.find((scan) => scan.status === "failed");
  const showFailure =
    latestScanFailure &&
    (!latestCompletedScan ||
      (latestScanFailure.completedAt || "") > (latestCompletedScan.completedAt || ""));

  return (
    <div className="flex h-full min-w-0 w-full flex-col overflow-hidden" data-slot="revenue-panel">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <Alert variant="destructive" className="m-3 mb-0 rounded-none">
            <WarningCircle weight="fill" />
            <AlertTitle>Action needed</AlertTitle>
            <AlertDescription>{friendlyRevenueError(error)}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert className="m-3 mb-0 rounded-none">
            <Sparkle weight="fill" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {tab === "commitments" ? (
          <CommitmentQueue
            entries={commitmentQuery.data?.entries ?? []}
            view={registerView}
            onViewChange={setRegisterView}
            onExport={exportRecord}
            relationshipCount={commitmentQuery.data?.relationshipCount ?? 0}
            accounts={commitmentQuery.data?.accounts ?? []}
            accountId={registerAccountId}
            onAccountChange={setRegisterAccountId}
            owner={registerOwner}
            onOwnerChange={setRegisterOwner}
            onIncludeCandidatesChange={setIncludeCandidates}
            sources={commitmentQuery.data?.sources ?? []}
            latestScan={latestCompletedScan}
            failedScan={showFailure ? latestScanFailure : undefined}
            loading={commitmentQuery.isLoading}
            error={
              commitmentQuery.error instanceof Error
                ? commitmentQuery.error.message
                : commitmentQuery.error
                  ? "Could not load the Commitment Queue."
                  : commitmentQuery.data?.registerError
            }
            scanning={scanning}
            onScan={runScan}
            onOpenConnectors={onOpenConnectors}
            onOpenAccounts={() => onTabChange("relationships")}
            onOpenRecoveryQueue={() => onTabChange("queue")}
            onTransition={transitionCommitment}
            onDraftRecovery={draftRecovery}
          />
        ) : tab === "queue" ? (
          <QueueView
            workspace={workspace}
            onError={setBanner}
            onNotice={setNoticeMsg}
            onScan={runScan}
            scanning={scanning}
            needsReconnect={reconnectBeforeAudit}
          />
        ) : tab === "actions" ? (
          <ActionsView />
        ) : tab === "tasks" ? (
          <TasksView onError={setBanner} onNotice={setNoticeMsg} />
        ) : tab === "notes" ? (
          <NotesView onError={setBanner} onNotice={setNoticeMsg} />
        ) : tab === "people" ? (
          <PeopleView onError={setBanner} onNotice={setNoticeMsg} />
        ) : tab === "impact" ? (
          <ImpactView onError={setBanner} />
        ) : tab === "relationships" ? (
          <RelationshipsView
            onError={setBanner}
            onNotice={setNoticeMsg}
            onOpenConnectors={onOpenConnectors}
          />
        ) : tab === "scans" ? (
          <ScansView
            scans={scans}
            activeScan={activeScan}
            scanning={scanning}
            needsReconnect={reconnectBeforeAudit}
            onScan={runScan}
          />
        ) : (
          <WorkspaceView
            onError={setBanner}
            onLinked={setWorkspace}
            onNotice={setNoticeMsg}
            onOpenConnectors={onOpenConnectors}
            workspace={workspace}
          />
        )}
      </div>
    </div>
  );
}
