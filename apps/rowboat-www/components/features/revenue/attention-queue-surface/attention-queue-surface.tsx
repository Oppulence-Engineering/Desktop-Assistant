"use client";

import "client-only";

import { relationshipLabel } from "@oppulence/relationship-contract";
import { Badge, Chip } from "@sim/emcn";
import { ChevronDown, Layout, ListFilter, TagIcon, TypeNumber, TypeText } from "@sim/emcn/icons";
import * as React from "react";
import { Check } from "@/lib/icons";

import { Button } from "@oppulence/ui/components/button";
import { Spinner } from "@oppulence/ui/components/spinner";
import { cn } from "@oppulence/ui/lib/utils";
import {
  SimProductHeader,
  SimProductPanel,
  SimProductToolbar,
} from "@/components/features/sim-product/sim-product-frame/sim-product-frame";
import { decideRelationshipAttention } from "@/lib/revenue/revenue";
import type { RelationshipAttentionItem } from "@/lib/revenue/types";

const COLUMNS = [
  { name: "Account", icon: TypeText },
  { name: "Health", icon: TagIcon },
  { name: "Score", icon: TypeNumber },
  { name: "Why now", icon: TypeText },
] as const;

function healthBadge(item: RelationshipAttentionItem) {
  if (item.urgencyBand === "critical" || item.urgencyBand === "high") {
    return { label: "At risk", variant: "red" as const };
  }
  if (item.urgencyBand === "normal") {
    return { label: "Watch", variant: "amber" as const };
  }
  return { label: "Stable", variant: "green" as const };
}

export type AttentionQueueSurfaceProps = Omit<
  React.ComponentPropsWithoutRef<"section">,
  "children"
> & {
  items: RelationshipAttentionItem[];
  loading?: boolean;
  onOpenRelationship: (relationshipId: string) => void;
  onChanged: () => void;
  onActionError: (message: string) => void;
};

/** Portfolio attention queue in the Sim ruled-table shape from marketing WebMenuPreview. */
export function AttentionQueueSurface({
  className,
  items,
  loading = false,
  onOpenRelationship,
  onChanged,
  onActionError,
  ...props
}: AttentionQueueSurfaceProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  React.useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const decide = async (
    item: RelationshipAttentionItem,
    decision: "acknowledge" | "snooze" | "dismiss",
  ) => {
    const reason =
      decision === "dismiss"
        ? window.prompt("Why should this attention item be dismissed?", "Not relevant right now")
        : decision === "acknowledge"
          ? "Reviewed from the portfolio attention queue."
          : "Snoozed from the portfolio attention queue.";
    if (reason === null || (decision === "dismiss" && !reason.trim())) return;
    setBusy(`${item.id}:${decision}`);
    try {
      await decideRelationshipAttention(item.id, {
        decision,
        reason,
        expectedVersion: item.version,
        snoozedUntil:
          decision === "snooze"
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : undefined,
      });
      onChanged();
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : "Could not update the attention item.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!loading && items.length === 0) return null;

  return (
    <section
      aria-labelledby="attention-queue-heading"
      className={cn("min-w-0", className)}
      data-capability="attention-queue"
      data-slot="attention-queue-surface"
      id="attention-queue"
      {...props}
    >
      <SimProductPanel>
        <SimProductHeader
          icon={Layout}
          title={
            <h2 className="text-base font-normal" id="attention-queue-heading">
              Attention queue
            </h2>
          }
          actions={loading ? "Loading…" : `${items.length} account${items.length === 1 ? "" : "s"}`}
        />
        <SimProductToolbar>
          <Chip rightIcon={ChevronDown}>Open items</Chip>
          <Chip leftIcon={ListFilter}>Filter</Chip>
        </SimProductToolbar>

        <div className="overflow-x-auto">
          <table
            aria-label="Attention queue"
            className="w-full min-w-[620px] table-fixed border-collapse text-left"
          >
            <colgroup>
              <col className="w-[180px]" />
              <col className="w-[100px]" />
              <col className="w-[90px]" />
              <col className="w-[250px]" />
            </colgroup>
            <thead>
              <tr className="h-[34px] border-[var(--border)] border-b">
                {COLUMNS.map(({ name, icon: Icon }) => (
                  <th
                    className="border-[var(--border)] border-r px-2.5 font-normal last:border-r-0"
                    key={name}
                    scope="col"
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-[14px] text-[var(--text-icon)]" />
                      {name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="h-[37px] border-[var(--border)] border-b">
                  <td className="px-2.5 text-[var(--text-secondary)]" colSpan={4}>
                    Loading attention queue…
                  </td>
                </tr>
              ) : (
                items.slice(0, 10).map((item, index) => {
                  const health = healthBadge(item);
                  const isSelected = selected?.id === item.id;
                  return (
                    <tr
                      className={cn(
                        "h-[37px] cursor-pointer border-[var(--border)] border-b transition-colors hover:bg-[var(--surface-hover)]",
                        (index === 0 || isSelected) && "bg-[var(--surface-3)]",
                      )}
                      key={item.id}
                      onClick={() => {
                        setSelectedId(item.id);
                        onOpenRelationship(item.relationshipId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(item.id);
                          onOpenRelationship(item.relationshipId);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td className="border-[var(--border)] border-r px-2.5 font-medium text-[var(--text-primary)]">
                        {item.relationshipName}
                      </td>
                      <td className="border-[var(--border)] border-r px-2.5">
                        <Badge variant={health.variant}>{health.label}</Badge>
                      </td>
                      <td className="border-[var(--border)] border-r px-2.5 tabular-nums">
                        {item.rankScore}
                      </td>
                      <td className="truncate px-2.5 text-[var(--text-secondary)]">
                        {item.explanation || relationshipLabel(item.reasonCode)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selected && !loading ? (
          <div className="flex flex-wrap items-center gap-2 border-[var(--border)] border-t px-3 py-2">
            <span className="mr-1 text-sm text-[var(--text-secondary)]">
              {selected.relationshipName}
            </span>
            <Button
              disabled={busy !== null}
              onClick={() => void decide(selected, "acknowledge")}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === `${selected.id}:acknowledge` ? <Spinner className="size-4" /> : <Check />}{" "}
              Review
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => void decide(selected, "snooze")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Snooze 1d
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => void decide(selected, "dismiss")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Dismiss
            </Button>
          </div>
        ) : null}
      </SimProductPanel>
    </section>
  );
}
