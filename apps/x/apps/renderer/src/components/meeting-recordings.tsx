import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, RotateCcw, Trash2, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@oppulence/ui/components/alert-dialog";
import { cn } from "@/lib/utils";
import type { MeetingSessionSummary } from "@x/shared/dist/meetings.js";

/**
 * The recordings behind the notes: what is on disk, what state it is in, and the two
 * things a user needs to be able to do with it — transcribe it again, or delete it.
 *
 * Separate from the meeting-notes table above it because they are different objects.
 * A note is the artifact you keep; a recording is the audio it came from, which may
 * have been compressed or already deleted by the retention setting. Showing that
 * plainly is the point: "no audio" should read as "retention removed it", not as
 * something broken.
 *
 * Renders nothing when there are no recordings, so the in-app capture path is unchanged.
 */

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface RowState {
  retrying: boolean;
  deleting: boolean;
}

const DEFAULT_ROW: RowState = { retrying: false, deleting: false };

/** One organization a multi-org meeting could belong to. */
type AccountCandidate = {
  accountDomain: string;
  displayName: string;
  participantCount: number;
  participants: { displayName: string; email?: string }[];
};

export function MeetingRecordings({ onOpenNote }: { onOpenNote?: (path: string) => void }) {
  const [sessions, setSessions] = useState<MeetingSessionSummary[]>([]);
  const [busy, setBusy] = useState<Record<string, RowState>>({});
  const [pendingDelete, setPendingDelete] = useState<MeetingSessionSummary | null>(null);
  // Opt-in, and reset every time the dialog opens: "also delete the note" should never
  // be sticky from a previous deletion.
  const [alsoDeleteNote, setAlsoDeleteNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Meetings whose invite spanned two organizations. The app deliberately refuses
   * to guess which account they belong to, so nothing was published and the
   * question is asked here instead.
   */
  const [accountQuestions, setAccountQuestions] = useState<Record<string, AccountCandidate[]>>({});
  const [answering, setAnswering] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const { sessions: list } = await window.ipc.invoke("meeting:listSessions", null);
      setSessions(list);
      const questions: Record<string, AccountCandidate[]> = {};
      await Promise.all(
        list.map(async (session) => {
          try {
            const result = await window.ipc.invoke("meeting:relationshipCandidates", {
              sessionId: session.id,
            });
            if (!result.resolved && result.candidates.length > 0) {
              questions[session.id] = result.candidates;
            }
          } catch {
            // A missing candidates file is the normal case, not an error.
          }
        }),
      );
      setAccountQuestions(questions);
    } catch {
      // Native capture unavailable — there is nothing to list, which is not an error.
      setSessions([]);
    }
  }, []);

  /**
   * Attach a recording to the account the user picked.
   *
   * Resolves the domain to a real relationship first: the publish path takes a
   * relationship id, and binding by domain alone is exactly the guess this prompt
   * exists to avoid.
   */
  const answerAccount = useCallback(
    async (sessionId: string, candidate: AccountCandidate) => {
      setAnswering((current) => ({ ...current, [sessionId]: true }));
      setError(null);
      try {
        const { relationships } = await window.ipc.invoke("relationships:list", {
          q: candidate.accountDomain,
        });
        const match =
          relationships.find((item) => item.accountDomain === candidate.accountDomain) ??
          relationships[0];
        if (!match) {
          setError(
            `No account matches ${candidate.accountDomain} yet. Create it in Relationships, then attach this recording.`,
          );
          return;
        }
        const result = await window.ipc.invoke("meeting:publishSessionEvidence", {
          sessionId,
          relationshipTarget: {
            relationshipId: match.id,
            displayName: match.displayName,
            ...(match.primaryEmail ? { primaryEmail: match.primaryEmail } : {}),
            ...(match.accountDomain ? { accountDomain: match.accountDomain } : {}),
          },
        });
        if (!result.queued) {
          setError(result.reason ?? "The recording could not be attached.");
          return;
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "The recording could not be attached.");
      } finally {
        setAnswering((current) => ({ ...current, [sessionId]: false }));
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    // A finished job changes both the transcript and whether audio still exists.
    const off = window.ipc.on("meeting:captureProgress", (progress) => {
      if (progress.phase === "done" || progress.phase === "failed") void refresh();
    });
    const offState = window.ipc.on("meeting:captureState", (status) => {
      if (status.state === "idle") void refresh();
    });
    return () => {
      off?.();
      offState?.();
    };
  }, [refresh]);

  const setRow = useCallback((id: string, patch: Partial<RowState>) => {
    setBusy((current) => ({
      ...current,
      [id]: { ...DEFAULT_ROW, ...current[id], ...patch },
    }));
  }, []);

  const retranscribe = useCallback(
    async (session: MeetingSessionSummary) => {
      setError(null);
      setRow(session.id, { retrying: true });
      try {
        const result = await window.ipc.invoke("meeting:retranscribe", { sessionId: session.id });
        // Surfaced rather than logged: "audio was deleted by your retention setting" is
        // the answer to why the button did nothing.
        if (!result.queued) setError(result.error ?? "Could not re-transcribe this recording.");
      } finally {
        setRow(session.id, { retrying: false });
        void refresh();
      }
    },
    [refresh, setRow],
  );

  const confirmDelete = useCallback(async () => {
    const session = pendingDelete;
    if (!session) return;
    setPendingDelete(null);
    setError(null);
    setRow(session.id, { deleting: true });
    try {
      const { deleted, noteDeleted, sharedEvidence } = await window.ipc.invoke(
        "meeting:deleteSession",
        {
          sessionId: session.id,
          deleteNote: alsoDeleteNote,
        },
      );
      if (!deleted) {
        setError("Could not delete this recording — it may still be recording.");
      } else if (alsoDeleteNote && !noteDeleted) {
        // The recording is gone but the note is not; say so rather than implying both.
        setError("The recording was deleted, but its note could not be found.");
      } else if (sharedEvidence === "retained_by_workspace_policy") {
        setError(
          "The local recording was deleted. Published relationship evidence remains under the workspace retention policy; delete conversation data from Account Mission Control if it must also be removed.",
        );
      }
    } finally {
      setRow(session.id, { deleting: false });
      void refresh();
    }
  }, [alsoDeleteNote, pendingDelete, refresh, setRow]);

  const openDeleteDialog = useCallback((session: MeetingSessionSummary) => {
    setAlsoDeleteNote(false);
    setPendingDelete(session);
  }, []);

  if (sessions.length === 0) return null;

  return (
    <div className="px-6 pb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recordings
        </h3>
        <span className="text-xs text-muted-foreground">on this device</span>
      </div>

      {error && (
        <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-none border border-border/60 bg-card">
        {sessions.map((session, index) => {
          const row = busy[session.id];
          const silentTracks = session.tracks.filter((track) => track.silent);
          const question = accountQuestions[session.id];
          return (
            <div
              key={session.id}
              className={cn(index > 0 && "border-t border-border/60")}
            >
            <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Mic className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{startedLabel(session.startedAt)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {clock(session.durationSeconds)}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {session.transcribed
                    ? `${session.segmentCount ?? 0} segments`
                    : (session.error ?? "not transcribed")}
                  {session.hasAudio ? " · audio kept" : " · audio removed"}
                  {silentTracks.length > 0 &&
                    ` · ${silentTracks.map((t) => t.id).join(" and ")} recorded silence`}
                </div>
              </div>

              {session.notePath && onOpenNote && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onOpenNote(session.notePath!)}
                >
                  Open note
                </Button>
              )}
              {session.hasAudio && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  disabled={row?.retrying || row?.deleting}
                  onClick={() => void retranscribe(session)}
                >
                  {row?.retrying ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 size-3" />
                  )}
                  Transcribe again
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Delete recording from ${startedLabel(session.startedAt)}`}
                className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                disabled={row?.deleting || row?.retrying}
                onClick={() => openDeleteDialog(session)}
              >
                {row?.deleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
              </Button>
            </div>

            {question && (
              <div className="border-t border-dashed border-border/60 bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground">
                  People from{" "}
                  <span className="font-medium text-foreground">
                    {question.map((candidate) => candidate.accountDomain).join(" and ")}
                  </span>{" "}
                  were on this call. Which account is it? Nothing was published until
                  you say.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {question.map((candidate) => (
                    <Button
                      key={candidate.accountDomain}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={answering[session.id]}
                      onClick={() => void answerAccount(session.id, candidate)}
                    >
                      {answering[session.id] && (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      )}
                      {candidate.displayName}
                      <span className="ml-1 text-muted-foreground">
                        ({candidate.participantCount})
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPendingDelete(null);
          // Never sticky: "also delete the note" has to be chosen again each time.
          setAlsoDeleteNote(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  The recording from {startedLabel(pendingDelete.startedAt)} and its transcript will
                  be removed from this device. This cannot be undone.
                  {pendingDelete.notePath ? " The meeting note stays in your workspace." : ""}
                  {pendingDelete.relationshipTarget
                    ? ` Published evidence for ${pendingDelete.relationshipTarget.displayName} remains under the workspace retention policy and can be deleted from Account Mission Control.`
                    : ""}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelete?.notePath && (
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={alsoDeleteNote}
                onCheckedChange={(checked) => setAlsoDeleteNote(checked === true)}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                Also delete the meeting note. It moves to the trash, so this one is recoverable.
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
