"use client";

import * as React from "react";
import { CheckCircle, EnvelopeSimple, PaperPlaneTilt, Prohibit, WarningCircle } from "@/lib/icons";

import { Badge } from "@oppulence/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@oppulence/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@oppulence/ui/components/empty";
import { Label } from "@oppulence/ui/components/label";
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
    <Badge className="gap-1 text-primary/60" variant="outline">
      {mode === "send" ? <PaperPlaneTilt weight="fill" /> : <EnvelopeSimple weight="fill" />}
      {mode === "send" ? "Send" : "Draft"}
    </Badge>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-primary/45">{label}</Label>
      {children}
    </div>
  );
}

export function PriorityBreakdown({ action }: { action: RevenueAction }) {
  const components = action.priorityComponents;
  if (!components || Object.keys(components).length === 0) return null;
  const entries = Object.entries(components).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <Card className="gap-3 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm font-medium text-primary">
          Why this ranks {action.priorityScore}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        <ul className="flex flex-col gap-1">
          {entries.map(([key, value]) => (
            <li key={key} className="flex items-center justify-between text-xs">
              <Label className="font-normal text-primary/60">
                {PRIORITY_COMPONENT_LABELS[key] ?? key}
              </Label>
              <Badge
                className={cn(
                  "tabular-nums font-normal",
                  value < 0 ? "text-red-500" : "text-primary/70",
                )}
                variant="secondary"
              >
                {value > 0 ? "+" : ""}
                {value}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Card className="flex-row gap-4 py-4" key={i}>
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </Card>
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
    <Empty className="min-h-[70vh] flex-1 border-0 py-16">
      <EmptyHeader>
        <EmptyMedia className="text-primary/35" variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyTitle className="text-base text-primary">{title}</EmptyTitle>
        {body ? (
          <EmptyDescription className="mx-auto max-w-sm text-primary/60">{body}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
