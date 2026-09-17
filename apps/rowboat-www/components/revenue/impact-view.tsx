"use client";

import * as React from "react";
import { ChartLineUp, EnvelopeSimple, WarningDiamond } from "@/lib/icons";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Badge } from "@oppulence/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@oppulence/ui/components/card";
import { Label } from "@oppulence/ui/components/label";
import { Progress } from "@oppulence/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@oppulence/ui/components/table";

import { DETECTOR_LABELS, getDigest, getImpact } from "@/lib/revenue";
import { EmptyBlock, errMessage, ListSkeleton } from "@/components/revenue/shared";
import { cn } from "@/lib/utils";
import type { RevenueDigest, RevenueImpact } from "@/types/revenue";

export function ImpactView({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = React.useState<RevenueImpact | null>(null);
  const [digest, setDigest] = React.useState<RevenueDigest | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void Promise.all([getImpact(), getDigest().catch(() => null)])
      .then(([imp, dg]) => {
        setData(imp);
        setDigest(dg);
      })
      .catch((e) => onError(errMessage(e, "Could not load impact.")))
      .finally(() => setLoading(false));
  }, [onError]);

  if (loading) return <ListSkeleton rows={2} />;
  if (!data) return null;

  if (data.surfaced === 0 && data.atRiskRelationships === 0 && data.overdueCommitments === 0) {
    return (
      <EmptyBlock
        icon={<ChartLineUp className="size-6" />}
        title="No impact to show yet"
        body="Run a scan and start reviewing actions — results (replies, meetings, wins) show up here as they come in."
      />
    );
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const funnel = [
    { label: "Surfaced", value: data.surfaced },
    { label: "Approved", value: data.approved },
    { label: "Drafted / sent", value: data.executed },
    { label: "Replied", value: data.replied },
    { label: "Meetings", value: data.meetingsBooked },
  ];
  const maxFunnel = Math.max(...funnel.map((f) => f.value), 1);

  // "source_degradation" means we stopped receiving evidence. It is the only
  // risk reason that is about our own plumbing rather than the relationship.
  const degradedCount =
    data.riskReasons?.find((risk) => risk.reason === "source_degradation")?.relationships ?? 0;
  const sourceDegradationDominates =
    degradedCount > 0 && degradedCount >= Math.max(1, data.atRiskRelationships);

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col gap-6">
      <Card className="gap-0 py-0" data-capability="relationship-impact">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
          <div>
            <Badge className="font-mono text-[10px] uppercase tracking-wider" variant="outline">
              Relationship exposure
            </Badge>
            <CardTitle className="mt-1 text-base text-primary">
              What missed communication is putting at risk now
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-xs text-primary/50">
              The score is deterministic: each account contributes its highest open risk rank,
              divided across the active portfolio. No invented contract or pipeline value.
            </CardDescription>
          </div>
          <Badge className="gap-2 font-normal text-primary/50" variant="secondary">
            <WarningDiamond className="size-4 text-amber-500" /> Updated from live account state
          </Badge>
        </CardHeader>
        {/* Exposure caused by a broken source is a statement about us, not
            about the customer's accounts. Rendered as portfolio risk it reads
            as "your business is on fire" when the truth is "we cannot see your
            mail" — so when degradation drives most of the exposure, that is
            said first, before any score. */}
        {sourceDegradationDominates ? (
          <Alert className="rounded-none border-x-0 border-t border-amber-500/40 bg-amber-500/[0.06]">
            <WarningDiamond className="size-4 text-amber-500" />
            <AlertTitle className="text-[13px] text-primary">
              This score reflects missing data, not account behaviour.
            </AlertTitle>
            <AlertDescription className="text-[13px] text-primary/60">
              {degradedCount} of {data.relationships} accounts are exposed because a connected
              source stopped reporting. Reconnect it before reading these numbers as risk.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-4 md:divide-y-0">
          <Stat label="Portfolio risk score" value={`${data.portfolioRiskScore}/100`} />
          <Stat
            label={`At-risk accounts of ${data.relationships}`}
            value={data.atRiskRelationships}
          />
          <Stat label="Critical accounts" value={data.criticalRelationships} />
          <Stat label="Overdue promises" value={data.overdueCommitments} />
        </div>
        <div className="grid border-t border-border md:grid-cols-[1fr_1fr] md:divide-x md:divide-border">
          <dl className="space-y-2 p-4 text-sm">
            <Line label="Promises missed by us" value={data.overdueByUs} />
            <Line label="Promises missed by them" value={data.overdueByThem} />
            <Line label="Longest overdue" value={data.longestOverdueDays} suffix=" days" />
          </dl>
          <div className="border-t border-border p-4 md:border-t-0">
            <p className="mb-2 text-xs font-medium text-primary/55">Why accounts are exposed</p>
            {data.riskReasons?.length ? (
              <ul className="space-y-1.5 text-sm">
                {data.riskReasons!.slice(0, 5).map((risk) => (
                  <li className="flex items-center justify-between gap-3" key={risk.reason}>
                    <Label className="font-normal text-primary/60">
                      {DETECTOR_LABELS[risk.reason] ?? risk.reason.replaceAll("_", " ")}
                    </Label>
                    <Badge
                      className="rounded-none tabular-nums font-normal text-primary/80"
                      variant="outline"
                    >
                      {risk.relationships}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-primary/40">No active relationship risks.</p>
            )}
          </div>
        </div>
      </Card>

      {/* weekly digest preview — the same summary the email is built from */}
      {digest?.top?.length ? (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <div className="flex items-center gap-2">
              <EnvelopeSimple weight="fill" className="size-4 text-primary/55" />
              <CardTitle className="text-sm text-primary">Your weekly digest</CardTitle>
              <Badge className="font-normal text-primary/45" variant="secondary">
                emailed while you have open loops
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4">
            <ul className="flex flex-col gap-1.5">
              {digest.top!.slice(0, 3).map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <Label className="truncate font-normal text-primary/75">
                    <Badge className="mr-1 font-normal text-primary/45" variant="outline">
                      {a.detector}
                    </Badge>
                    {a.reason}
                  </Label>
                  <Badge
                    className="shrink-0 tabular-nums font-normal text-primary/40"
                    variant="secondary"
                  >
                    {a.priority}
                  </Badge>
                </li>
              ))}
            </ul>
            {digest.openCount > 3 ? (
              <CardDescription className="mt-2 text-xs text-primary/45">
                +{digest.openCount - 3} more in your queue
              </CardDescription>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open loops surfaced" value={data.surfaced} />
        <Stat label="Drafted / sent" value={data.executed} />
        <Stat label="Reply rate" value={pct(data.replyRate)} tone="good" />
        <Stat label="Meetings booked" value={data.meetingsBooked} tone="good" />
      </div>

      {/* funnel */}
      <Card className="gap-3 py-4">
        <CardHeader className="px-4 pb-0">
          <CardTitle className="text-sm text-primary">From surfaced to booked</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <ul className="flex flex-col gap-2">
            {funnel.map((f) => (
              <li key={f.label} className="flex items-center gap-3">
                <Label className="w-28 shrink-0 text-xs font-normal text-primary/55">
                  {f.label}
                </Label>
                <Progress
                  className="h-5 flex-1 rounded-none bg-background-100 dark:bg-background-100/50 [&>[data-slot=progress-indicator]]:bg-oppulence-orange/70"
                  value={Math.max(2, (f.value / maxFunnel) * 100)}
                />
                <Badge
                  className="w-8 shrink-0 justify-center tabular-nums font-medium text-primary"
                  variant="secondary"
                >
                  {f.value}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* triage split + wins */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-sm text-primary">Triage</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Line label="Open" value={data.open} />
              <Line label="Handled" value={data.handled} />
              <Line label="Snoozed" value={data.snoozed} />
              <Line label="Dismissed" value={data.dismissed} />
            </dl>
          </CardContent>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-sm text-primary">Outcomes</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Line label="Replied" value={data.replied} />
              <Line label="Meetings booked" value={data.meetingsBooked} />
              <Line label="Won" value={data.won} tone="good" />
              <Line label="Lost" value={data.lost} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* per-detector */}
      {data.byDetector?.length ? (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-sm text-primary">Which signals pay off</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <Table>
              <TableHeader>
                <TableRow className="text-xs text-primary/45 hover:bg-transparent">
                  <TableHead className="font-normal">Detector</TableHead>
                  <TableHead className="text-right font-normal">Surfaced</TableHead>
                  <TableHead className="text-right font-normal">Handled</TableHead>
                  <TableHead className="text-right font-normal">Handled %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.byDetector]
                  .sort((a, b) => b.surfaced - a.surfaced)
                  .map((d) => (
                    <TableRow key={d.detector}>
                      <TableCell className="text-primary/80">
                        {DETECTOR_LABELS[d.detector] ?? d.detector}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-primary/70">
                        {d.surfaced}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-primary/70">
                        {d.handled}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-primary/55">
                        {d.surfaced > 0 ? `${Math.round((d.handled / d.surfaced) * 100)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "good" }) {
  return (
    <CardContent className="p-3">
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-primary",
        )}
      >
        {value}
      </div>
      <Label className="mt-0.5 text-xs font-normal text-primary/55">{label}</Label>
    </CardContent>
  );
}

function Line({
  label,
  value,
  tone,
  suffix = "",
}: {
  label: string;
  value: number;
  tone?: "good";
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label asChild className="font-normal text-primary/55">
        <dt>{label}</dt>
      </Label>
      <Badge
        asChild
        className={cn(
          "tabular-nums font-normal",
          tone === "good" && value > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-primary/80",
        )}
        variant="secondary"
      >
        <dd>
          {value}
          {suffix}
        </dd>
      </Badge>
    </div>
  );
}
