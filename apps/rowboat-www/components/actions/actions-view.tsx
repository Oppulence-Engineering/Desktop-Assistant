"use client";

import * as React from "react";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  CurrencyDollar,
  ListChecks,
  Prohibit,
  Receipt,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Textarea } from "@oppulence/ui/components/textarea";
import { cn } from "@/lib/utils";
import { capture, ActionEvents } from "@/lib/analytics";
import { ActionAPIError, approve, execute, getAudit, listPending, reject } from "@/lib/actions";
import { EmptyBlock, errMessage, ListSkeleton } from "@/components/revenue/shared";
import { ActionAuditSheet } from "@/components/actions/audit-sheet";
import type { ActionProposal, ActionStatus } from "@/types/actions";

function StatusBadge({ status }: { status: ActionStatus }) {
  const map: Record<
    ActionStatus,
    { label: string; variant: "secondary" | "outline" | "destructive"; icon?: React.ReactNode }
  > = {
    pending: { label: "Awaiting approval", variant: "secondary" },
    approved: { label: "Approved", variant: "outline", icon: <ShieldCheck weight="fill" /> },
    executed: { label: "Executed", variant: "outline", icon: <CheckCircle weight="fill" /> },
    executed_unconfirmed: { label: "Executed · unconfirmed", variant: "secondary" },
    rejected: { label: "Rejected", variant: "destructive" },
    failed: { label: "Failed", variant: "destructive" },
    expired: { label: "Expired", variant: "secondary" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={m.variant} className="gap-1">
      {m.icon}
      {m.label}
    </Badge>
  );
}

// Ref renders a resourceRef / kind in a compact monospace chip.
function Ref({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[2px] bg-background-200 px-1.5 py-0.5 font-mono text-xs text-primary/70 dark:bg-background-100">
      {children}
    </code>
  );
}

export function ActionsView() {
  const [proposals, setProposals] = React.useState<ActionProposal[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [disabled, setDisabled] = React.useState(false);
  const [busy, setBusy] = React.useState<Record<string, string>>({}); // id → verb
  const [rejecting, setRejecting] = React.useState<ActionProposal | null>(null);
  const [auditRef, setAuditRef] = React.useState<string | null>(null);
  // Tokens held in memory after approve for a within-session execute retry when
  // the Act seam is momentarily unavailable. Never persisted.
  const tokens = React.useRef<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const list = await listPending();
      setProposals(list);
      setDisabled(false);
    } catch (e) {
      if (e instanceof ActionAPIError && (e.status === 404 || e.status === 501)) {
        setDisabled(true);
        setProposals([]);
        return;
      }
      setError(errMessage(e, "Could not load action proposals."));
      setProposals([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setRowBusy = (id: string, verb: string | null) =>
    setBusy((b) => {
      const next = { ...b };
      if (verb) next[id] = verb;
      else delete next[id];
      return next;
    });

  const replace = (p: ActionProposal) =>
    setProposals((cur) => (cur ? cur.map((x) => (x.id === p.id ? p : x)) : cur));

  // Approve then immediately execute with the freshly issued token. If the Act
  // seam is unavailable the proposal stays approved and the token is kept for a
  // manual retry.
  async function approveAndExecute(p: ActionProposal) {
    setRowBusy(p.id, "approve");
    setError(null);
    try {
      const res = await approve(p.id);
      tokens.current[p.id] = res.token;
      capture(ActionEvents.ProposalApproved, { kind: p.kind, financial: p.financial });
      replace(res.proposal);
      await runExecute(p.id, res.token, p.kind);
    } catch (e) {
      if (e instanceof ActionAPIError && e.code === "step_up_required") {
        setError(
          "This financial action needs recent re-authentication. Sign in again, then approve.",
        );
      } else {
        setError(errMessage(e, "Could not approve the action."));
      }
      void load();
    } finally {
      setRowBusy(p.id, null);
    }
  }

  async function runExecute(id: string, token: string, kind: string) {
    setRowBusy(id, "execute");
    try {
      const done = await execute(id, token);
      delete tokens.current[id];
      capture(ActionEvents.ProposalExecuted, { kind, status: done.status });
      replace(done);
    } catch (e) {
      if (e instanceof ActionAPIError && e.code === "execution_unavailable") {
        setError(
          "Approved, but no execution backend is configured yet. The approval is held — retry execute once the product Act seam is connected.",
        );
      } else {
        setError(errMessage(e, "Execution failed."));
      }
      void load();
    } finally {
      setRowBusy(id, null);
    }
  }

  async function doReject(reason: string) {
    const p = rejecting;
    if (!p) return;
    setRejecting(null);
    setRowBusy(p.id, "reject");
    try {
      const done = await reject(p.id, reason);
      capture(ActionEvents.ProposalRejected, { kind: p.kind });
      replace(done);
    } catch (e) {
      setError(errMessage(e, "Could not reject the action."));
    } finally {
      setRowBusy(p.id, null);
    }
  }

  const openAudit = (ref: string) => {
    capture(ActionEvents.AuditViewed, {});
    setAuditRef(ref);
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium text-primary">Actions</h1>
          <p className="mt-0.5 text-sm text-primary/60">
            Closed-loop finance actions your agents propose. Approve one to issue a single-use,
            scoped token and execute it against the product — money never moves without it.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
          <ArrowClockwise weight="bold" /> Refresh
        </Button>
      </header>

      {error ? (
        <div className="flex items-start gap-2 rounded-[2px] border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <WarningCircle weight="fill" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {proposals === null ? (
        <ListSkeleton rows={3} />
      ) : disabled ? (
        <EmptyBlock
          icon={<ListChecks className="size-6" />}
          title="Closed-loop actions are not enabled"
          body="The action broker ships dark. Once ACTIONS_ENABLED is turned on for your workspace, proposals your agents make will appear here for approval."
        />
      ) : proposals.length === 0 ? (
        <EmptyBlock
          icon={<ListChecks className="size-6" />}
          title="No pending actions"
          body="When an agent proposes a finance action — advancing a dunning step, marking a dispute — it lands here for your approval."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((p) => {
            const verb = busy[p.id];
            const heldToken = tokens.current[p.id];
            return (
              <li
                key={p.id}
                className="flex flex-col gap-3 rounded-[2px] border border-border bg-background p-4 dark:bg-background-50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Ref>{p.kind}</Ref>
                  {p.financial ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
                    >
                      <CurrencyDollar weight="fill" /> Financial
                    </Badge>
                  ) : null}
                  <StatusBadge status={p.status} />
                  <span className="ml-auto text-xs text-primary/45">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-sm text-primary/70">
                  <Receipt weight="fill" className="shrink-0 text-primary/40" />
                  <Ref>{p.target}</Ref>
                </div>

                {p.rationale ? <p className="text-sm text-primary/70">{p.rationale}</p> : null}

                {p.paramsJson ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none text-primary/50 hover:text-primary/70">
                      Parameters
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded-[2px] bg-background-200 p-2 font-mono text-[11px] text-primary/70 dark:bg-background-100">
                      {prettyParams(p.paramsJson)}
                    </pre>
                  </details>
                ) : null}

                {p.status === "executed" || p.status === "executed_unconfirmed" ? (
                  <ExecutedNote proposal={p} />
                ) : null}
                {p.status === "failed" && p.reason ? (
                  <p className="text-xs text-red-600 dark:text-red-400">{p.reason}</p>
                ) : null}
                {p.status === "rejected" && p.reason ? (
                  <p className="text-xs text-primary/50">Rejected: {p.reason}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  {p.status === "pending" ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => void approveAndExecute(p)}
                        disabled={!!verb}
                        className="gap-1.5"
                      >
                        {verb ? (
                          <CircleNotch className="animate-spin" />
                        ) : (
                          <ShieldCheck weight="fill" />
                        )}
                        {verb === "approve"
                          ? "Approving…"
                          : verb === "execute"
                            ? "Executing…"
                            : "Approve & execute"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRejecting(p)}
                        disabled={!!verb}
                        className="gap-1.5 text-primary/60"
                      >
                        <Prohibit weight="fill" /> Reject
                      </Button>
                    </>
                  ) : null}
                  {p.status === "approved" ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        heldToken
                          ? void runExecute(p.id, heldToken, p.kind)
                          : setError(
                              "This approval's token is no longer in this session. Reject and re-propose.",
                            )
                      }
                      disabled={!!verb || !heldToken}
                      className="gap-1.5"
                    >
                      {verb === "execute" ? (
                        <CircleNotch className="animate-spin" />
                      ) : (
                        <CheckCircle weight="fill" />
                      )}
                      Execute
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openAudit(p.target)}
                    className="ml-auto gap-1.5 text-primary/60"
                  >
                    <ListChecks weight="fill" /> Audit trail
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RejectDialog proposal={rejecting} onCancel={() => setRejecting(null)} onConfirm={doReject} />
      {auditRef ? (
        <ActionAuditSheet resourceRef={auditRef} onClose={() => setAuditRef(null)} />
      ) : null}
    </div>
  );
}

function ExecutedNote({ proposal }: { proposal: ActionProposal }) {
  return (
    <div className="flex flex-col gap-1 rounded-[2px] border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle weight="fill" />
        {proposal.resolvedAt
          ? "Loop closed — the product confirmed the change."
          : "Executed — awaiting the product's return event to close the loop."}
      </span>
      {proposal.resultRef ? <Ref>{proposal.resultRef}</Ref> : null}
    </div>
  );
}

function RejectDialog({
  proposal,
  onCancel,
  onConfirm,
}: {
  proposal: ActionProposal | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => setReason(""), [proposal]);
  return (
    <Dialog open={!!proposal} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this action</DialogTitle>
          <DialogDescription>
            The proposal is discarded. Add a short reason for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being rejected?"
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim())}>
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function prettyParams(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
