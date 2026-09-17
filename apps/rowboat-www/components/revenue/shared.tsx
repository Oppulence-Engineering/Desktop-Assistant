"use client";

import * as React from "react";
import Image from "next/image";
import {
  CheckCircle,
  EnvelopeSimple,
  PaperPlaneTilt,
  Prohibit,
  SquaresFour,
  WarningCircle,
} from "@/lib/icons";

import { Avatar, AvatarFallback } from "@oppulence/ui/components/avatar";
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

export type WorkspaceLearnMoreItem = {
  label: string;
};

const DEFAULT_LEARN_MORE: WorkspaceLearnMoreItem[] = [
  { label: "Notes, Tasks, and Email sending" },
  { label: "Introduction to tasks" },
];

type WorkspaceEmptyImageSet = {
  light: string;
  dark: string;
};

const emptyImage = (name: string): WorkspaceEmptyImageSet => ({
  light: `/marketing/relationship-system/${name}-empty-light-v2.png`,
  dark: `/marketing/relationship-system/${name}-empty-v2.png`,
});

/** Hero illustrations for workspace empty states (commitment-queue style). */
export const workspaceEmptyImages = {
  actions: emptyImage("actions"),
  agents: emptyImage("agents"),
  audits: emptyImage("audits"),
  commitments: {
    light: "/marketing/relationship-system/commitment-queue-empty-light-v2.png",
    dark: "/marketing/relationship-system/commitment-queue-empty-v2.png",
  },
  companies: emptyImage("companies"),
  impact: emptyImage("impact"),
  notes: emptyImage("notes"),
  openPromises: emptyImage("open-promises"),
  people: emptyImage("people"),
  recovery: emptyImage("recovery"),
  sources: emptyImage("sources"),
  tasks: emptyImage("tasks"),
  workflows: emptyImage("workflows"),
} as const satisfies Record<string, WorkspaceEmptyImageSet>;

export type WorkspaceEmptyImageKey = keyof typeof workspaceEmptyImages;

const EMPTY_ILLUSTRATION_CLASS = "mb-4 h-[150px] w-[225px] object-cover opacity-90";

/** Theme-aware hero art: light illustration in light mode, dark in dark mode. */
export function WorkspaceEmptyIllustration({ image }: { image: WorkspaceEmptyImageKey }) {
  const set = workspaceEmptyImages[image];
  return (
    <>
      <Image
        alt=""
        aria-hidden="true"
        className={cn(EMPTY_ILLUSTRATION_CLASS, "dark:hidden")}
        height={160}
        priority
        src={set.light}
        width={240}
      />
      <Image
        alt=""
        aria-hidden="true"
        className={cn(EMPTY_ILLUSTRATION_CLASS, "hidden dark:block")}
        height={160}
        priority
        src={set.dark}
        width={240}
      />
    </>
  );
}

/** Tasks-style empty canvas shared across workspace revenue surfaces. */
export function WorkspaceEmptyState({
  image,
  icon,
  title,
  description,
  action,
  learnMore = DEFAULT_LEARN_MORE,
}: {
  image?: WorkspaceEmptyImageKey;
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  learnMore?: WorkspaceLearnMoreItem[];
}) {
  const illustrated = Boolean(image);

  return (
    <div
      className={cn(
        "flex min-h-[520px] flex-1 flex-col text-center",
        illustrated ? "items-center px-6 pt-[84px]" : "justify-between px-16 py-14",
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center",
          illustrated ? "w-full" : "flex flex-1 flex-col justify-center",
        )}
      >
        {image ? (
          <WorkspaceEmptyIllustration image={image} />
        ) : icon ? (
          <div className="relative flex size-48 items-center justify-center border-x border-dashed border-border/60 before:absolute before:inset-x-[-30px] before:top-1/2 before:border-t before:border-dashed before:border-border/60">
            {icon}
          </div>
        ) : null}
        <h2
          className={cn(
            "font-semibold text-primary",
            illustrated ? "text-[20px] leading-6" : "mt-4 text-[22px]",
          )}
        >
          {title}
        </h2>
        <p
          className={cn(
            "max-w-md",
            illustrated
              ? "mt-2 text-sm leading-6 text-primary/55"
              : "mt-1 max-w-sm text-[14px] leading-5 text-primary/50",
          )}
        >
          {description}
        </p>
        {action ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>
        ) : null}
      </div>
      {learnMore.length > 0 ? (
        <div className={cn("w-full", illustrated ? "mb-4 mt-auto max-w-[640px] text-left" : "")}>
          <p className={cn("text-[12px] text-primary/45", illustrated ? "mb-2" : "mb-3")}>
            Learn more
          </p>
          <div className={cn("grid gap-2 sm:grid-cols-2", !illustrated && "grid-cols-2 gap-3")}>
            {learnMore.map((item) => (
              <div
                className={cn(
                  "flex items-center gap-4 text-[13px] text-primary",
                  illustrated
                    ? "h-[72px] justify-start border border-border bg-background-50 px-3 text-primary/80"
                    : "h-20 border border-border px-4",
                )}
                key={item.label}
              >
                <Avatar className={cn("rounded-none", illustrated ? "size-10" : "size-12")}>
                  <AvatarFallback className="rounded-none border border-border bg-background text-primary/45">
                    <SquaresFour className={illustrated ? "size-4" : "size-6"} />
                  </AvatarFallback>
                </Avatar>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyBlock({
  image,
  icon,
  title,
  body,
  children,
  learnMore,
}: {
  image?: WorkspaceEmptyImageKey;
  icon?: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
  learnMore?: WorkspaceLearnMoreItem[];
}) {
  return (
    <WorkspaceEmptyState
      action={children}
      description={body ?? ""}
      icon={icon}
      image={image}
      learnMore={learnMore}
      title={title}
    />
  );
}

export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
