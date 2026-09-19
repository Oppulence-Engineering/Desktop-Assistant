"use client";

import "client-only";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRelationships } from "@/hooks/queries/use-relationships";
import { useRevenueActions } from "@/hooks/queries/use-revenue-actions";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
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
import { Empty, EmptyDescription, EmptyHeader } from "@oppulence/ui/components/empty";
import { Label } from "@oppulence/ui/components/label";
import { Spinner } from "@oppulence/ui/components/spinner";
import { EmptyBlock, WorkspaceEmptyState } from "@/components/features/revenue/shared/shared";
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
import { Badge as SimBadge, Chip } from "@sim/emcn";
import { ListFilter } from "@sim/emcn/icons";
import { cn } from "@/lib/utils";
import {
  SimProductHeader,
  SimProductPanel,
  SimProductToolbar,
} from "@/components/features/sim-product/sim-product-frame/sim-product-frame";
import {
  createAction,
  DETECTOR_LABELS,
  dismissAction,
  QUEUE_FILTERS,
  snoozeAction,
  type CreateActionInput,
} from "@/lib/revenue/revenue";
import {
  errMessage,
  ExecutionBadge,
  ListSkeleton,
  PolicyBadge,
  priorityTone,
} from "@/components/features/revenue/shared/shared";
import { capture, RevenueEvents } from "@/lib/analytics/analytics";
import { ReviewSheet } from "@/components/features/revenue/review-sheet/review-sheet";
import { AuditSheet } from "@/components/features/revenue/audit-sheet/audit-sheet";
import type { RevenueAction, RevenueRelationship, RevenueWorkspace } from "@/lib/revenue/types";

