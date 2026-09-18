"use client";

import "client-only";

import { Badge } from "@sim/emcn";
import { Building } from "@sim/emcn/icons";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { SimProductPanel } from "@/components/features/sim-product/sim-product-frame";
import type { RelationshipCommitment } from "@/types/revenue";

export type AccountTimelineItem = {
  id: string;
  label: string;
  detail: string;
  statusLabel: string;
  statusVariant: "green" | "amber" | "red";
};

export type AccountMissionControlSurfaceProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "children"
> & {
  accountName: string;
  attentionLabel?: string;
  attentionVariant?: "green" | "amber" | "red";
  items: AccountTimelineItem[];
  emptyMessage?: string;
  showHeader?: boolean;
};

function commitmentLabel(direction: string) {
  if (direction === "promised_by_me") return "Outbound promise";
  if (direction === "promised_by_them") return "Inbound promise";
  return "Commitment";
}

function commitmentStatus(commitment: RelationshipCommitment): {
  label: string;
  variant: AccountTimelineItem["statusVariant"];
} {
  if (["met", "fulfilled", "waived"].includes(commitment.status)) {
    return { label: "Kept", variant: "green" };
  }
  if (["at_risk", "missed", "disputed"].includes(commitment.status)) {
    return { label: "At risk", variant: "red" };
  }
  if (commitment.acceptance === "candidate") {
    return { label: "Review", variant: "amber" };
  }
  return { label: "Open", variant: "amber" };
}

/** Maps live register rows into the Sim account timeline rows. */
export function mapCommitmentsToAccountTimeline(
  commitments: RelationshipCommitment[],
  limit = 5,
): AccountTimelineItem[] {
  return commitments.slice(0, limit).map((commitment) => {
    const status = commitmentStatus(commitment);
    return {
      id: commitment.id,
      label: commitmentLabel(commitment.direction),
      detail: commitment.text,
      statusLabel: status.label,
      statusVariant: status.variant,
    };
  });
}

export function accountAttentionFromHealth(health?: string) {
  if (health === "critical" || health === "needs_attention") {
    return { label: "Needs you", variant: "amber" as const };
  }
  if (health === "healthy") {
    return { label: "Stable", variant: "green" as const };
  }
  return undefined;
}

/** Single-account mission control in the Sim AccountMenuPreview shape. */
export function AccountMissionControlSurface({
  accountName,
  attentionLabel,
  attentionVariant = "amber",
  className,
  emptyMessage = "No commitments recorded for this account yet.",
  items,
  showHeader = true,
  ...props
}: AccountMissionControlSurfaceProps) {
  return (
    <section
      aria-labelledby={showHeader ? "account-mission-control-heading" : undefined}
      className={cn("min-w-0", className)}
      data-capability="mission-control"
      data-slot="account-mission-control-surface"
      {...props}
    >
      <SimProductPanel className="max-w-[480px]">
        {showHeader ? (
          <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
            <Building className="size-[14px] text-[var(--text-icon)]" />
            <h2
              className="truncate text-[var(--text-primary)]"
              id="account-mission-control-heading"
            >
              {accountName}
            </h2>
            {attentionLabel ? (
              <Badge className="ml-auto shrink-0" variant={attentionVariant}>
                {attentionLabel}
              </Badge>
            ) : null}
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--text-secondary)]">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                className="flex flex-col gap-0.5 border-[var(--border)] border-b px-4 py-3 last:border-b-0"
                key={item.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)] text-xs uppercase tracking-[0.06em]">
                    {item.label}
                  </span>
                  <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
                </div>
                <span className="text-[var(--text-primary)]">{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </SimProductPanel>
    </section>
  );
}
