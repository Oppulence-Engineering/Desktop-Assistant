import { useCallback, useEffect, useState } from "react";
import { AudioLines, Loader2, Mic, RotateCcw, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  MeetingCaptureStatus,
  MeetingDoctorReport,
  MeetingSessionSummary,
  MeetingTrackId,
  MeetingTranscriptionProgress,
} from "@x/shared/dist/meetings.js";

/**
 * Live state for native dual-track capture: what is being recorded right now, what is
 * transcribing, and what already exists on disk.
 *
 * Existing meeting notes are listed separately from the workspace; this shows the
 * *capture* side, which is the part with failure modes worth surfacing — a track that
 * recorded silence, a permission that was never granted, a transcript that failed and
 * can be retried. Renders nothing at all when native capture is unavailable, so the
 * in-app pipeline's UI is unchanged.
 */

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const TRACK_LABEL: Record<MeetingTrackId, string> = { mic: "You", system: "Them" };

/** A peak meter. Its real job is proving capture is alive: a bar that never moves for
 *  a whole meeting is a track recording digital silence. */
function LevelBar({ track, peak }: { track: MeetingTrackId; peak: number }) {
  // Perceptual rather than linear — a linear bar barely moves for normal speech.
  const width = Math.min(100, Math.round(Math.sqrt(Math.max(0, peak)) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {TRACK_LABEL[track]}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-none bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-100",
            width > 0 ? "bg-primary" : "bg-muted",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function MeetingCaptureStrip() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<MeetingCaptureStatus | null>(null);
  const [levels, setLevels] = useState<Partial<Record<MeetingTrackId, number>>>({});
  const [progress, setProgress] = useState<MeetingTranscriptionProgress | null>(null);
  const [doctor, setDoctor] = useState<MeetingDoctorReport | null>(null);
  const [sessions, setSessions] = useState<MeetingSessionSummary[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const { sessions: list } = await window.ipc.invoke("meeting:listSessions", null);
      setSessions(list);
    } catch {
      /* nothing to show */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void window.ipc
      .invoke("meeting:captureEngine", null)
      .then(async ({ engine }) => {
        if (cancelled) return;
        setAvailable(engine === "native");
        if (engine !== "native") return;
        const [nextStatus, nextDoctor] = await Promise.all([
          window.ipc.invoke("meeting:captureStatus", null),
          // No probe: checking system-audio access means requesting it, and mounting a
          // view is not a user asking for a permission dialog.
          window.ipc.invoke("meeting:captureDoctor", { probeSystemAudio: false }),
        ]);
        if (cancelled) return;
        setStatus(nextStatus);
        setDoctor(nextDoctor);
        void refreshSessions();
      })
      .catch(() => setAvailable(false));

    const offState = window.ipc.on("meeting:captureState", (next) => {
      if (cancelled) return;
      setStatus(next);
      if (next.state !== "recording") setLevels({});
    });
    const offLevel = window.ipc.on("meeting:captureLevel", (next) => {
      if (!cancelled) setLevels(next.peaks as Partial<Record<MeetingTrackId, number>>);
    });
    const offProgress = window.ipc.on("meeting:captureProgress", (next) => {
      if (cancelled) return;
      setProgress(next.phase === "done" || next.phase === "failed" ? null : next);
      // A finished job changes both the transcript and whether audio still exists.
      if (next.phase === "done" || next.phase === "failed") void refreshSessions();
    });

    return () => {
      cancelled = true;
      offState?.();
      offLevel?.();
      offProgress?.();
    };
  }, [refreshSessions]);

  // Tick locally rather than pushing a status event every second from main.
  useEffect(() => {
    if (status?.state !== "recording" || !status.startedAt) {
      setElapsed(0);
      return;
    }
    const startedAt = new Date(status.startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [status?.state, status?.startedAt]);

  const retranscribe = useCallback(
    async (sessionId: string) => {
      setRetrying(sessionId);
      try {
        const result = await window.ipc.invoke("meeting:retranscribe", { sessionId });
        if (!result.queued) console.warn(`[meeting] cannot re-transcribe: ${result.error}`);
      } finally {
        setRetrying(null);
        void refreshSessions();
      }
    },
    [refreshSessions],
  );

  if (available !== true) return null;

  const recording = status?.state === "recording";
  const micOnly = recording && !status.tracks.includes("system");
  const failures = doctor?.checks.filter((check) => check.status === "fail") ?? [];
  const untranscribed = sessions.filter((s) => !s.transcribed);
  const silentTracks = sessions
    .slice(0, 5)
    .filter((s) => s.tracks.some((t) => t.silent) && s.transcribed);

  // Nothing to say: idle, healthy, nothing queued, nothing odd on disk.
  if (
    !recording &&
    !progress &&
    failures.length === 0 &&
    untranscribed.length === 0 &&
    silentTracks.length === 0
  ) {
    return null;
  }

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-6 py-3 text-sm">
      {recording && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            <span className="font-medium text-foreground">Recording</span>
            <span className="tabular-nums text-muted-foreground">{clock(elapsed)}</span>
            <span className="text-xs text-muted-foreground">
              · on this device, both sides on separate tracks
            </span>
          </div>
          <div className="max-w-sm space-y-1">
            {(status.tracks.length > 0 ? status.tracks : (["mic"] as MeetingTrackId[])).map(
              (track) => (
                <LevelBar key={track} track={track} peak={levels[track] ?? 0} />
              ),
            )}
          </div>
          {micOnly && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              Microphone only — system audio was not captured, so the other side of this call will
              not be transcribed.
            </p>
          )}
        </div>
      )}

      {progress && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>
            Transcribing {progress.sessionId}
            {progress.queueDepth > 1 ? ` · ${progress.queueDepth - 1} queued` : ""}
            {progress.fraction != null ? ` · ${Math.round(progress.fraction * 100)}%` : ""}
          </span>
        </div>
      )}

      {!recording &&
        failures.map((check) => (
          <p
            key={check.name}
            className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500"
          >
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="font-medium">{check.name}:</strong> {check.detail}
              {check.remediation ? ` — ${check.remediation}` : ""}
            </span>
          </p>
        ))}

      {!progress && untranscribed.length > 0 && (
        <div className="mt-1 space-y-1">
          {untranscribed.slice(0, 3).map((session) => (
            <div key={session.id} className="flex items-center gap-2 text-xs">
              <AudioLines className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                {session.id} · {clock(session.durationSeconds)} not transcribed
                {session.error ? ` — ${session.error}` : ""}
              </span>
              {session.hasAudio && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={retrying === session.id}
                  onClick={() => void retranscribe(session.id)}
                >
                  {retrying === session.id ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 size-3" />
                  )}
                  Retry
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!recording &&
        silentTracks.slice(0, 2).map((session) => (
          <p
            key={session.id}
            className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <Mic className="mt-0.5 size-3.5 shrink-0" />
            {session.id} recorded{" "}
            {session.tracks
              .filter((t) => t.silent)
              .map((t) => TRACK_LABEL[t.id])
              .join(" and ")}{" "}
            as silence — check the input device and the Screen &amp; System Audio Recording
            permission before the next call.
          </p>
        ))}
    </div>
  );
}
