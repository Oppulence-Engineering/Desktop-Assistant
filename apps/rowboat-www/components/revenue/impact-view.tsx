"use client";

import * as React from "react";
import { ChartLineUp, EnvelopeSimple, WarningDiamond } from "@phosphor-icons/react";

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

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col gap-6">
      <section className="border border-border" data-capability="relationship-impact">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-oppulence-orange">
              Relationship exposure
            </p>
            <h2 className="mt-1 text-base font-semibold text-primary">
              What missed communication is putting at risk now
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-primary/50">
              The score is deterministic: each account contributes its highest open risk rank,
              divided across the active portfolio. No invented contract or pipeline value.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-primary/50">
            <WarningDiamond className="size-4 text-amber-500" /> Updated from live account state
          </div>
        </div>
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
                    <span className="text-primary/60">
                      {DETECTOR_LABELS[risk.reason] ?? risk.reason.replaceAll("_", " ")}
                    </span>
                    <span className="tabular-nums text-primary/80">{risk.relationships}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-primary/40">No active relationship risks.</p>
            )}
          </div>
        </div>
      </section>

      {/* weekly digest preview — the same summary the email is built from */}
      {digest?.top?.length ? (
        <section className="rounded-none border border-border p-4">
          <div className="mb-2 flex items-center gap-2">
            <EnvelopeSimple weight="fill" className="size-4 text-primary/55" />
            <span className="text-sm font-medium text-primary">Your weekly digest</span>
            <span className="text-xs text-primary/45">emailed while you have open loops</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {digest.top!.slice(0, 3).map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-primary/75">
                  <span className="text-primary/45">{a.detector}:</span> {a.reason}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-primary/40">{a.priority}</span>
              </li>
            ))}
          </ul>
          {digest.openCount > 3 ? (
            <p className="mt-2 text-xs text-primary/45">
              +{digest.openCount - 3} more in your queue
            </p>
          ) : null}
        </section>
      ) : null}

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open loops surfaced" value={data.surfaced} />
        <Stat label="Drafted / sent" value={data.executed} />
        <Stat label="Reply rate" value={pct(data.replyRate)} tone="good" />
        <Stat label="Meetings booked" value={data.meetingsBooked} tone="good" />
      </div>

      {/* funnel */}
      <section className="rounded-none border border-border p-4">
        <h3 className="mb-3 text-sm font-medium text-primary">From surfaced to booked</h3>
        <ul className="flex flex-col gap-2">
          {funnel.map((f) => (
            <li key={f.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-primary/55">{f.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-none bg-background-100 dark:bg-background-100/50">
                <div
                  className="h-full rounded-none bg-oppulence-orange/70"
                  style={{ width: `${Math.max(2, (f.value / maxFunnel) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-primary">
                {f.value}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* triage split + wins */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-none border border-border p-4">
          <h3 className="mb-3 text-sm font-medium text-primary">Triage</h3>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Line label="Open" value={data.open} />
            <Line label="Handled" value={data.handled} />
            <Line label="Snoozed" value={data.snoozed} />
            <Line label="Dismissed" value={data.dismissed} />
          </dl>
        </section>
        <section className="rounded-none border border-border p-4">
          <h3 className="mb-3 text-sm font-medium text-primary">Outcomes</h3>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Line label="Replied" value={data.replied} />
            <Line label="Meetings booked" value={data.meetingsBooked} />
            <Line label="Won" value={data.won} tone="good" />
            <Line label="Lost" value={data.lost} />
          </dl>
        </section>
      </div>

      {/* per-detector */}
      {data.byDetector?.length ? (
        <section className="rounded-none border border-border p-4">
          <h3 className="mb-3 text-sm font-medium text-primary">Which signals pay off</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-primary/45">
                <th className="pb-2 font-normal">Detector</th>
                <th className="pb-2 text-right font-normal">Surfaced</th>
                <th className="pb-2 text-right font-normal">Handled</th>
                <th className="pb-2 text-right font-normal">Handled %</th>
              </tr>
            </thead>
            <tbody>
              {[...data.byDetector]
                .sort((a, b) => b.surfaced - a.surfaced)
                .map((d) => (
                  <tr key={d.detector} className="border-t border-primary/10">
                    <td className="py-1.5 text-primary/80">
                      {DETECTOR_LABELS[d.detector] ?? d.detector}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-primary/70">{d.surfaced}</td>
                    <td className="py-1.5 text-right tabular-nums text-primary/70">{d.handled}</td>
                    <td className="py-1.5 text-right tabular-nums text-primary/55">
                      {d.surfaced > 0 ? `${Math.round((d.handled / d.surfaced) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "good" }) {
  return (
    <div className="p-3">
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-primary",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-primary/55">{label}</div>
    </div>
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
      <dt className="text-primary/55">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          tone === "good" && value > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-primary/80",
        )}
      >
        {value}
        {suffix}
      </dd>
    </div>
  );
}
