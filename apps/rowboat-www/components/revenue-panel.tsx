"use client";

import * as React from "react";
import {
  Alarm,
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  CurrencyDollar,
  EnvelopeSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Sparkle,
  WarningCircle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ACTION_TYPE_LABELS,
  approveAction,
  DETECTOR_LABELS,
  dismissAction,
  editAction,
  evaluateAction,
  executeAction,
  getAction,
  getWorkspace,
  listActions,
  PRIORITY_COMPONENT_LABELS,
  RevenueAPIError,
  snoozeAction,
  startScan,
  getScan,
} from "@/lib/revenue";
import type { RevenueAction, RevenueLeakScan, RevenueWorkspace } from "@/types/revenue";

/* --------------------------------- helpers -------------------------------- */

function priorityTone(score: number): { label: string; className: string } {
  if (score >= 70) return { label: "High", className: "text-red-600 dark:text-red-400" };
  if (score >= 40) return { label: "Medium", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Low", className: "text-primary/50" };
}

function policyBadge(status: string): React.ReactNode {
  const map: Record<
    string,
    { label: string; variant: "secondary" | "outline" | "destructive"; icon?: React.ReactNode }
  > = {
    passed: { label: "Cleared", variant: "outline", icon: <CheckCircle weight="fill" /> },
    review_required: {
      label: "Review required",
      variant: "secondary",
      icon: <WarningCircle weight="fill" />,
    },
    blocked: { label: "Blocked", variant: "destructive", icon: <Prohibit weight="fill" /> },
    stale: { label: "Re-check needed", variant: "secondary" },
    pending: { label: "Not checked", variant: "outline" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={m.variant} className="gap-1">
      {m.icon}
      {m.label}
    </Badge>
  );
}

function executionBadge(action: RevenueAction): React.ReactNode {
  const { executionStatus: s, executionMode } = action;
  if (s === "sent") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle weight="fill" />
        {executionMode === "draft" ? "Drafted" : "Sent"}
      </Badge>
    );
  }
  if (s === "ambiguous")
    return (
      <Badge variant="secondary" className="gap-1">
        <WarningCircle weight="fill" /> Needs reconcile
      </Badge>
    );
  if (s === "requested") return <Badge variant="secondary">Sending…</Badge>;
  if (s === "failed") return <Badge variant="destructive">Failed</Badge>;
  return null;
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-primary/60">
      {mode === "send" ? <PaperPlaneTilt weight="fill" /> : <EnvelopeSimple weight="fill" />}
      {mode === "send" ? "Send" : "Draft"}
    </span>
  );
}

/* --------------------------------- panel ---------------------------------- */

