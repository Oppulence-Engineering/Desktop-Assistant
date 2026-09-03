"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AddressBook,
  ChartLineUp,
  ListChecks,
  MagnifyingGlass,
  Plugs,
  Sparkle,
  Tray,
  WarningCircle,
} from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Tabs, TabsList, TabsTrigger } from "@oppulence/ui/components/tabs";
import { capture, RevenueEvents } from "@/lib/analytics";
import { getScan, getScans, getWorkspace, RevenueAPIError, startScan } from "@/lib/revenue";
import { ImpactView } from "@/components/revenue/impact-view";
import { QueueView } from "@/components/revenue/queue-view";
import { RelationshipsView } from "@/components/revenue/relationships-view";
import { ScansView } from "@/components/revenue/scans-view";
import { WorkspaceView } from "@/components/revenue/workspace-view";
import { ActionsView } from "@/components/actions/actions-view";
import type { RevenueLeakScan, RevenueWorkspace } from "@/types/revenue";

type Tab = "queue" | "actions" | "impact" | "relationships" | "scans" | "workspace";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "relationships", label: "Mission Control", icon: <AddressBook /> },
  { key: "queue", label: "Queue", icon: <Tray /> },
  { key: "actions", label: "Actions", icon: <ListChecks /> },
  { key: "impact", label: "Impact", icon: <ChartLineUp /> },
  { key: "scans", label: "Scans", icon: <MagnifyingGlass /> },
  { key: "workspace", label: "Workspace", icon: <Plugs /> },
];

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

export function RevenuePanel({ onOpenConnectors }: { onOpenConnectors?: () => void }) {
  const [tab, setTab] = React.useState<Tab>("relationships");
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
        setError(
          "Connect Gmail before running a scan — it reads your sent mail to find open loops.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Could not start the scan.");
      }
    }
  }, []);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      className="flex h-full w-full flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5"
    >
      {/* sub-navigation */}
      <TabsList variant="line" className="h-auto w-full justify-start border-b border-border p-0">
        {TABS.map((t) => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            className="h-9 flex-none rounded-t-[8px] px-3 text-[13px]"
          >
            {t.icon}
            {t.label}
            {t.key === "scans" && scanning ? (
              <span className="size-1.5 animate-pulse rounded-full bg-oppulence-orange" />
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {error ? (
        <Alert variant="destructive">
          <WarningCircle weight="fill" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <Sparkle weight="fill" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {tab === "queue" ? (
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
        <WorkspaceView
          workspace={workspace}
          onLinked={setWorkspace}
          onError={setBanner}
          onNotice={setNoticeMsg}
          onOpenConnectors={onOpenConnectors}
        />
      )}
    </Tabs>
  );
}