export function QueueView({
  workspace,
  onError,
  onNotice,
  onScan,
  scanning,
  needsReconnect = false,
}: {
  workspace: RevenueWorkspace | null;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onScan: () => void;
  scanning: boolean;
  /** The audit can only fail until Google is reconnected; `onScan` opens the fix. */
  needsReconnect?: boolean;
}) {
  const [filter, setFilter] = React.useState("open");
  const [selected, setSelected] = React.useState<RevenueAction | null>(null);
  const [auditFor, setAuditFor] = React.useState<RevenueAction | null>(null);
  const [creating, setCreating] = React.useState(false);
  const queryClient = useQueryClient();
  const actionsQueryKey = revenueActionKeys.list(filter, 50);
  const actionsQuery = useRevenueActions(filter);
  const actions = actionsQuery.data ?? [];

  React.useEffect(() => {
    if (actionsQuery.error) {
      onError(errMessage(actionsQuery.error, "Could not load the queue."));
    }
  }, [actionsQuery.error, onError]);

  const removeFromQueue = React.useCallback(
    (id: string) => {
      queryClient.setQueryData<RevenueAction[]>(actionsQueryKey, (current = []) =>
        current.filter((action) => action.id !== id),
      );
      setSelected((cur) => (cur?.id === id ? null : cur));
    },
    [actionsQueryKey, queryClient],
  );

  const patchAction = React.useCallback(
    (updated: RevenueAction) => {
      queryClient.setQueryData<RevenueAction[]>(actionsQueryKey, (current = []) =>
        current.map((action) => (action.id === updated.id ? updated : action)),
      );
      setSelected((cur) => (cur?.id === updated.id ? updated : cur));
    },
    [actionsQueryKey, queryClient],
  );

  const empty = actionsQuery.isSuccess && actions.length === 0;

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col p-3" data-slot="queue-view">
      <SimProductPanel className="flex min-h-0 flex-1 flex-col">
        <SimProductHeader actions={`${actions.length} shown`} title="Recovery queue" />
        <SimProductToolbar>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-7 w-36 border-0 bg-transparent px-0 shadow-none" size="sm">
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
          <Chip leftIcon={ListFilter}>Filter</Chip>
          <Button className="ml-auto" onClick={() => setCreating(true)} size="sm" variant="outline">
            <Plus /> New action
          </Button>
        </SimProductToolbar>

        {actionsQuery.isPending ? (
          <div className="p-3">
            <ListSkeleton />
          </div>
        ) : actionsQuery.isError ? (
          <EmptyBlock
            body="The recovery queue is temporarily unavailable. Existing drafts and approvals were not changed."
            image="recovery"
            learnMore={[]}
            title="Recovery could not load"
          >
            <Button onClick={() => void actionsQuery.refetch()} type="button" variant="outline">
              Try again
            </Button>
          </EmptyBlock>
        ) : empty ? (
          filter === "open" ? (
            <WorkspaceEmptyState
              action={
                <Button
                  className="bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
                  disabled={scanning}
                  onClick={onScan}
                  size="sm"
                >
                  {needsReconnect ? (
                    <>
                      <Plugs /> Reconnect Google
                    </>
                  ) : (
                    <>{scanning ? <Spinner /> : <MagnifyingGlass />} Run audit</>
                  )}
                </Button>
              }
              description={
                <>
                  No recovery drafts yet! Run an audit
                  <br />
                  or draft recovery from a commitment.
                </>
              }
              image="recovery"
              learnMore={[
                { label: "Approve recovery before sending" },
                { label: "Draft from confirmed commitments" },
              ]}
              title="Recovery"
            />
          ) : (
            <WorkspaceEmptyState
              description={`Nothing in the ${filter} queue right now.`}
              image="recovery"
              learnMore={[]}
              title="Recovery"
            />
          )
        ) : (
          <ul className="flex flex-col gap-3 p-3">
            {actions.map((action) => (
              <li key={action.id}>
                <ActionCard
                  action={action}
                  onAudit={() => setAuditFor(action)}
                  onError={onError}
                  onOptimisticRemove={removeFromQueue}
                  onReview={() => {
                    capture(RevenueEvents.ActionReviewed, { detector: action.detector });
                    setSelected(action);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </SimProductPanel>

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
            if (filter === "open") {
              queryClient.setQueryData<RevenueAction[]>(actionsQueryKey, (current = []) => [
                a,
                ...current,
              ]);
            }
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
    <SimProductPanel className="overflow-hidden">
      <div className="flex items-start gap-4 px-4 py-3">
        <div className="flex w-12 shrink-0 flex-col items-center">
          <span className={cn("text-2xl font-semibold tabular-nums", tone.className)}>
            {action.priorityScore}
          </span>
          <SimBadge className="mt-0.5" variant="amber">
            {tone.label}
          </SimBadge>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SimBadge variant="amber">
              {DETECTOR_LABELS[action.detector] ?? action.detector}
            </SimBadge>
            <Label className="truncate text-sm font-medium text-[var(--text-primary)]">
              {recipient}
            </Label>
            <Chip className="ml-auto">{open ? "Held" : action.queueStatus}</Chip>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-[var(--text-secondary)]">
            {action.reason}
          </p>
          {action.proposedSubject ? (
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
              Draft subject: {action.proposedSubject}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-[var(--border)] border-t px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {action.executionMode === "send" ? <PolicyBadge status={action.policyStatus} /> : null}
          {action.approvalStatus === "approved" ? (
            <Badge
              className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              variant="outline"
            >
              <CheckCircle weight="fill" /> Approved
            </Badge>
          ) : null}
          <ExecutionBadge action={action} />
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={onAudit} size="sm" variant="ghost">
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
            <Button onClick={onReview} size="sm" variant="outline">
              <PencilSimple /> Open
            </Button>
          )}
        </div>
      </div>
    </SimProductPanel>
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
  const relationshipsQuery = useRelationships();
  const relationships = relationshipsQuery.data ?? [];
  const [relationshipId, setRelationshipId] = React.useState("");
  const createActionTypes = [
    "warm_follow_up",
    "proposal_nudge",
    "referral_reconnect",
    "customer_risk",
    "meeting_follow_up",
  ] as const satisfies readonly CreateActionInput["actionType"][];
  const [actionType, setActionType] =
    React.useState<CreateActionInput["actionType"]>("warm_follow_up");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (relationshipsQuery.error) {
      onError(errMessage(relationshipsQuery.error, "Could not load relationships."));
    }
  }, [onError, relationshipsQuery.error]);

  React.useEffect(() => {
    if (!relationshipId && relationships[0]) setRelationshipId(relationships[0].id);
  }, [relationshipId, relationships]);

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
            <Select
              value={actionType}
              onValueChange={(value) => {
                const next = createActionTypes.find((type) => type === value);
                if (next) setActionType(next);
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-[2px]">
                {createActionTypes.map((t) => (
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
