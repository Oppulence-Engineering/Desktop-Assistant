"use client";

import * as React from "react";
import { AddressBook, CircleNotch, Plus } from "@phosphor-icons/react";

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ACTION_TYPE_LABELS,
  createRelationship,
  DETECTOR_LABELS,
  getRelationship,
  listRelationships,
  RELATIONSHIP_KIND_LABELS,
  relativeTime,
} from "@/lib/revenue";
import { EmptyBlock, errMessage, ListSkeleton, ModeChip } from "@/components/revenue/shared";
import type { RelationshipDetail, RevenueRelationship } from "@/types/revenue";

const KIND_OPTIONS = ["person", "company", "customer", "opportunity", "referral", "partner"];

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  dormant: "border-amber-500/30 text-amber-600 dark:text-amber-400",
  closed: "text-primary/45",
  archived: "text-primary/45",
};

export function RelationshipsView({
  onError,
  onNotice,
}: {
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [rows, setRows] = React.useState<RevenueRelationship[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listRelationships());
    } catch (e) {
      onError(errMessage(e, "Could not load relationships."));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-primary/45">{rows.length} relationships</span>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus /> New relationship
        </Button>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyBlock
          icon={<AddressBook className="size-6" />}
          title="No relationships yet"
          body="A leak scan creates these automatically from your sent mail, or add one by hand."
        >
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add relationship
          </Button>
        </EmptyBlock>
      ) : (
        <ul className="flex flex-col divide-y divide-primary/10 rounded-[2px] border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setDetail(r.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background-100/60 dark:hover:bg-background-100/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-primary">
                      {r.displayName}
                    </span>
                    <Badge variant="outline" className="rounded-[2px] font-normal">
                      {RELATIONSHIP_KIND_LABELS[r.kind] ?? r.kind}
                    </Badge>
                  </div>
                  {r.primaryEmail ? (
                    <span className="text-xs text-primary/45">{r.primaryEmail}</span>
                  ) : null}
                </div>
                {r.openActions ? (
                  <Badge variant="secondary" className="shrink-0">
                    {r.openActions} open
                  </Badge>
                ) : null}
                <span
                  className={
                    "hidden shrink-0 rounded-full border px-2 py-0.5 text-xs sm:inline " +
                    (STATUS_TONE[r.status] ?? "text-primary/45")
                  }
                >
                  {r.status}
                </span>
                {r.lastTouchAt ? (
                  <span className="hidden shrink-0 text-xs text-primary/40 md:inline">
                    {relativeTime(r.lastTouchAt)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <RelationshipSheet id={detail} onClose={() => setDetail(null)} onError={onError} />
      ) : null}

      {creating ? (
        <CreateRelationshipDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onNotice("Relationship added.");
            void load();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function RelationshipSheet({
  id,
  onClose,
  onError,
}: {
  id: string;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [data, setData] = React.useState<RelationshipDetail | null>(null);

  React.useEffect(() => {
    void getRelationship(id)
      .then(setData)
      .catch((e) => onError(errMessage(e, "Could not load the relationship.")));
  }, [id, onError]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{data?.relationship.displayName ?? "Relationship"}</SheetTitle>
          <SheetDescription>
            {data?.relationship.primaryEmail}
            {data?.relationship.accountDomain ? ` · ${data.relationship.accountDomain}` : ""}
          </SheetDescription>
        </SheetHeader>
        {!data ? (
          <p className="px-4 py-6 text-sm text-primary/50">Loading…</p>
        ) : (
          <div className="flex flex-col gap-5 px-4 py-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-[2px]">
                {RELATIONSHIP_KIND_LABELS[data.relationship.kind] ?? data.relationship.kind}
              </Badge>
              <Badge variant="secondary">{data.relationship.status}</Badge>
            </div>
            {data.relationship.summary ? (
              <p className="text-sm text-primary/70">{data.relationship.summary}</p>
            ) : null}
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-primary/45">
                Actions ({data.actions.length})
              </h3>
              {data.actions.length === 0 ? (
                <p className="text-xs text-primary/45">No queue actions for this relationship.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.actions.map((a) => (
                    <li key={a.id} className="rounded-[2px] border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-primary">
                          {ACTION_TYPE_LABELS[a.actionType] ?? a.actionType}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <ModeChip mode={a.executionMode} />
                          <Badge variant="secondary" className="font-normal">
                            {a.queueStatus}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-primary/55">{a.reason}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-primary/40">
                        <span>{DETECTOR_LABELS[a.detector] ?? a.detector}</span>
                        <span>· priority {a.priorityScore}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateRelationshipDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [kind, setKind] = React.useState("person");
  const [displayName, setDisplayName] = React.useState("");
  const [primaryEmail, setPrimaryEmail] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!displayName.trim()) return;
    setBusy(true);
    onError("");
    try {
      await createRelationship({
        kind,
        displayName: displayName.trim(),
        primaryEmail: primaryEmail.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      onCreated();
    } catch (e) {
      onError(errMessage(e, "Could not create the relationship."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New relationship</DialogTitle>
          <DialogDescription>Track a contact, account, or opportunity by hand.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-[2px]">
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k} value={k}>
                  {RELATIONSHIP_KIND_LABELS[k] ?? k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name"
          />
          <Input
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
            placeholder="Email (optional)"
          />
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary (optional)"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !displayName.trim()}>
            {busy ? <CircleNotch className="animate-spin" /> : <Plus />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
