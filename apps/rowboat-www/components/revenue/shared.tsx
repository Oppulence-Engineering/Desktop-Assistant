"use client";

import * as React from "react";
import {
  CheckCircle,
  EnvelopeSimple,
  PaperPlaneTilt,
  Prohibit,
  WarningCircle,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Skeleton } from "@oppulence/ui/components/skeleton";
import { cn } from "@/lib/utils";
import { PRIORITY_COMPONENT_LABELS } from "@/lib/revenue";
import type { RevenueAction } from "@/types/revenue";

export function priorityTone(score: number): { label: string; className: string } {
  if (score >= 70) return { label: "High", className: "text-red-600 dark:text-red-400" };
  if (score >= 40) return { label: "Medium", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Low", className: "text-primary/50" };
}

export function PolicyBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: "secondary" | "outline" | "destructive"; icon?: React.ReactNode }
  > = {
    passed: { label: "Cleared", variant: "outline", icon: <CheckCircle weight="fill" /> },
    review_required: {
      label: "Review required",
      variant: "secondary",
      icon: <WarningCircle weight="fill" />,
    },
    blocked: { label: "Blocked", variant: "destructive", icon: <Prohibit weight="fill" /> },
    stale: { label: "Re-check needed", variant: "secondary" },
    pending: { label: "Not checked", variant: "outline" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={m.variant} className="gap-1">
      {m.icon}
      {m.label}
    </Badge>
  );
}

export function ExecutionBadge({ action }: { action: RevenueAction }) {
  const { executionStatus: s, executionMode } = action;
  if (s === "sent") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle weight="fill" />
        {executionMode === "draft" ? "Drafted" : "Sent"}
      </Badge>
    );
  }
  if (s === "ambiguous")
    return (
      <Badge variant="secondary" className="gap-1">
        <WarningCircle weight="fill" /> Needs reconcile
      </Badge>
    );
  if (s === "requested") return <Badge variant="secondary">Sending…</Badge>;
  if (s === "failed") return <Badge variant="destructive">Failed</Badge>;
  return null;
}

export function ModeChip({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-primary/60">
      {mode === "send" ? <PaperPlaneTilt weight="fill" /> : <EnvelopeSimple weight="fill" />}
      {mode === "send" ? "Send" : "Draft"}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-primary/45">{label}</label>
      {children}
    </div>
  );
}

export function PriorityBreakdown({ action }: { action: RevenueAction }) {
  const components = action.priorityComponents;
  if (!components || Object.keys(components).length === 0) return null;
  const entries = Object.entries(components).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <div className="rounded-[2px] border border-border p-3">
      <div className="mb-2 text-sm font-medium text-primary">
        Why this ranks {action.priorityScore}
      </div>
      <ul className="flex flex-col gap-1">
        {entries.map(([key, value]) => (
          <li key={key} className="flex items-center justify-between text-xs">
            <span className="text-primary/60">{PRIORITY_COMPONENT_LABELS[key] ?? key}</span>
            <span className={cn("tabular-nums", value < 0 ? "text-red-500" : "text-primary/70")}>
              {value > 0 ? "+" : ""}
              {value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-[2px] border border-border p-4">
          <Skeleton className="size-10 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyBlock({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2px] border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-background-200 text-primary/50 dark:bg-background-100">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-medium text-primary">{title}</h2>
        {body ? <p className="mx-auto mt-1 max-w-sm text-sm text-primary/60">{body}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
