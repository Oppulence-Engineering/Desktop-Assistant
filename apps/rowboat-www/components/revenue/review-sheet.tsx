"use client";

import * as React from "react";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  EnvelopeSimple,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  XCircle,
} from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTION_TYPE_LABELS,
  approveAction,
  DETECTOR_LABELS,
  dismissAction,
  editAction,
  evaluateAction,
  executeAction,
  getAction,
  rejectAction,
  RevenueAPIError,
  startCheckout,
} from "@/lib/revenue";
import {
  errMessage,
  Field,
  ModeChip,
  PolicyBadge,
  PriorityBreakdown,
} from "@/components/revenue/shared";
import { capture, RevenueEvents } from "@/lib/analytics";
import type { RevenueAction, RevenueWorkspace } from "@/types/revenue";

export function ReviewSheet({
  action,
  workspace,
  onClose,
  onPatched,
  onRemoved,
  onError,
  onNotice,
  onOpenAudit,
}: {
  action: RevenueAction | null;
  workspace: RevenueWorkspace | null;
  onClose: () => void;
  onPatched: (a: RevenueAction) => void;
  onRemoved: (id: string) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onOpenAudit: (a: RevenueAction) => void;
}) {
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [acceptRisk, setAcceptRisk] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [upsell, setUpsell] = React.useState(false);

  React.useEffect(() => {
    if (action) {
      setSubject(action.proposedSubject ?? "");
      setMessage(action.proposedMessage ?? "");
      setAcceptRisk(false);
      setRejecting(false);
      setRejectReason("");
      setUpsell(false);
    }
  }, [action]);

  if (!action) return null;

  const isSend = action.executionMode === "send";
  const linked = workspace?.mode === "linked" && workspace.status === "active";
  const dirty =
    subject !== (action.proposedSubject ?? "") || message !== (action.proposedMessage ?? "");
  const approved =
    action.approvalStatus === "approved" && action.approvedRevision === action.revision;
  const needsRisk = isSend && action.policyStatus === "review_required";
  const blocked = action.policyStatus === "blocked";
  const rejected = action.approvalStatus === "rejected";
  const executeLabel = isSend ? "Send email" : "Create draft in Gmail";

  const wrap = async (
    key: string,
    fn: () => Promise<RevenueAction>,
    opts?: { removeOnDone?: boolean; note?: string },
  ) => {
    setBusy(key);
    onError("");
    try {
      const updated = await fn();
      onPatched(updated);
      if (opts?.note) onNotice(opts.note);
      if (opts?.removeOnDone) onRemoved(action.id);
    } catch (e) {
      if (e instanceof RevenueAPIError && e.code === "subscription_required") {
        setUpsell(true); // acting is a paid step; show the upgrade prompt inline
        return;
      }
      onError(
        e instanceof RevenueAPIError
          ? e.message
          : errMessage(e, "The action could not be completed."),
      );
    } finally {
      setBusy(null);
    }
  };

  const upgrade = async () => {
    setBusy("upgrade");
    onError("");
    capture(RevenueEvents.UpgradeClicked, { from: "review_sheet" });
    try {
      const url = await startCheckout("pro");
      window.location.assign(url);
    } catch (e) {
      onError(errMessage(e, "Could not start checkout."));
      setBusy(null);
    }
  };

  const saveEdit = () =>
    wrap(
      "save",
      () => editAction(action.id, { proposedSubject: subject, proposedMessage: message }),
      {
        note: "Saved — this created a new revision, so re-check and approve before sending.",
      },
    );

  const evaluate = () =>
    wrap("evaluate", async () => {
      await evaluateAction(action.id);
      return await getAction(action.id);
    });

  const approve = () =>
    wrap("approve", async () => {
      const r = await approveAction(action.id, acceptRisk);
      capture(RevenueEvents.ActionApproved, {
        detector: action.detector,
        mode: action.executionMode,
      });
      return r;
    });

  const doReject = () =>
    wrap("reject", () => rejectAction(action.id, rejectReason || "not_appropriate"), {
      removeOnDone: true,
      note: "Rejected.",
    });

  const execute = () =>
    wrap(
      "execute",
      async () => {
        const r = await executeAction(action.id);
        capture(RevenueEvents.ActionExecuted, {
          detector: action.detector,
          mode: action.executionMode,
        });
        return r;
      },
      {
        note: isSend ? "Sent." : "Draft created in your Gmail — open Gmail to review and send.",
        removeOnDone: true,
      },
    );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {DETECTOR_LABELS[action.detector] ?? action.detector}
            </Badge>
            <ModeChip mode={action.executionMode} />
            <button
              type="button"
              onClick={() => onOpenAudit(action)}
              className="ml-auto flex items-center gap-1 text-xs text-primary/55 transition-colors hover:text-primary"
            >
              <ClockCounterClockwise /> History
            </button>
          </div>
          <SheetTitle>{ACTION_TYPE_LABELS[action.actionType] ?? action.actionType}</SheetTitle>
          <SheetDescription>{action.reason}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 px-4 py-5">
          {upsell ? (
            <div className="flex flex-col gap-2 rounded-[2px] border border-oppulence-orange/40 bg-oppulence-orange/5 p-4">
              <div className="text-sm font-medium text-primary">
                Acting on actions is a paid step
              </div>
              <p className="text-sm text-primary/65">
                Scanning, the queue, drafts, and your impact stay free. Approving and sending need a
                subscription — upgrade to act on this one.
              </p>
              <div>
                <Button size="sm" onClick={upgrade} disabled={busy !== null}>
                  {busy === "upgrade" ? <CircleNotch className="animate-spin" /> : null} Upgrade to
                  act
                </Button>
              </div>
            </div>
          ) : null}
          {blocked ? (
            <Alert variant="destructive">
              <Prohibit weight="fill" />
              <AlertTitle>Policy blocked this contact</AlertTitle>
              <AlertDescription>
                Preflight flagged this recipient (suppressed, invalid, or excluded). It can&apos;t
                be sent.
              </AlertDescription>
            </Alert>
          ) : null}
          {rejected ? (
            <Alert>
              <XCircle weight="fill" />
              <AlertDescription>This action was rejected.</AlertDescription>
            </Alert>
          ) : null}

          <Field label="To">
            <Input value={action.recipientEmail ?? ""} readOnly className="bg-background-100/50" />
          </Field>
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
            />
          </Field>
          <Field label="Message">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={10}
              className="resize-y font-normal"
              placeholder="Draft body"
            />
            <p className="mt-1 text-xs text-primary/45">
              Editing the draft creates a new revision and clears any prior approval — you&apos;ll
              re-approve below.
            </p>
          </Field>

          <PriorityBreakdown action={action} />

          {isSend ? (
            <div className="flex flex-col gap-2 rounded-[2px] border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary">Policy preflight</span>
                <PolicyBadge status={action.policyStatus} />
              </div>
              {!linked ? (
                <p className="text-xs text-primary/55">
                  This workspace is in local mode. Sending is disabled until it&apos;s linked to a
                  governed OutboundConsole workspace — you can still create a draft in Gmail.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={evaluate} disabled={busy !== null}>
                    {busy === "evaluate" ? (
                      <CircleNotch className="animate-spin" />
                    ) : (
                      <ArrowClockwise />
                    )}
                    Re-check policy
                  </Button>
                  {needsRisk ? (
                    <label className="flex items-center gap-1.5 text-xs text-primary/70">
                      <input
                        type="checkbox"
                        checked={acceptRisk}
                        onChange={(e) => setAcceptRisk(e.target.checked)}
                      />
                      Accept the review-required risk
                    </label>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {rejecting ? (
            <div className="flex items-center gap-2 rounded-[2px] border border-border p-3">
              <Input
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
              />
              <Button variant="destructive" size="sm" onClick={doReject} disabled={busy !== null}>
                {busy === "reject" ? <CircleNotch className="animate-spin" /> : <XCircle />} Confirm
                reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  wrap("dismiss", () => dismissAction(action.id, "reviewed_not_relevant"), {
                    removeOnDone: true,
                  })
                }
                disabled={busy !== null}
              >
                {busy === "dismiss" ? <CircleNotch className="animate-spin" /> : <Prohibit />}{" "}
                Dismiss
              </Button>
              {isSend && !rejected ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRejecting(true)}
                  disabled={busy !== null}
                >
                  <XCircle /> Reject
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {dirty ? (
                <Button variant="outline" size="sm" onClick={saveEdit} disabled={busy !== null}>
                  {busy === "save" ? <CircleNotch className="animate-spin" /> : <PencilSimple />}{" "}
                  Save draft
                </Button>
              ) : null}
              {!approved ? (
                <Button
                  size="sm"
                  onClick={approve}
                  disabled={
                    busy !== null || blocked || rejected || dirty || (needsRisk && !acceptRisk)
                  }
                  title={dirty ? "Save your edits first" : undefined}
                >
                  {busy === "approve" ? <CircleNotch className="animate-spin" /> : <CheckCircle />}{" "}
                  Approve
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={execute}
                  disabled={busy !== null || blocked || (isSend && !linked)}
                >
                  {busy === "execute" ? (
                    <CircleNotch className="animate-spin" />
                  ) : isSend ? (
                    <PaperPlaneTilt />
                  ) : (
                    <EnvelopeSimple />
                  )}
                  {executeLabel}
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
