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
    <div className="flex min-h-full w-full min-w-0 flex-col">
      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[13px] text-primary/55">
          A Promise Leak Audit reviews 90 days of Gmail for explicit promises and stalled client
          follow-ups. Nothing is sent without your approval.
        </p>
        <Button size="sm" onClick={onScan} disabled={scanning}>
          {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />}
          {scanning ? "Auditing…" : "Run Promise Leak Audit"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock
          icon={<MagnifyingGlass className="size-6" />}
          title="No audits yet"
          body="Run your first audit to build a reviewable Commitment Queue from Gmail evidence."
        >
          <Button size="sm" onClick={onScan} disabled={scanning}>
            {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />} Run audit
          </Button>
        </EmptyBlock>
      ) : (
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="grid h-10 min-w-[760px] grid-cols-[minmax(220px,1fr)_70px_repeat(4,100px)] items-center border-b border-border px-3 text-[12px] text-primary/45">
            <span>Audit</span>
            <span>Window</span>
            <span>Threads</span>
            <span>Candidates</span>
            <span>Drafts</span>
            <span>Relationships</span>
          </div>
          <ul className="min-w-[760px]">
            {rows.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScanRow({ scan }: { scan: RevenueLeakScan }) {
  const running = scan.status === "running" || scan.status === "pending";
  return (
    <li className="grid min-h-11 grid-cols-[minmax(220px,1fr)_70px_repeat(4,100px)] items-center border-b border-border px-3 text-[13px] hover:bg-background-100/70">
      <div className="min-w-0 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <CircleNotch className="size-4 animate-spin text-primary/60" />
          ) : scan.status === "completed" ? (
            <CheckCircle weight="fill" className="size-4 text-emerald-500" />
          ) : (
            <WarningCircle weight="fill" className="size-4 text-red-500" />
          )}
          <span className="text-sm font-medium text-primary">
            {running
              ? "Auditing your inbox…"
              : scan.status === "completed"
                ? "Audit complete"
                : "Audit failed"}
          </span>
          <span className="ml-auto hidden text-xs text-primary/40 sm:inline">
            {relativeTime(scan.completedAt ?? scan.startedAt)}
          </span>
        </div>
        {scan.error ? (
          <p className="mt-1 truncate text-[12px] text-primary/45" title={scan.error}>
            {scan.error}
          </p>
        ) : null}
      </div>
      <Badge variant="outline" className="w-fit rounded-[2px] font-normal">
        {scan.lookbackDays}d
      </Badge>
      <Stat value={scan.threadsSeen} />
      <Stat value={scan.candidatesSeen} />
      <Stat value={scan.actionsCreated} />
      <Stat value={scan.relationshipsCreated} />
    </li>
  );
}

function Stat({ value }: { value?: number }) {
  return <span className="tabular-nums text-primary/65">{value ?? 0}</span>;
}
