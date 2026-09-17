"use client";

import * as React from "react";
import {
  Alarm,
  CheckCircle,
  ClockCounterClockwise,
  MagnifyingGlass,
  PencilSimple,
  Plugs,
  Plus,
  Prohibit,
} from "@/lib/icons";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Card, CardContent, CardFooter } from "@oppulence/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@oppulence/ui/components/empty";
import { Label } from "@oppulence/ui/components/label";
import { Spinner } from "@oppulence/ui/components/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Textarea } from "@oppulence/ui/components/textarea";
import { cn } from "@/lib/utils";
import {
  createAction,
  DETECTOR_LABELS,
  dismissAction,
  listActions,
  listRelationships,
  QUEUE_FILTERS,
  snoozeAction,
} from "@/lib/revenue";
import {
  errMessage,
  ExecutionBadge,
  ListSkeleton,
  ModeChip,
  PolicyBadge,
  priorityTone,
} from "@/components/revenue/shared";
import { capture, RevenueEvents } from "@/lib/analytics";
import { ReviewSheet } from "@/components/revenue/review-sheet";
import { AuditSheet } from "@/components/revenue/audit-sheet";
import type { RevenueAction, RevenueRelationship, RevenueWorkspace } from "@/types/revenue";

export function QueueView({
  workspace,
  onError,
  onNotice,
  onScan,
  scanning,
  needsReconnect = false,
  refreshKey = 0,
}: {
  workspace: RevenueWorkspace | null;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onScan: () => void;
  scanning: boolean;
  /** The audit can only fail until Google is reconnected; `onScan` opens the fix. */
  needsReconnect?: boolean;
  refreshKey?: number;
}) {
  const [filter, setFilter] = React.useState("open");
  const [actions, setActions] = React.useState<RevenueAction[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<RevenueAction | null>(null);
  const [auditFor, setAuditFor] = React.useState<RevenueAction | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(
    async (status: string) => {
      setLoading(true);
      try {
        setActions(await listActions(status, 50));
      } catch (e) {
        onError(errMessage(e, "Could not load the queue."));
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  React.useEffect(() => {
    void load(filter);
  }, [filter, load, refreshKey]);

  const removeFromQueue = React.useCallback((id: string) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
    setSelected((cur) => (cur?.id === id ? null : cur));
  }, []);

  const patchAction = React.useCallback((updated: RevenueAction) => {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((cur) => (cur?.id === updated.id ? updated : cur));
  }, []);

  const empty = !loading && actions.length === 0;

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-[2px]">
              {QUEUE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="font-normal text-primary/45">
            {actions.length} shown
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus /> New action
        </Button>
      </div>

      {loading ? (
        <div className="p-3">
          <ListSkeleton />
        </div>
      ) : empty ? (
        filter === "open" ? (
          <QueueEmpty
            icon={<MagnifyingGlass className="size-6" />}
            title="No recovery drafts"
            body="Run a Promise Leak Audit or draft recovery from a confirmed commitment."
          >
            <Button size="sm" onClick={onScan} disabled={scanning}>
              {needsReconnect ? (
                <>
                  <Plugs /> Reconnect Google
                </>
              ) : (
                <>{scanning ? <Spinner /> : <MagnifyingGlass />} Run audit</>
              )}
            </Button>
          </QueueEmpty>
        ) : (
          <QueueEmpty
            icon={<ClockCounterClockwise className="size-6" />}
            title={`Nothing ${filter}`}
          />
        )
      ) : (
        <ul className="flex flex-col gap-3 p-3">
          {actions.map((action) => (
            <li key={action.id}>
              <ActionCard
                action={action}
                onReview={() => {
                  capture(RevenueEvents.ActionReviewed, { detector: action.detector });
                  setSelected(action);
                }}
                onAudit={() => setAuditFor(action)}
                onOptimisticRemove={removeFromQueue}
                onError={onError}
              />
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <ReviewSheet
          action={selected}
          workspace={workspace}
          onClose={() => setSelected(null)}
          onPatched={patchAction}
          onRemoved={removeFromQueue}
          onError={onError}
          onNotice={onNotice}
          onOpenAudit={(a) => {
            setSelected(null);
            setAuditFor(a);
          }}
        />
      ) : null}

      {auditFor ? (
        <AuditSheet action={auditFor} onClose={() => setAuditFor(null)} onError={onError} />
      ) : null}

      {creating ? (
        <CreateActionDialog
          onClose={() => setCreating(false)}
          onCreated={(a) => {
            setCreating(false);
            onNotice("Action created.");
            if (filter === "open") setActions((prev) => [a, ...prev]);
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function ActionCard({
  action,
  onReview,
  onAudit,
  onOptimisticRemove,
  onError,
}: {
  action: RevenueAction;
  onReview: () => void;
  onAudit: () => void;
  onOptimisticRemove: (id: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const tone = priorityTone(action.priorityScore);
  const recipient = action.recipientEmail || "Unknown recipient";
  const open = action.queueStatus === "open";

  const triage = async (kind: "snooze" | "dismiss") => {
    setBusy(kind);
    try {
      if (kind === "dismiss") await dismissAction(action.id, "not_relevant");
      else await snoozeAction(action.id, new Date(Date.now() + 7 * 86_400_000).toISOString());
      onOptimisticRemove(action.id);
    } catch (e) {
      onError(errMessage(e, `Could not ${kind} the action.`));
      setBusy(null);
    }
  };

  return (
    <Card className="group gap-3 rounded-[2px] border-border bg-background py-4 shadow-none transition-colors hover:border-primary/20">
      <CardContent className="flex flex-col gap-3 px-4 pt-0 pb-0">
        <div className="flex items-start gap-4">
          <div className="flex w-12 shrink-0 flex-col items-center">
            <Badge
              className={cn(
                "border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums",
                tone.className,
              )}
              variant="outline"
            >
              {action.priorityScore}
            </Badge>
            <Badge
              variant="outline"
              className="mt-0.5 px-1 py-0 text-[10px] uppercase tracking-wide text-primary/40"
            >
              {tone.label}
            </Badge>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-normal">
                {DETECTOR_LABELS[action.detector] ?? action.detector}
              </Badge>
              <Label className="truncate text-sm font-medium text-primary">{recipient}</Label>
              <ModeChip mode={action.executionMode} />
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm text-primary/70">{action.reason}</p>
            {action.proposedSubject ? (
              <p className="mt-1 truncate text-xs text-primary/45">
                Draft subject:{" "}
                <Badge variant="secondary" className="font-normal text-primary/60">
                  {action.proposedSubject}
                </Badge>
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-0 px-4 pt-0 pb-0 pl-16">
        <div className="flex flex-wrap items-center gap-1.5">
          {action.executionMode === "send" ? <PolicyBadge status={action.policyStatus} /> : null}
          {action.approvalStatus === "approved" ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle weight="fill" /> Approved
            </Badge>
          ) : null}
          <ExecutionBadge action={action} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onAudit}>
            <ClockCounterClockwise /> History
          </Button>
          {open ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => triage("snooze")}
                disabled={busy !== null}
              >
                {busy === "snooze" ? <Spinner /> : <Alarm />} Snooze
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => triage("dismiss")}
                disabled={busy !== null}
              >
                {busy === "dismiss" ? <Spinner /> : <Prohibit />} Dismiss
              </Button>
              <Button size="sm" onClick={onReview} disabled={busy !== null}>
                <PencilSimple /> Review
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onReview}>
              <PencilSimple /> Open
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function QueueEmpty({
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
    <Empty className="flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <EmptyMedia className="flex size-12 items-center justify-center text-primary/35">
        {icon}
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="text-base font-medium text-primary">{title}</EmptyTitle>
        {body ? (
          <EmptyDescription className="mx-auto mt-1 max-w-sm text-sm text-primary/60">
            {body}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

function CreateActionDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (a: RevenueAction) => void;
  onError: (m: string) => void;
}) {
  const [relationships, setRelationships] = React.useState<RevenueRelationship[]>([]);
  const [relationshipId, setRelationshipId] = React.useState("");
  const [actionType, setActionType] = React.useState("warm_follow_up");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void listRelationships()
      .then((r) => {
        setRelationships(r);
        if (r[0]) setRelationshipId(r[0].id);
      })
      .catch((e) => onError(errMessage(e, "Could not load relationships.")));
  }, [onError]);

  const submit = async () => {
    if (!relationshipId || !reason.trim()) return;
    setBusy(true);
    onError("");
    try {
      const rel = relationships.find((r) => r.id === relationshipId);
      const created = await createAction({
        relationshipId,
        actionType,
        channel: "email",
        reason: reason.trim(),
        recipientEmail: rel?.primaryEmail,
        proposedSubject: subject || undefined,
        proposedMessage: message || undefined,
        executionMode: "draft",
      });
      onCreated(created);
    } catch (e) {
      onError(errMessage(e, "Could not create the action."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New action</DialogTitle>
          <DialogDescription>
            Add a manual follow-up to the queue against an existing relationship.
          </DialogDescription>
        </DialogHeader>
        {relationships.length === 0 ? (
          <Empty className="gap-3 py-4">
            <EmptyHeader>
              <EmptyDescription className="text-sm text-primary/55">
                No relationships yet — run a scan or add one in the Relationships tab first.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <Select value={relationshipId} onValueChange={setRelationshipId}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Relationship" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-[2px]">
                {relationships.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.displayName}
                    {r.primaryEmail ? ` · ${r.primaryEmail}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-[2px]">
                {[
                  "warm_follow_up",
                  "proposal_nudge",
                  "referral_reconnect",
                  "customer_risk",
                  "meeting_follow_up",
                ].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why now? (reason)"
            />
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Draft subject (optional)"
            />
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="Draft message (optional)"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !relationshipId || !reason.trim()}>
            {busy ? <Spinner /> : <Plus />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
