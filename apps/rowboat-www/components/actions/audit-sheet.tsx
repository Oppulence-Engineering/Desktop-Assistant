"use client";

import * as React from "react";
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  Key,
  Receipt,
  ShieldCheck,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@oppulence/ui/components/sheet";
import { getAudit } from "@/lib/actions";
import { errMessage } from "@/components/revenue/shared";
import type { AuditChain, AuditEntry } from "@/types/actions";

// ActionAuditSheet renders the full RFC 023 audit chain for one object:
// proposal → token → execution → return event, newest proposal first.
export function ActionAuditSheet({
  resourceRef,
  onClose,
}: {
  resourceRef: string;
  onClose: () => void;
}) {
  const [chain, setChain] = React.useState<AuditChain | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setChain(null);
    setError(null);
    void getAudit(resourceRef)
      .then((c) => live && setChain(c))
      .catch((e) => live && setError(errMessage(e, "Could not load the audit trail.")));
    return () => {
      live = false;
    };
  }, [resourceRef]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Audit trail</SheetTitle>
          <SheetDescription className="flex items-center gap-1.5">
            <Receipt weight="fill" className="text-primary/40" />
            <code className="font-mono text-xs text-primary/70">{resourceRef}</code>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 px-4 py-5">
          {error ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
          ) : chain === null ? (
            <div className="flex items-center gap-2 text-sm text-primary/50">
              <CircleNotch className="animate-spin" /> Loading…
            </div>
          ) : chain.entries.length === 0 ? (
            <p className="text-sm text-primary/50">No actions recorded for this object.</p>
          ) : (
            chain.entries.map((e) => <AuditEntryCard key={e.proposal.id} entry={e} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AuditEntryCard({ entry }: { entry: AuditEntry }) {
  const p = entry.proposal;
  return (
    <div className="flex flex-col gap-3 rounded-[2px] border border-border p-3">
      <div className="flex items-center gap-2">
        <code className="rounded-[2px] bg-background-200 px-1.5 py-0.5 font-mono text-xs text-primary/70 dark:bg-background-100">
          {p.kind}
        </code>
        <Badge variant="outline" className="capitalize">
          {p.status.replace(/_/g, " ")}
        </Badge>
        <span className="ml-auto text-xs text-primary/45">
          {new Date(p.createdAt).toLocaleString()}
        </span>
      </div>

      {/* The four linked legs of the loop. */}
      <ol className="flex flex-col gap-2 text-xs">
        <Leg
          icon={<Receipt weight="fill" />}
          label="Proposed"
          when={p.createdAt}
          detail={p.rationale}
        />
        {entry.tokens.map((t) => (
          <Leg
            key={t.hashPrefix}
            icon={<Key weight="fill" />}
            label={`Approved${t.stepUp ? " · step-up" : ""}`}
            when={t.issuedAt}
            detail={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <code className="font-mono text-primary/50">token {t.hashPrefix}…</code>
                {t.consumed ? (
                  <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle weight="fill" /> consumed
                  </Badge>
                ) : (
                  <Badge variant="secondary">unused</Badge>
                )}
              </span>
            }
          />
        ))}
        {p.executedAt ? (
          <Leg
            icon={<ShieldCheck weight="fill" />}
            label="Executed"
            when={p.executedAt}
            detail={
              p.resultRef ? (
                <code className="font-mono text-primary/50">{p.resultRef}</code>
              ) : (
                p.reason
              )
            }
          />
        ) : null}
        {p.resolvedAt ? (
          <Leg
            icon={<CheckCircle weight="fill" />}
            label="Loop closed"
            when={p.resolvedAt}
            detail={
              p.returnEventId ? (
                <code className="font-mono text-primary/50">
                  return event {p.returnEventId.slice(0, 8)}…
                </code>
              ) : undefined
            }
          />
        ) : null}
      </ol>
    </div>
  );
}

function Leg({
  icon,
  label,
  when,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  when: string;
  detail?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background-200 text-primary/50 dark:bg-background-100">
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="flex items-center gap-1.5 text-primary/80">
          {label}
          <ArrowRight weight="bold" className="text-primary/25" />
          <span className="text-primary/45">{new Date(when).toLocaleString()}</span>
        </span>
        {detail ? <span className="text-primary/60">{detail}</span> : null}
      </div>
    </li>
  );
}
