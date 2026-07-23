"use client";

import * as React from "react";
import { ChartLineUp } from "@phosphor-icons/react";

import { DETECTOR_LABELS, getImpact } from "@/lib/revenue";
import { EmptyBlock, errMessage, ListSkeleton } from "@/components/revenue/shared";
import { cn } from "@/lib/utils";
import type { RevenueImpact } from "@/types/revenue";

export function ImpactView({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = React.useState<RevenueImpact | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void getImpact()
      .then(setData)
      .catch((e) => onError(errMessage(e, "Could not load impact.")))
      .finally(() => setLoading(false));
  }, [onError]);

  if (loading) return <ListSkeleton rows={2} />;
  if (!data) return null;

  if (data.surfaced === 0) {
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
    <div className="flex flex-col gap-6">
      {/* headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open loops surfaced" value={data.surfaced} />
        <Stat label="Drafted / sent" value={data.executed} />
        <Stat label="Reply rate" value={pct(data.replyRate)} tone="good" />
        <Stat label="Meetings booked" value={data.meetingsBooked} tone="good" />
      </div>

      {/* funnel */}
      <section className="rounded-[2px] border border-border p-4">
        <h3 className="mb-3 text-sm font-medium text-primary">From surfaced to booked</h3>
        <ul className="flex flex-col gap-2">
          {funnel.map((f) => (
            <li key={f.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-primary/55">{f.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-[2px] bg-background-100 dark:bg-background-100/50">
                <div
                  className="h-full rounded-[2px] bg-oppulence-orange/70"
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
        <section className="rounded-[2px] border border-border p-4">
          <h3 className="mb-3 text-sm font-medium text-primary">Triage</h3>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Line label="Open" value={data.open} />
            <Line label="Handled" value={data.handled} />
            <Line label="Snoozed" value={data.snoozed} />
            <Line label="Dismissed" value={data.dismissed} />
          </dl>
        </section>
        <section className="rounded-[2px] border border-border p-4">
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
      {data.byDetector.length > 0 ? (
        <section className="rounded-[2px] border border-border p-4">
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
    <div className="rounded-[2px] border border-border p-3">
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

function Line({ label, value, tone }: { label: string; value: number; tone?: "good" }) {
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
      </dd>
    </div>
  );
}
