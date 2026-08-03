"use client";

import * as React from "react";
import { CheckCircle, CircleNotch, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { relativeTime } from "@/lib/revenue";
import { EmptyBlock } from "@/components/revenue/shared";
import type { RevenueLeakScan } from "@/types/revenue";

export function ScansView({
  scans,
  activeScan,
  scanning,
  onScan,
}: {
  scans: RevenueLeakScan[];
  activeScan: RevenueLeakScan | null;
  scanning: boolean;
  onScan: () => void;
}) {
  const rows = React.useMemo(() => {
    const map = new Map<string, RevenueLeakScan>();
    for (const s of scans) map.set(s.id, s);
    if (activeScan) map.set(activeScan.id, activeScan);
    return [...map.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }, [scans, activeScan]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="max-w-md text-sm text-primary/60">
          A scan reads your sent Gmail over the last 90 days and turns dormant threads into
          draft-first queue actions. Nothing is sent — every result is a draft you review.
        </p>
        <Button size="sm" onClick={onScan} disabled={scanning}>
          {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />}
          {scanning ? "Scanning…" : "Run scan"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock
          icon={<MagnifyingGlass className="size-6" />}
          title="No scans yet"
          body="Run your first scan to find the deals quietly slipping through your inbox."
        >
          <Button size="sm" onClick={onScan} disabled={scanning}>
            {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />} Run scan
          </Button>
        </EmptyBlock>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScanRow({ scan }: { scan: RevenueLeakScan }) {
  const running = scan.status === "running" || scan.status === "pending";
  return (
    <li className="rounded-[2px] border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {running ? (
            <CircleNotch className="size-4 animate-spin text-primary/60" />
          ) : scan.status === "completed" ? (
            <CheckCircle weight="fill" className="size-4 text-emerald-500" />
          ) : (
            <WarningCircle weight="fill" className="size-4 text-red-500" />
          )}
          <span className="text-sm font-medium text-primary">
            {running
              ? "Scanning your inbox…"
              : scan.status === "completed"
                ? "Scan complete"
                : "Scan failed"}
          </span>
          <Badge variant="outline" className="rounded-[2px] font-normal">
            {scan.lookbackDays}d
          </Badge>
        </div>
        <span className="text-xs text-primary/40">
          {relativeTime(scan.completedAt ?? scan.startedAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-primary/60">
        <Stat label="threads" value={scan.threadsSeen} />
        <Stat label="open loops" value={scan.candidatesSeen} />
        <Stat label="drafts prepared" value={scan.actionsCreated} />
        <Stat label="relationships" value={scan.relationshipsCreated} />
      </div>
      {scan.error ? <p className="mt-2 text-xs text-red-500">{scan.error}</p> : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <span>
      <span className="font-medium tabular-nums text-primary/80">{value ?? 0}</span> {label}
    </span>
  );
}
