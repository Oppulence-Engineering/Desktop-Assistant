import * as React from "react";
import { Plus, Trash2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Shared settings design system. Every tab composes these so spacing, borders,
 * and typography stay consistent (the dialog previously reinvented the row/section
 * pattern per tab). The settings dialog is intentionally rounded (`.rowboat-settings`
 * re-rounds inside the portal), so these use soft borders + subtle surfaces.
 */

/** A titled group of settings. Stack multiple per tab; they self-space. */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("settings-section-block", className)}>
      {(title || action) && (
        <div className="settings-section-heading">
          <div className="min-w-0">
            {title && <h4 className="settings-section-title">{title}</h4>}
            {description && <p className="settings-section-description">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A single setting: label (+ optional description) on the left, control on the
 * right. Use `stacked` when the control is wide (textarea, full-width input).
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  stacked,
  children,
  className,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  stacked?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("settings-row settings-panel", stacked ? "!block space-y-2" : "", className)}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="settings-row-label block">
          {label}
        </label>
        {description && <p className="settings-row-description">{description}</p>}
      </div>
      <div className={cn(stacked ? "" : "shrink-0")}>{children}</div>
    </div>
  );
}

/** A stacked label + control + optional hint, for form fields. */
export function SettingsField({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Editable key→value pairs (MCP `env` / HTTP `headers`). Pure-functional: edits
 * produce a fresh `Record` via `onChange`.
 */
export function KeyValueRows({
  entries,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  addLabel = "Add variable",
  keyLabel = "Key",
  valueLabel = "Value",
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  keyLabel?: string;
  valueLabel?: string;
}) {
  // Keep insertion order stable across edits by working on entry tuples.
  const rows = React.useMemo(() => Object.entries(entries), [entries]);

  const commit = (next: [string, string][]) => {
    const obj: Record<string, string> = {};
    for (const [k, v] of next) if (k) obj[k] = v;
    onChange(obj);
  };

  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={k}
            placeholder={keyPlaceholder}
            className="h-8 flex-1 font-mono text-xs"
            aria-label={`${keyLabel} ${i + 1}`}
            onChange={(e) => {
              const next = [...rows] as [string, string][];
              next[i] = [e.target.value, v];
              commit(next);
            }}
          />
          <Input
            value={v}
            placeholder={valuePlaceholder}
            className="h-8 flex-1 font-mono text-xs"
            aria-label={`${valueLabel} ${i + 1}`}
            onChange={(e) => {
              const next = [...rows] as [string, string][];
              next[i] = [k, e.target.value];
              commit(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => commit(rows.filter((_, j) => j !== i) as [string, string][])}
            aria-label={`Remove ${keyLabel.toLowerCase()} row ${i + 1}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => commit([...(rows as [string, string][]), ["", ""]])}
      >
        <Plus className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

/** Editable list of single strings (e.g. command args, allowed commands). */
export function StringListRows({
  values,
  onChange,
  placeholder,
  addLabel = "Add",
  mono = true,
  itemLabel = "Item",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  mono?: boolean;
  itemLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {values.map((val, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={val}
            placeholder={placeholder}
            className={cn("h-8 flex-1 text-xs", mono && "font-mono")}
            aria-label={`${itemLabel} ${i + 1}`}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...values, ""])}
      >
        <Plus className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
