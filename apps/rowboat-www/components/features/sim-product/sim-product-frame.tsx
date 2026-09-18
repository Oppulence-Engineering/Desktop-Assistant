"use client";

import "client-only";

import type { ComponentType, ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@oppulence/ui/lib/utils";

export type SimProductPanelProps = ComponentPropsWithoutRef<"div">;

/** Full-width Sim surface card used inside the authenticated product shell. */
export function SimProductPanel({ className, ...props }: SimProductPanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-sm shadow-xs",
        className,
      )}
      data-slot="sim-product-panel"
      {...props}
    />
  );
}

export type SimProductHeaderProps = {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  actions?: ReactNode;
  size?: "default" | "table";
  className?: string;
};

/** Title row for product tables and panels — mirrors marketing MenuPreviewHeader. */
export function SimProductHeader({
  icon: Icon,
  title,
  actions,
  size = "default",
  className,
}: SimProductHeaderProps) {
  return (
    <div
      className={cn(
        "shrink-0 border-[var(--border)] border-b",
        size === "table" ? "box-content h-10" : "h-11",
        className,
      )}
      data-slot="sim-product-header"
    >
      <div className="flex size-full items-center gap-2 px-4">
        {Icon ? <Icon className="size-[14px] shrink-0 text-[var(--text-icon)]" /> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-[var(--text-primary)] text-base">
          {title}
        </div>
        {actions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1 text-[var(--text-secondary)] text-sm">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type SimProductToolbarProps = ComponentPropsWithoutRef<"div">;

/** Chip/filter row under the header — same height and inset as marketing previews. */
export function SimProductToolbar({ className, children, ...props }: SimProductToolbarProps) {
  return (
    <div
      className={cn("h-[38px] shrink-0 border-[var(--border)] border-b", className)}
      data-slot="sim-product-toolbar"
      {...props}
    >
      <div className="flex size-full flex-wrap items-center gap-1 px-2 text-sm">{children}</div>
    </div>
  );
}
