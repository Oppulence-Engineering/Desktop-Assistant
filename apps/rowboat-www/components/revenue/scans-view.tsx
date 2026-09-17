"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle, MagnifyingGlass, Plugs, WarningCircle } from "@/lib/icons";

import { Badge } from "@oppulence/ui/components/badge";
import { Label } from "@oppulence/ui/components/label";
import { Button } from "@oppulence/ui/components/button";
import { Spinner } from "@oppulence/ui/components/spinner";
import { WorkspaceEmptyState } from "@/components/revenue/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@oppulence/ui/components/table";
import { relativeTime } from "@/lib/revenue";
import type { RevenueLeakScan } from "@/types/revenue";

export function ScansView({
  scans,
  activeScan,
  scanning,
  needsReconnect = false,
  onScan,
}: {
  scans: RevenueLeakScan[];
  activeScan: RevenueLeakScan | null;
  scanning: boolean;
  /** The audit can only fail until Google is reconnected; `onScan` opens the fix. */
  needsReconnect?: boolean;
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
          {needsReconnect ? <Plugs /> : scanning ? <Spinner /> : <MagnifyingGlass />}
          {needsReconnect ? "Reconnect Google" : scanning ? "Auditing…" : "Run Promise Leak Audit"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <WorkspaceEmptyState
          action={
            <Button
              className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
              disabled={scanning}
              onClick={onScan}
              size="sm"
            >
              {needsReconnect ? (
                <>
                  <Plugs /> Reconnect Google
                </>
              ) : (
                <>{scanning ? <Spinner /> : <MagnifyingGlass />} Run audit</>
              )}
            </Button>
          }
          description={
            <>
              No audits yet! Run your first audit
              <br />
              to build the commitment register.
            </>
          }
          image="audits"
          learnMore={[
            { label: "Promise Leak Audit explained" },
            { label: "How evidence becomes commitments" },
          ]}
          title="Audits"
        />
      ) : (
        <div className="min-w-0 flex-1 overflow-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="h-10 border-border px-3 text-[12px] text-primary/45 hover:bg-transparent">
                <TableHead className="h-10 min-w-[220px] px-3 text-primary/45">Audit</TableHead>
                <TableHead className="h-10 w-[70px] px-3 text-primary/45">Window</TableHead>
                <TableHead className="h-10 w-[100px] px-3 text-primary/45">Threads</TableHead>
                <TableHead className="h-10 w-[100px] px-3 text-primary/45">Candidates</TableHead>
                <TableHead className="h-10 w-[100px] px-3 text-primary/45">Drafts</TableHead>
                <TableHead className="h-10 w-[100px] px-3 text-primary/45">Relationships</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((scan) => (
                <ScanRow key={scan.id} scan={scan} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ScanRow({ scan }: { scan: RevenueLeakScan }) {
  const running = scan.status === "running" || scan.status === "pending";
  const title = running
    ? "Auditing your inbox…"
    : scan.status === "completed"
      ? "Audit complete"
      : "Audit failed";
  return (
    <TableRow className="min-h-11 border-border px-3 text-[13px] hover:bg-background-100/70">
      <TableCell className="min-w-[220px] px-3 py-2 align-middle whitespace-normal">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {running ? (
              <Spinner className="size-4 text-primary/60" />
            ) : scan.status === "completed" ? (
              <CheckCircle weight="fill" className="size-4 text-emerald-500" />
            ) : (
              <WarningCircle weight="fill" className="size-4 text-red-500" />
            )}
            {scan.status === "completed" ? (
              <Link
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={`/app/report?scan=${encodeURIComponent(scan.id)}`}
              >
                {title}
              </Link>
            ) : (
              <Label className="text-sm font-medium text-primary">{title}</Label>
            )}
            <Badge
              variant="secondary"
              className="ml-auto hidden font-normal text-primary/40 sm:inline-flex"
            >
              {relativeTime(scan.completedAt ?? scan.startedAt)}
            </Badge>
          </div>
          {scan.error ? (
            <p className="mt-1 truncate text-[12px] text-primary/45" title={scan.error}>
              {scan.error}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="w-[70px] px-3">
        <Badge variant="outline" className="w-fit rounded-[2px] font-normal">
          {scan.lookbackDays}d
        </Badge>
      </TableCell>
      <TableCell className="w-[100px] px-3 tabular-nums text-primary/65">
        {scan.threadsSeen ?? 0}
      </TableCell>
      <TableCell className="w-[100px] px-3 tabular-nums text-primary/65">
        {scan.candidatesSeen ?? 0}
      </TableCell>
      <TableCell className="w-[100px] px-3 tabular-nums text-primary/65">
        {scan.actionsCreated ?? 0}
      </TableCell>
      <TableCell className="w-[100px] px-3 tabular-nums text-primary/65">
        {scan.relationshipsCreated ?? 0}
      </TableCell>
    </TableRow>
  );
}
