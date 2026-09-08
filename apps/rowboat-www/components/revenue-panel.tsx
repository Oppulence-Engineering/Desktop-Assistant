"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkle, WarningCircle } from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import type { RevenueTab } from "@/components/app-shell";
import { capture, RevenueEvents } from "@/lib/analytics";
import {
  appendCommitmentTransition,
  friendlyRevenueError,
  getRelationshipGraph,
  getScan,
  getScans,
  getWorkspace,
  listRelationshipSources,
  RevenueAPIError,
  runCommitmentRecovery,
  startScan,
} from "@/lib/revenue";
import {
  CommitmentQueue,
  type CommitmentQueueItem,
  type CommitmentQueueTransition,
} from "@/components/features/revenue/commitment-queue/commitment-queue";
import { ImpactView } from "@/components/revenue/impact-view";
import { QueueView } from "@/components/revenue/queue-view";
import { RelationshipsView } from "@/components/revenue/relationships-view";
import {
  NotesView,
  PeopleView,
  TasksView,
} from "@/components/features/revenue/workspace-records/workspace-records-view";
import { ScansView } from "@/components/revenue/scans-view";
import { WorkspaceView } from "@/components/revenue/workspace-view";
import { ActionsView } from "@/components/actions/actions-view";
import type { RevenueLeakScan, RevenueWorkspace } from "@/types/revenue";

const SCAN_IDS_KEY = "oppulence.revenue.scanIds";

function loadScanIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCAN_IDS_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(ids) ? ids.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveScanIds(ids: string[]) {
  try {
    window.localStorage.setItem(SCAN_IDS_KEY, JSON.stringify(ids.slice(0, 10)));
  } catch {
    // storage unavailable — history is best-effort
  }
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
  const [workspace, setWorkspace] = React.useState<RevenueWorkspace | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [scans, setScans] = React.useState<RevenueLeakScan[]>([]);
  const [activeScan, setActiveScan] = React.useState<RevenueLeakScan | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Load workspace + hydrate any prior scans this browser started.
  React.useEffect(() => {
    void getWorkspace()
      .then(setWorkspace)
      .catch((e) => {
        if (e instanceof RevenueAPIError && (e.status === 401 || e.status === 404)) return;
        setError(e instanceof Error ? e.message : "Could not load the revenue workspace.");
      });
    const ids = loadScanIds();
    if (ids.length)
      void getScans(ids)
        .then(setScans)
        .catch(() => {});
  }, []);

  const setBanner = React.useCallback((msg: string | null) => setError(msg || null), []);
  const setNoticeMsg = React.useCallback((msg: string) => {
    setNotice(msg);
    setError(null);
  }, []);

  const activeScanIsRunning = activeScan?.status === "running" || activeScan?.status === "pending";
  const scanQuery = useQuery({
    queryKey: ["revenue-scan", activeScan?.id],
    queryFn: ({ signal }) => getScan(activeScan!.id, signal),
    enabled: Boolean(activeScan?.id && activeScanIsRunning),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2_000;
    },
  });
  const commitmentQuery = useQuery({
    queryKey: ["commitment-queue", refreshKey],
    queryFn: async () => {
      const [graph, sources] = await Promise.allSettled([
        getRelationshipGraph({ scope: "portfolio", depth: 1 }),
        listRelationshipSources(),
      ]);
      if (graph.status === "rejected") throw graph.reason;
      return { graph: graph.value, sources: sources.status === "fulfilled" ? sources.value : [] };
    },
    enabled: tab === "commitments",
  });

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
      else setRefreshKey((key) => key + 1);
    }
  }, [scanQuery.data]);

  const runScan = React.useCallback(async () => {
    setError(null);
    setNotice(null);
    setScanning(true);
    capture(RevenueEvents.ScanStarted);
    try {
      const s = await startScan(90);
      setActiveScan(s);
      setScans((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
      saveScanIds([s.id, ...loadScanIds().filter((id) => id !== s.id)]);
    } catch (e) {
      setScanning(false);
      if (e instanceof RevenueAPIError && e.code === "scan_unavailable") {
        setError("Connect Gmail and Calendar before running a Promise Leak Audit.");
      } else {
        setError(e instanceof Error ? e.message : "Could not start the scan.");
      }
    }
  }, []);

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

  const draftRecovery = React.useCallback(
    async (relationshipId: string) => {
      try {
        const result = await runCommitmentRecovery(relationshipId);
        setRefreshKey((key) => key + 1);
        await commitmentQuery.refetch();
        setNoticeMsg(
          result.evaluations.length
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

  const latestCompletedScan = (activeScan ? [activeScan, ...scans] : scans)
    .filter((scan) => scan.status === "completed")
    .sort((left, right) =>
      (right.completedAt || right.startedAt || "").localeCompare(
        left.completedAt || left.startedAt || "",
      ),
    )[0];

  return (
    <div className="flex h-full min-w-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <Alert variant="destructive" className="m-3 mb-0 rounded-md">
            <WarningCircle weight="fill" />
            <AlertTitle>Action needed</AlertTitle>
            <AlertDescription>{friendlyRevenueError(error)}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert className="m-3 mb-0 rounded-md">
            <Sparkle weight="fill" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {tab === "commitments" ? (
          <CommitmentQueue
            graph={commitmentQuery.data?.graph ?? null}
            sources={commitmentQuery.data?.sources ?? []}
            latestScan={latestCompletedScan}
            loading={commitmentQuery.isLoading}
            error={
              commitmentQuery.error instanceof Error
                ? commitmentQuery.error.message
                : commitmentQuery.error
                  ? "Could not load the Commitment Queue."
                  : undefined
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
            refreshKey={refreshKey}
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
          <ScansView scans={scans} activeScan={activeScan} scanning={scanning} onScan={runScan} />
        ) : (
          <div className="p-4">
            <WorkspaceView
              workspace={workspace}
              onLinked={setWorkspace}
              onError={setBanner}
              onNotice={setNoticeMsg}
              onOpenConnectors={onOpenConnectors}
            />
          </div>
        )}
      </div>
    </div>
  );
}
