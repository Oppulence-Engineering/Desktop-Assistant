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
  getCommitmentRecordMarkdown,
  getWorkspace,
  listCommitments,
  listRelationshipSources,
  RevenueAPIError,
  runCommitmentRecovery,
  startScan,
} from "@/lib/revenue";
import {
  CommitmentQueue,
  registerFilterFor,
  type CommitmentQueueItem,
  type CommitmentQueueTransition,
  type RegisterView,
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

// The register's own failures, in words a customer can act on. A raw "not
// found" from the proxy tells them nothing; worse, the old code showed no
// message at all and rendered the onboarding prompt instead.
function registerErrorMessage(reason: unknown): string {
  const status = reason instanceof RevenueAPIError ? reason.status : 0;
  if (status === 404) {
    return "The commitment register is unavailable on this server. This usually means the app is newer than the API it is talking to.";
  }
  if (status === 403) {
    return "You do not have access to the commitment register in this workspace.";
  }
  if (reason instanceof Error && reason.message.trim()) {
    return friendlyRevenueError(reason.message);
  }
  return "The commitment register could not be loaded.";
}

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
  // The register comes from its own route now. The relationship graph is still
  // fetched, but only for the account count in the empty state — the rows
  // themselves are no longer reassembled from graph nodes in the browser.
  const [registerView, setRegisterView] = React.useState<RegisterView>("we_owe");
  const commitmentQuery = useQuery({
    queryKey: ["commitment-queue", refreshKey, registerView],
    queryFn: async () => {
      const [entries, sources, graph] = await Promise.allSettled([
        listCommitments(registerFilterFor(registerView)),
        listRelationshipSources(),
        getRelationshipGraph({ scope: "portfolio", depth: 1 }),
      ]);
      // A failed register fetch must not erase a source list that loaded fine.
      // Throwing here used to discard the whole result, so the panel fell back
      // to sources=[] and rendered "Connect Gmail & Calendar" — telling a user
      // whose Google account was connected and healthy to go connect it. A
      // request that fails has to say so, not impersonate onboarding.
      return {
        entries: entries.status === "fulfilled" ? entries.value : [],
        registerError:
          entries.status === "rejected" ? registerErrorMessage(entries.reason) : undefined,
        sources: sources.status === "fulfilled" ? sources.value : [],
        relationshipCount:
          graph.status === "fulfilled"
            ? graph.value.nodes.filter((node) => node.kind === "relationship").length
            : 0,
      };
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

  // The record leaves the tool as Markdown, because the place it gets used is
  // an email thread and Markdown pastes.
  const exportRecord = React.useCallback(
    async (item: CommitmentQueueItem) => {
      try {
        const markdown = await getCommitmentRecordMarkdown(item.id);
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `commitment-${item.id}.md`;
        link.click();
        URL.revokeObjectURL(url);
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
    <div className="flex h-full min-w-0 w-full flex-col overflow-hidden">
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
