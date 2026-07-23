"use client";

import * as React from "react";
import {
  Alarm,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Prohibit,
} from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  EmptyBlock,
  errMessage,
  ExecutionBadge,
  ListSkeleton,
  ModeChip,
  PolicyBadge,
  priorityTone,
} from "@/components/revenue/shared";
import { ReviewSheet } from "@/components/revenue/review-sheet";
import { AuditSheet } from "@/components/revenue/audit-sheet";
import type { RevenueAction, RevenueRelationship, RevenueWorkspace } from "@/types/revenue";

export function QueueView({
  workspace,
  onError,
  onNotice,
  onScan,
  scanning,
  refreshKey = 0,
}: {
  workspace: RevenueWorkspace | null;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onScan: () => void;
  scanning: boolean;
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <span className="text-xs text-primary/45">{actions.length} shown</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus /> New action
        </Button>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : empty ? (
        filter === "open" ? (
          <EmptyBlock
            icon={<MagnifyingGlass className="size-6" />}
            title="No open loops"
            body="Run a scan to surface unanswered proposals, promised follow-ups, and warm relationships that went quiet."
          >
            <Button size="sm" onClick={onScan} disabled={scanning}>
              {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />} Run scan
            </Button>
          </EmptyBlock>
        ) : (
          <EmptyBlock
            icon={<ClockCounterClockwise className="size-6" />}
            title={`Nothing ${filter}`}
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action) => (
            <li key={action.id}>
              <ActionCard
                action={action}
                onReview={() => setSelected(action)}
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
    <div className="group flex flex-col gap-3 rounded-[2px] border border-border bg-background p-4 transition-colors hover:border-primary/20">
      <div className="flex items-start gap-4">
        <div className="flex w-12 shrink-0 flex-col items-center">
          <span className={cn("text-2xl font-semibold tabular-nums", tone.className)}>
            {action.priorityScore}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-primary/40">{tone.label}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {DETECTOR_LABELS[action.detector] ?? action.detector}
            </Badge>
            <span className="truncate text-sm font-medium text-primary">{recipient}</span>
            <ModeChip mode={action.executionMode} />
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-primary/70">{action.reason}</p>
          {action.proposedSubject ? (
            <p className="mt-1 truncate text-xs text-primary/45">
              Draft subject: <span className="text-primary/60">{action.proposedSubject}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pl-16">
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
                {busy === "snooze" ? <CircleNotch className="animate-spin" /> : <Alarm />} Snooze
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => triage("dismiss")}
                disabled={busy !== null}
              >
                {busy === "dismiss" ? <CircleNotch className="animate-spin" /> : <Prohibit />}{" "}
                Dismiss
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
      </div>
    </div>
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
          <p className="py-4 text-sm text-primary/55">
            No relationships yet — run a scan or add one in the Relationships tab first.
          </p>
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
            {busy ? <CircleNotch className="animate-spin" /> : <Plus />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
