"use client";

import * as React from "react";
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

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
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
        if (e instanceof RevenueAPIError && e.status === 401) return;
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

  // Poll a running scan until it finishes; refresh the queue on completion.
  React.useEffect(() => {
    if (!activeScan || (activeScan.status !== "running" && activeScan.status !== "pending")) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const next = await getScan(activeScan.id);
        if (!alive) return;
        setActiveScan(next);
        setScans((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          map.set(next.id, next);
          return [...map.values()];
        });
        if (next.status === "completed" || next.status === "failed") {
          setScanning(false);
          if (next.status === "failed") setError(next.error || "The scan failed.");
          else setRefreshKey((k) => k + 1);
        }
      } catch {
        // transient; keep polling
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeScan]);

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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-[2px] bg-background-200 text-primary/70 dark:bg-background-100">
          <AddressBook weight="fill" className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-primary">Relationships</h1>
          <p className="max-w-lg text-sm text-primary/60">
            A living model of every customer relationship: what changed, what needs action, and the
            evidence behind each recommendation.
          </p>
        </div>
      </header>

      {/* sub-navigation */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-primary/55 hover:text-primary",
            )}
          >
            {t.icon}
            {t.label}
            {t.key === "scans" && scanning ? (
              <span className="size-1.5 animate-pulse rounded-full bg-oppulence-orange" />
            ) : null}
          </button>
        ))}
      </div>

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
        <RelationshipsView onError={setBanner} onNotice={setNoticeMsg} />
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
    </div>
  );
}
