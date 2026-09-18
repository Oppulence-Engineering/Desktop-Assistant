"use client";

import "client-only";

import { Button, Chip } from "@sim/emcn";
import { Mail } from "@sim/emcn/icons";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@oppulence/ui/lib/utils";
import { SimProductPanel } from "@/components/features/sim-product/sim-product-frame";

export type GovernedActionSurfaceProps = Omit<ComponentPropsWithoutRef<"section">, "children"> & {
  title?: string;
  heldLabel?: string;
  message: string;
  sourceLine?: string;
  readOnly?: boolean;
  onMessageChange?: (value: string) => void;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  footer?: ReactNode;
};

/** Follow-up draft held at approve — matches marketing GovernMenuPreview. */
export function GovernedActionSurface({
  className,
  footer,
  heldLabel = "Held",
  message,
  onMessageChange,
  primaryAction,
  readOnly = false,
  secondaryAction,
  sourceLine,
  title = "Follow-up draft",
  ...props
}: GovernedActionSurfaceProps) {
  const editable = Boolean(onMessageChange) && !readOnly;

  return (
    <section
      aria-labelledby="governed-action-heading"
      className={cn("min-w-0", className)}
      data-capability="governed-actions"
      data-slot="governed-action-surface"
      {...props}
    >
      <SimProductPanel className="max-w-[420px]">
        <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
          <Mail className="size-[14px] text-[var(--text-icon)]" />
          <h2 className="truncate text-[var(--text-primary)]" id="governed-action-heading">
            {title}
          </h2>
          <Chip className="ml-auto shrink-0">{heldLabel}</Chip>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {editable ? (
            <textarea
              aria-label="Draft message"
              className="min-h-[120px] w-full resize-y rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text-primary)] text-sm leading-[1.45] outline-none focus:border-[var(--text-primary)]"
              onChange={(event) => onMessageChange?.(event.target.value)}
              value={message}
            />
          ) : (
            <p className="whitespace-pre-wrap text-[var(--text-primary)] leading-[1.45]">
              {message}
            </p>
          )}
          {sourceLine ? <p className="text-[var(--text-muted)] text-xs">{sourceLine}</p> : null}
          {primaryAction || secondaryAction ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {primaryAction}
              {secondaryAction}
            </div>
          ) : null}
          {footer}
        </div>
      </SimProductPanel>
    </section>
  );
}

export type GovernedActionSurfaceButtonProps = ComponentPropsWithoutRef<typeof Button>;

/** Primary approve action styled like the marketing preview. */
export function GovernedActionPrimaryButton(props: GovernedActionSurfaceButtonProps) {
  return <Button size="sm" variant="primary" {...props} />;
}

/** Secondary edit action styled like the marketing preview. */
export function GovernedActionSecondaryButton(props: GovernedActionSurfaceButtonProps) {
  return <Button size="sm" variant="outline" {...props} />;
}