export function RevenuePanel({ onOpenConnectors }: { onOpenConnectors?: () => void }) {
  const [workspace, setWorkspace] = React.useState<RevenueWorkspace | null>(null);
  const [actions, setActions] = React.useState<RevenueAction[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [scan, setScan] = React.useState<RevenueLeakScan | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [selected, setSelected] = React.useState<RevenueAction | null>(null);
  const [ranScanOnce, setRanScanOnce] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [ws, acts] = await Promise.all([getWorkspace(), listActions("open", 25)]);
      setWorkspace(ws);
      setActions(acts);
    } catch (e) {
      if (e instanceof RevenueAPIError && e.status === 401) return; // proxy handles redirect
      setError(e instanceof Error ? e.message : "Could not load the revenue queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Poll a running scan until it finishes, then refresh the queue.
  React.useEffect(() => {
    if (!scan || (scan.status !== "running" && scan.status !== "pending")) return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await getScan(scan.id);
        if (!alive) return;
        setScan(next);
        if (next.status === "completed" || next.status === "failed") {
          setScanning(false);
          if (next.status === "failed") setError(next.error || "The scan failed.");
          await load();
        }
      } catch {
        // transient; keep polling
      }
    };
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scan, load]);

  const runScan = React.useCallback(async () => {
    setError(null);
    setNotice(null);
    setScanning(true);
    setRanScanOnce(true);
    try {
      const s = await startScan(90);
      setScan(s);
    } catch (e) {
      setScanning(false);
      if (e instanceof RevenueAPIError && e.code === "scan_unavailable") {
        setError(
          "Connect Gmail before running a scan — the scan reads your sent mail to find open loops.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Could not start the scan.");
      }
    }
  }, []);

  // Optimistically drop an action from the visible queue after a triage action.
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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-[2px] bg-background-200 text-primary/70 dark:bg-background-100">
            <CurrencyDollar weight="fill" className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-primary">Revenue queue</h1>
            <p className="max-w-lg text-sm text-primary/60">
              Open loops we found in your inbox — the follow-ups, proposals, and warm relationships
              that are quietly slipping. Review each draft, then approve it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {workspace ? <WorkspaceStatus workspace={workspace} /> : null}
          <Button size="sm" onClick={runScan} disabled={scanning}>
            {scanning ? <CircleNotch className="animate-spin" /> : <MagnifyingGlass />}
            {scanning ? "Scanning…" : "Run scan"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <WarningCircle weight="fill" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <Sparkle weight="fill" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {scanning && scan ? <ScanBanner scan={scan} /> : null}

      {loading ? (
        <QueueSkeleton />
      ) : empty ? (
        <EmptyState
          ranScanOnce={ranScanOnce}
          scan={scan}
          onScan={runScan}
          onOpenConnectors={onOpenConnectors}
          scanning={scanning}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action) => (
            <li key={action.id}>
              <ActionCard
                action={action}
                onReview={() => setSelected(action)}
                onOptimisticRemove={removeFromQueue}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}

      <ReviewSheet
        action={selected}
        workspace={workspace}
        onClose={() => setSelected(null)}
        onPatched={patchAction}
        onRemoved={removeFromQueue}
        onError={setError}
        onNotice={setNotice}
      />
    </div>
  );
}

/* ------------------------------ workspace tag ----------------------------- */

function WorkspaceStatus({ workspace }: { workspace: RevenueWorkspace }) {
  const linked = workspace.mode === "linked" && workspace.status === "active";
  return (
    <span
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex",
        linked
          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
          : "border-border text-primary/55",
      )}
      title={
        linked
          ? "Linked to OutboundConsole — sends are governed by policy preflight."
          : "Local mode — drafts land in your own mailbox; sending is disabled until a workspace is linked."
      }
    >
      <span className={cn("size-1.5 rounded-full", linked ? "bg-emerald-500" : "bg-primary/30")} />
      {linked ? "Linked" : "Local mode"}
    </span>
  );
}

/* ------------------------------- scan banner ------------------------------ */

function ScanBanner({ scan }: { scan: RevenueLeakScan }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[2px] border border-border bg-background-100/60 px-4 py-3 text-sm dark:bg-background-100/40">
      <span className="flex items-center gap-2 font-medium text-primary">
        <CircleNotch className="size-4 animate-spin" />
        Reading your inbox…
      </span>
      <span className="text-primary/60">{scan.threadsSeen ?? 0} threads scanned</span>
      <span className="text-primary/60">{scan.candidatesSeen ?? 0} open loops found</span>
      <span className="text-primary/60">{scan.actionsCreated ?? 0} drafts prepared</span>
    </div>
  );
}

/* ------------------------------- empty state ------------------------------ */

function EmptyState({
  ranScanOnce,
  scan,
  onScan,
  onOpenConnectors,
  scanning,
}: {
  ranScanOnce: boolean;
  scan: RevenueLeakScan | null;
  onScan: () => void;
  onOpenConnectors?: () => void;
  scanning: boolean;
}) {
  const scanned = ranScanOnce || scan?.status === "completed";
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2px] border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-background-200 text-primary/50 dark:bg-background-100">
        {scanned ? (
          <CheckCircle weight="fill" className="size-6" />
        ) : (
          <MagnifyingGlass className="size-6" />
        )}
      </div>
      {scanned ? (
        <>
          <div>
            <h2 className="text-base font-medium text-primary">You&apos;re on top of things</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-primary/60">
              No open revenue loops in the last 90 days. We&apos;ll keep watching — run another scan
              any time.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onScan} disabled={scanning}>
            <ArrowClockwise /> Scan again
          </Button>
        </>
      ) : (
        <>
          <div>
            <h2 className="text-base font-medium text-primary">Find the deals slipping through</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-primary/60">
              Connect Gmail and run a scan. We read your sent mail to surface unanswered proposals,
              promised follow-ups, and warm relationships that went quiet — each as a ready-to-send
              draft.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenConnectors ? (
              <Button variant="outline" size="sm" onClick={onOpenConnectors}>
                <EnvelopeSimple /> Connect Gmail
              </Button>
            ) : null}
            <Button size="sm" onClick={onScan} disabled={scanning}>
              <MagnifyingGlass /> Run scan
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- action card ------------------------------ */

