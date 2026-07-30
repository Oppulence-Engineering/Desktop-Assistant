import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, RotateCcw, Trash2, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

export function MeetingRecordings({ onOpenNote }: { onOpenNote?: (path: string) => void }) {
  const [sessions, setSessions] = useState<MeetingSessionSummary[]>([]);
  const [busy, setBusy] = useState<Record<string, RowState>>({});
  const [pendingDelete, setPendingDelete] = useState<MeetingSessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { sessions: list } = await window.ipc.invoke("meeting:listSessions", null);
      setSessions(list);
    } catch {
      // Native capture unavailable — there is nothing to list, which is not an error.
      setSessions([]);
    }
  }, []);

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
      const { deleted } = await window.ipc.invoke("meeting:deleteSession", {
        sessionId: session.id,
      });
      if (!deleted) setError("Could not delete this recording — it may still be recording.");
    } finally {
      setRow(session.id, { deleting: false });
      void refresh();
    }
  }, [pendingDelete, refresh, setRow]);

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
          return (
            <div
              key={session.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-sm",
                index > 0 && "border-t border-border/60",
              )}
            >
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
                onClick={() => setPendingDelete(session)}
              >
                {row?.deleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
              </Button>
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
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
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
