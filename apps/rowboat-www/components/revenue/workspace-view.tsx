"use client";

import * as React from "react";
import { CircleNotch, LinkSimple, Plugs, ShieldCheck } from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { linkWorkspace, relativeTime, RevenueAPIError } from "@/lib/revenue";
import { Field, errMessage } from "@/components/revenue/shared";
import { capture, RevenueEvents } from "@/lib/analytics";
import type { RevenueWorkspace } from "@/types/revenue";

export function WorkspaceView({
  workspace,
  onLinked,
  onError,
  onNotice,
  onOpenConnectors,
}: {
  workspace: RevenueWorkspace | null;
  onLinked: (ws: RevenueWorkspace) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onOpenConnectors?: () => void;
}) {
  const [orgId, setOrgId] = React.useState("");
  const [wsId, setWsId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (!workspace) return <p className="text-sm text-primary/50">Loading workspace…</p>;

  const linked = workspace.mode === "linked" && workspace.status === "active";

  const submit = async () => {
    if (!wsId.trim()) return;
    setBusy(true);
    onError("");
    try {
      const ws = await linkWorkspace({
        outboundWorkspaceId: wsId.trim(),
        outboundOrganizationId: orgId.trim() || undefined,
      });
      onLinked(ws);
      capture(RevenueEvents.WorkspaceLinked);
      onNotice("Workspace linked — governed sending is now enabled.");
    } catch (e) {
      onError(
        e instanceof RevenueAPIError && e.code === "facade_unavailable"
          ? "Policy preflight isn't configured on the server yet, so linking can't be completed. Drafting still works in local mode."
          : errMessage(e, "Could not link the workspace."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* status card */}
      <section className="rounded-[2px] border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-primary">Workspace</span>
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs " +
              (linked
                ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "border-border text-primary/55")
            }
          >
            <span
              className={"size-1.5 rounded-full " + (linked ? "bg-emerald-500" : "bg-primary/30")}
            />
            {linked ? "Linked" : "Local mode"}
          </span>
        </div>
        <dl className="divide-y divide-primary/10 text-sm">
          <Row label="Mode" value={workspace.mode} />
          <Row label="Status" value={workspace.status} />
          <Row
            label="Preflight"
            value={workspace.preflightAvailable ? "Available" : "Unavailable (drafts only)"}
          />
          {workspace.outboundOrganizationId ? (
            <Row label="Organization" value={workspace.outboundOrganizationId} mono />
          ) : null}
          {workspace.outboundWorkspaceId ? (
            <Row label="OutboundConsole workspace" value={workspace.outboundWorkspaceId} mono />
          ) : null}
          {workspace.lastVerifiedAt ? (
            <Row label="Last verified" value={relativeTime(workspace.lastVerifiedAt)} />
          ) : null}
        </dl>
      </section>

      {/* what local vs linked means */}
      {linked ? (
        <Alert>
          <ShieldCheck weight="fill" />
          <AlertTitle>Governed sending is on</AlertTitle>
          <AlertDescription>
            Sends run through OutboundConsole policy preflight — suppression, verification, and
            ownership are checked before anything leaves.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert>
            <Plugs weight="fill" />
            <AlertTitle>Local mode</AlertTitle>
            <AlertDescription>
              Observation, scans, and draft-first execution all work. Sending is disabled until you
              link a governed OutboundConsole workspace — drafts land in your own Gmail so you can
              send them yourself.
            </AlertDescription>
          </Alert>

          <section className="rounded-[2px] border border-border p-4">
            <h3 className="text-sm font-medium text-primary">Link a governed workspace</h3>
            <p className="mt-1 text-sm text-primary/60">
              Connect an OutboundConsole workspace to turn on policy-checked sending.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Field label="OutboundConsole workspace ID">
                <Input value={wsId} onChange={(e) => setWsId(e.target.value)} placeholder="ws_…" />
              </Field>
              <Field label="Organization ID (optional)">
                <Input
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder="org_…"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submit} disabled={busy || !wsId.trim()}>
                  {busy ? <CircleNotch className="animate-spin" /> : <LinkSimple />} Link workspace
                </Button>
                {onOpenConnectors ? (
                  <Button variant="ghost" size="sm" onClick={onOpenConnectors}>
                    Manage connectors
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-primary/55">{label}</dt>
      <dd className={mono ? "font-mono text-xs text-primary/70" : "capitalize text-primary/80"}>
        {value}
      </dd>
    </div>
  );
}
