"use client";

import "client-only";

import * as React from "react";
import { Plus } from "@/lib/icons";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Card, CardContent } from "@oppulence/ui/components/card";
import { Label } from "@oppulence/ui/components/label";
import { Separator } from "@oppulence/ui/components/separator";
import { Spinner } from "@oppulence/ui/components/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@oppulence/ui/components/sheet";
import {
  ACTION_TYPE_LABELS,
  getAudit,
  MANUAL_OUTCOMES,
  OUTCOME_LABELS,
  recordOutcome,
  relativeTime,
  type RecordOutcomeInput,
} from "@/lib/revenue/revenue";
import { errMessage, PolicyBadge } from "@/components/features/revenue/shared/shared";
import { capture, RevenueEvents } from "@/lib/analytics/analytics";
import type { ActionAudit, RevenueAction } from "@/lib/revenue/types";

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
  const [outcome, setOutcome] = React.useState<RecordOutcomeInput["kind"]>("replied");
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
      capture(RevenueEvents.OutcomeLogged, { kind: outcome });
      await load(action.id);
    } catch (e) {
      onError(errMessage(e, "Could not record the outcome."));
    } finally {
      setLogging(false);
    }
  };

  return (
    <Sheet data-slot="audit-sheet" open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            {ACTION_TYPE_LABELS[action.actionType] ?? action.actionType} — {action.recipientEmail}
          </SheetDescription>
        </SheetHeader>

        <div
          className="flex flex-1 flex-col gap-6 px-4 py-5"
          data-capability="action-audit outcome-observation"
        >
          {loading && !audit ? (
            <p className="text-sm text-primary/50">Loading history…</p>
          ) : audit ? (
            <>
              <Section title="Lifecycle">
                <Timeline audit={audit} />
              </Section>

              <Section title={`Revisions (${audit.revisions.length})`}>
                <div className="flex flex-col gap-1.5">
                  {audit.revisions.map((r) => (
                    <Card className="gap-0 py-2" key={r.revision}>
                      <CardContent className="flex items-center justify-between px-3 text-xs">
                        <Label className="font-normal text-primary/70">
                          Rev {r.revision} · {r.actionType} · {r.channel}
                        </Label>
                        <Badge
                          className="font-mono font-normal text-primary/40"
                          variant="secondary"
                        >
                          {r.revisionHash.slice(0, 14)}…
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </Section>

              <Section title={`Policy decisions (${audit.decisions.length})`}>
                {audit.decisions.length === 0 ? (
                  <p className="text-xs text-primary/45">
                    No preflight has run for this action yet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {audit.decisions.map((d) => (
                      <Card className="gap-3 py-3" key={d.id}>
                        <CardContent className="px-3">
                          <div className="flex items-center justify-between">
                            <PolicyBadge status={d.status} />
                            <Badge
                              className="text-xs font-normal text-primary/45"
                              variant="secondary"
                            >
                              rev {d.revision} · {relativeTime(d.evaluatedAt)}
                            </Badge>
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
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={`Outcomes (${audit.outcomes.length})`}>
                {audit.outcomes.length > 0 ? (
                  <div className="mb-3 flex flex-col gap-1.5">
                    {audit.outcomes.map((o) => (
                      <Card className="gap-0 py-2" key={o.id}>
                        <CardContent className="flex items-center justify-between px-3 text-xs">
                          <Badge className="font-medium text-primary/80" variant="outline">
                            {OUTCOME_LABELS[o.kind] ?? o.kind}
                          </Badge>
                          <Label className="font-normal text-primary/45">
                            {o.source} · {relativeTime(o.occurredAt)}
                          </Label>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="mb-3 text-xs text-primary/45">No outcomes recorded yet.</p>
                )}
                <div className="flex items-center gap-2">
                  <Select
                    value={outcome}
                    onValueChange={(value) => {
                      const next = MANUAL_OUTCOMES.find((item) => item.value === value);
                      if (next) setOutcome(next.value);
                    }}
                  >
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
                    {logging ? <Spinner className="size-4" /> : <Plus />} Log outcome
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
      <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-primary/45">
        {title}
      </Label>
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
    { label: "Approved", when: a.approvedAt ?? undefined, done: a.approvalStatus === "approved" },
    {
      label: a.executionMode === "send" ? "Sent" : "Drafted",
      when: a.executedAt ?? undefined,
      done: a.executionStatus === "sent",
    },
    { label: "Outcome", done: audit.outcomes.length > 0 },
  ];
  return (
    <ol className="flex flex-col gap-0">
      {steps.map((s, i) => (
        <li key={s.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Badge
              className={
                "mt-0.5 size-2.5 rounded-full p-0 " +
                (s.done ? "border-0 bg-emerald-500" : "border border-primary/30 bg-background")
              }
              variant="outline"
            />
            {i < steps.length - 1 ? (
              <Separator
                className="flex-1 data-[orientation=vertical]:h-auto"
                orientation="vertical"
              />
            ) : null}
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