function ActionCard({
  action,
  onReview,
  onOptimisticRemove,
  onError,
}: {
  action: RevenueAction;
  onReview: () => void;
  onOptimisticRemove: (id: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const tone = priorityTone(action.priorityScore);
  const recipient = action.recipientEmail || "Unknown recipient";

  const triage = async (kind: "snooze" | "dismiss") => {
    setBusy(kind);
    try {
      if (kind === "dismiss") await dismissAction(action.id, "not_relevant");
      else await snoozeAction(action.id, new Date(Date.now() + 7 * 86_400_000).toISOString());
      onOptimisticRemove(action.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : `Could not ${kind} the action.`);
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
          {action.executionMode === "send" ? policyBadge(action.policyStatus) : null}
          {action.approvalStatus === "approved" ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle weight="fill" /> Approved
            </Badge>
          ) : null}
          {executionBadge(action)}
        </div>
        <div className="flex items-center gap-1">
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
            {busy === "dismiss" ? <CircleNotch className="animate-spin" /> : <Prohibit />} Dismiss
          </Button>
          <Button size="sm" onClick={onReview} disabled={busy !== null}>
            <PencilSimple /> Review
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- review sheet ----------------------------- */

function ReviewSheet({
  action,
  workspace,
  onClose,
  onPatched,
  onRemoved,
  onError,
  onNotice,
}: {
  action: RevenueAction | null;
  workspace: RevenueWorkspace | null;
  onClose: () => void;
  onPatched: (a: RevenueAction) => void;
  onRemoved: (id: string) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [acceptRisk, setAcceptRisk] = React.useState(false);

  React.useEffect(() => {
    if (action) {
      setSubject(action.proposedSubject ?? "");
      setMessage(action.proposedMessage ?? "");
      setAcceptRisk(false);
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
      const msg =
        e instanceof RevenueAPIError
          ? e.message
          : e instanceof Error
            ? e.message
            : "The action could not be completed.";
      onError(msg);
    } finally {
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

  const approve = () => wrap("approve", () => approveAction(action.id, acceptRisk));

  const execute = () =>
    wrap("execute", () => executeAction(action.id), {
      note: isSend ? "Sent." : "Draft created in your Gmail — open Gmail to review and send.",
      removeOnDone: true,
    });

  return (
    <Sheet open={action !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {DETECTOR_LABELS[action.detector] ?? action.detector}
            </Badge>
            <ModeChip mode={action.executionMode} />
          </div>
          <SheetTitle>{ACTION_TYPE_LABELS[action.actionType] ?? action.actionType}</SheetTitle>
          <SheetDescription>{action.reason}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 px-4 py-5">
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
                {policyBadge(action.policyStatus)}
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
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                wrap(
                  "dismiss",
                  async () => {
                    const r = await dismissAction(action.id, "reviewed_not_relevant");
                    return r;
                  },
                  { removeOnDone: true },
                )
              }
              disabled={busy !== null}
            >
              {busy === "dismiss" ? <CircleNotch className="animate-spin" /> : <Prohibit />} Dismiss
            </Button>
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
                  disabled={busy !== null || blocked || dirty || (needsRisk && !acceptRisk)}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-primary/45">{label}</label>
      {children}
    </div>
  );
}

function PriorityBreakdown({ action }: { action: RevenueAction }) {
  const components = action.priorityComponents;
  if (!components || Object.keys(components).length === 0) return null;
  const entries = Object.entries(components).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <div className="rounded-[2px] border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-primary">
          Why this ranks {action.priorityScore}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {entries.map(([key, value]) => (
          <li key={key} className="flex items-center justify-between text-xs">
            <span className="text-primary/60">{PRIORITY_COMPONENT_LABELS[key] ?? key}</span>
            <span className={cn("tabular-nums", value < 0 ? "text-red-500" : "text-primary/70")}>
              {value > 0 ? "+" : ""}
              {value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------- skeleton -------------------------------- */

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 rounded-[2px] border border-border p-4">
          <Skeleton className="size-10 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
