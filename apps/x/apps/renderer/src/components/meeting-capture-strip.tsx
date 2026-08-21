import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { MeetingCaptureCheck } from "@/components/meeting-capture-check";
import { cn } from "@/lib/utils";
import { findMicrophoneBlocker } from "@/lib/meeting-readiness";
import type {
  MeetingCaptureStatus,
  MeetingDoctorReport,
  MeetingSessionSummary,
  MeetingTrackId,
  MeetingTranscriptionProgress,
} from "@x/shared/meetings";

/**
 * Live state for native dual-track capture: what is being recorded right now, what is
 * transcribing, and what already exists on disk.
 *
 * Ambient state only: what is happening right now and what needs attention. Per-session
 * actions live in the recordings list below, so a session is not offered a Retry button
 * in two places at once. Renders nothing when native capture is unavailable, so the
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

export function MeetingCaptureStrip({
  onReadinessChange,
}: {
  onReadinessChange?: (microphoneBlocker: MeetingDoctorReport["checks"][number] | null) => void;
} = {}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<MeetingCaptureStatus | null>(null);
  const [levels, setLevels] = useState<Partial<Record<MeetingTrackId, number>>>({});
  const [progress, setProgress] = useState<MeetingTranscriptionProgress | null>(null);
  const [doctor, setDoctor] = useState<MeetingDoctorReport | null>(null);
  const [sessions, setSessions] = useState<MeetingSessionSummary[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // The 10-second dual-track proof, offered once. `null` while unknown, so the prompt
  // never flashes on mount before the flag has been read.
  const [checkDone, setCheckDone] = useState<boolean | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);

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
        // Read last: an unreadable flag should offer the check again, not block the rest
        // of the strip from rendering.
        try {
          const ui = await window.ipc.invoke("ui:getState", null);
          if (!cancelled) setCheckDone(ui.meetingCaptureCheckDone);
        } catch {
          if (!cancelled) setCheckDone(true);
        }
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

  useEffect(() => {
    const microphoneBlocker = doctor ? findMicrophoneBlocker(doctor.checks) : null;
    onReadinessChange?.(microphoneBlocker);
  }, [doctor, onReadinessChange]);

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

  if (available !== true) return null;

  const recording = status?.state === "recording";
  const standby = status?.state === "standby";
  const micOnly = recording && !status.tracks.includes("system");
  const failures = doctor?.checks.filter((check) => check.status === "fail") ?? [];
  const untranscribed = sessions.filter((s) => !s.transcribed);
  const silentTracks = sessions
    .slice(0, 5)
    .filter((s) => s.tracks.some((t) => t.silent) && s.transcribed);
  const captureProblem =
    status?.captureHealth?.activeEvents.find((event) => event.severity === "critical") ??
    status?.captureHealth?.activeEvents[0];

  // Offer the setup check once, and only when idle — interrupting a live recording to
  // suggest a test recording would be absurd.
  const offerCheck = checkDone === false && !recording && !standby && !progress;

  // Nothing to say: idle, healthy, nothing queued, nothing odd on disk.
  if (
    !recording &&
    !standby &&
    !progress &&
    !offerCheck &&
    failures.length === 0 &&
    untranscribed.length === 0 &&
    silentTracks.length === 0
  ) {
    return null;
  }

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-6 py-3 text-sm">
      {offerCheck && (
        <div className="flex items-center gap-3">
          <Mic className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">See what gets captured</p>
            <p className="text-xs text-muted-foreground">
              Ten seconds, on this device, showing your voice and the call&apos;s audio on separate
              tracks.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setCheckOpen(true)}>
            Run the check
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCheckDone(true);
              void window.ipc
                .invoke("ui:setState", { meetingCaptureCheckDone: true })
                .catch(() => {});
            }}
          >
            Not now
          </Button>
        </div>
      )}

      <MeetingCaptureCheck
        open={checkOpen}
        onOpenChange={(next) => {
          setCheckOpen(next);
          // The dialog persists the flag itself; mirror it so the prompt goes away
          // without waiting for a remount.
          if (!next) setCheckDone(true);
        }}
      />

      {standby && status && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {/* Hollow amber, not a red dot with different words — the difference between
                listening and keeping has to read before the text does. */}
            <span className="size-2.5 rounded-full border-2 border-amber-500" />
            <span className="font-medium text-foreground">Standing by</span>
            <span className="text-xs text-muted-foreground">
              · listening, writing nothing · press record to keep the last{" "}
              {Math.max(1, Math.round((status.standbySeconds || 300) / 60))} minutes
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void window.ipc.invoke("meeting:beginRecording", null)}
              >
                Record
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void window.ipc.invoke("meeting:stopCapture", null)}
              >
                Stop
              </Button>
            </div>
          </div>
          <div className="max-w-sm space-y-1">
            {(status.tracks.length > 0 ? status.tracks : (["mic"] as MeetingTrackId[])).map(
              (track) => (
                <LevelBar key={track} track={track} peak={levels[track] ?? 0} />
              ),
            )}
          </div>
        </div>
      )}

      {/* Whatever the recorder itself has said about this session. Without this a
          sidecar error is logged to a console nobody reads, and a user who pressed
          Record and got nothing has no way to find out why. */}
      {(recording || standby) && (status?.warnings.length ?? 0) > 0 && (
        <ul className="mb-2 space-y-0.5">
          {status!.warnings.slice(-3).map((warning, index) => (
            <li
              key={index}
              className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {(recording || standby) && captureProblem && (
        <div
          className={cn(
            "mb-2 flex items-start gap-2 border px-3 py-2 text-xs",
            captureProblem.severity === "critical"
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
          role="status"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="font-medium">{captureProblem.kind.replaceAll("_", " ")}:</strong>{" "}
            {captureProblem.impact} {captureProblem.remediation}
          </span>
        </div>
      )}

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
