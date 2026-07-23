"use client";

import * as React from "react";
import { CircleNotch, Plus } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ACTION_TYPE_LABELS,
  getAudit,
  MANUAL_OUTCOMES,
  OUTCOME_LABELS,
  recordOutcome,
  relativeTime,
} from "@/lib/revenue";
import { errMessage, PolicyBadge } from "@/components/revenue/shared";
import type { ActionAudit, RevenueAction } from "@/types/revenue";

export function AuditSheet({
  action,
  onClose,
  onError,
}: {
  action: RevenueAction | null;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [audit, setAudit] = React.useState<ActionAudit | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [outcome, setOutcome] = React.useState("replied");
  const [logging, setLogging] = React.useState(false);

  const load = React.useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        setAudit(await getAudit(id));
      } catch (e) {
        onError(errMessage(e, "Could not load the history."));
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  React.useEffect(() => {
    if (action) {
      setAudit(null);
      void load(action.id);
    }
  }, [action, load]);

  if (!action) return null;

  const logOutcome = async () => {
    setLogging(true);
    onError("");
    try {
      await recordOutcome(action.id, {
        kind: outcome,
        source: "user",
        sourceEventId: `manual:${outcome}:${Date.now()}`,
      });
      await load(action.id);
    } catch (e) {
      onError(errMessage(e, "Could not record the outcome."));
    } finally {
      setLogging(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            {ACTION_TYPE_LABELS[action.actionType] ?? action.actionType} — {action.recipientEmail}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 px-4 py-5">
          {loading && !audit ? (
            <p className="text-sm text-primary/50">Loading history…</p>
          ) : audit ? (
            <>
              <Section title="Lifecycle">
                <Timeline audit={audit} />
              </Section>

              <Section title={`Revisions (${audit.revisions.length})`}>
                <ol className="flex flex-col gap-1.5">
                  {audit.revisions.map((r) => (
                    <li
                      key={r.revision}
                      className="flex items-center justify-between rounded-[2px] border border-border px-3 py-2 text-xs"
                    >
                      <span className="text-primary/70">
                        Rev {r.revision} · {r.actionType} · {r.channel}
                      </span>
                      <span className="font-mono text-primary/40">
                        {r.revisionHash.slice(0, 14)}…
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title={`Policy decisions (${audit.decisions.length})`}>
                {audit.decisions.length === 0 ? (
                  <p className="text-xs text-primary/45">
                    No preflight has run for this action yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {audit.decisions.map((d) => (
                      <li key={d.id} className="rounded-[2px] border border-border p-3">
                        <div className="flex items-center justify-between">
                          <PolicyBadge status={d.status} />
                          <span className="text-xs text-primary/45">
                            rev {d.revision} · {relativeTime(d.evaluatedAt)}
                          </span>
                        </div>
                        {d.reasonCodes && d.reasonCodes.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {d.reasonCodes.map((c) => (
                              <Badge key={c} variant="outline" className="font-mono text-[10px]">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        <SubObjects decision={d} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`Outcomes (${audit.outcomes.length})`}>
                {audit.outcomes.length > 0 ? (
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {audit.outcomes.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center justify-between rounded-[2px] border border-border px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-primary/80">
                          {OUTCOME_LABELS[o.kind] ?? o.kind}
                        </span>
                        <span className="text-primary/45">
                          {o.source} · {relativeTime(o.occurredAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-3 text-xs text-primary/45">No outcomes recorded yet.</p>
                )}
                <div className="flex items-center gap-2">
                  <Select value={outcome} onValueChange={setOutcome}>
                    <SelectTrigger size="sm" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="app-shell rounded-[2px]">
                      {MANUAL_OUTCOMES.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={logOutcome} disabled={logging}>
                    {logging ? <CircleNotch className="animate-spin" /> : <Plus />} Log outcome
                  </Button>
                </div>
              </Section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-primary/45">{title}</h3>
      {children}
    </div>
  );
}

function Timeline({ audit }: { audit: ActionAudit }) {
  const a = audit.action;
  const steps: { label: string; when?: string; done: boolean }[] = [
    { label: "Detected", when: a.createdAt, done: true },
    {
      label: "Policy checked",
      done: a.policyStatus !== "pending",
    },
    { label: "Approved", when: a.approvedAt, done: a.approvalStatus === "approved" },
    {
      label: a.executionMode === "send" ? "Sent" : "Drafted",
      when: a.executedAt,
      done: a.executionStatus === "sent",
    },
    { label: "Outcome", done: audit.outcomes.length > 0 },
  ];
  return (
    <ol className="flex flex-col gap-0">
      {steps.map((s, i) => (
        <li key={s.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={
                "mt-0.5 size-2.5 rounded-full " +
                (s.done ? "bg-emerald-500" : "border border-primary/30 bg-background")
              }
            />
            {i < steps.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
          </div>
          <div className="pb-4">
            <div className={"text-sm " + (s.done ? "text-primary" : "text-primary/40")}>
              {s.label}
            </div>
            {s.when ? <div className="text-xs text-primary/45">{relativeTime(s.when)}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function SubObjects({ decision }: { decision: ActionAudit["decisions"][number] }) {
  const parts: [string, unknown][] = [
    ["Verification", decision.verification],
    ["Suppression", decision.suppression],
    ["Research", decision.research],
    ["CRM", decision.crm],
  ];
  const present = parts.filter(([, v]) => v && Object.keys(v as object).length > 0);
  if (present.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {present.map(([label, v]) => (
        <details key={label} className="text-xs">
          <summary className="cursor-pointer text-primary/55">{label}</summary>
          <pre className="mt-1 overflow-x-auto rounded-[2px] bg-background-100/60 p-2 text-[11px] text-primary/70 dark:bg-background-100/40">
            {JSON.stringify(v, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}
