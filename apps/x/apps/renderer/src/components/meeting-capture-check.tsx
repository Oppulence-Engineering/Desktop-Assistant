import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { cn } from "@/lib/utils";
import type { MeetingLevels, MeetingTrackId } from "@x/shared/meetings";

/**
 * The ten seconds that prove dual-track capture works.
 *
 * Nobody understands "dual-track" from a settings toggle, and no amount of copy about
 * separate microphone and system-audio streams lands the way seeing your own voice in
 * one column and the video's voice in the other does. This records for ten seconds while
 * you talk over any playing audio, then shows both waveforms and both transcribed lines
 * side by side.
 *
 * It also happens to be a real end-to-end test: permissions, the sidecar, both taps, the
 * transcription queue, and the note pipeline all have to work for the right-hand column
 * to have anything in it. Which is why the failure states here are specific — "your side
 * recorded, theirs was silent" is an actionable finding, and it is exactly the thing a
 * user would otherwise discover after an hour-long meeting.
 */

const TEST_SECONDS = 10;
/** Level events arrive ~5×/sec, so this holds about the last four seconds per track. */
const WAVE_SAMPLES = 48;

type Phase = "intro" | "recording" | "transcribing" | "result" | "error";

interface Line {
  speaker: "me" | "them";
  text: string;
}

function Waveform({ peaks, tone }: { peaks: number[]; tone: "me" | "them" }) {
  const padded = [...peaks];
  while (padded.length < WAVE_SAMPLES) padded.unshift(0);
  return (
    <div className="flex h-10 items-center gap-[2px]" aria-hidden>
      {padded.slice(-WAVE_SAMPLES).map((peak, index) => {
        // Same perceptual curve the level meters use, floored so a live-but-quiet
        // track still reads as a line rather than as nothing at all.
        const height = Math.max(2, Math.round(Math.sqrt(Math.max(0, peak)) * 40));
        return (
          <span
            key={index}
            className={cn(
              "w-[3px] rounded-full",
              tone === "me" ? "bg-emerald-500/80" : "bg-sky-500/80",
              peak === 0 && "bg-muted-foreground/25",
            )}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

function Column({
  title,
  subtitle,
  peaks,
  tone,
  lines,
  captured,
}: {
  title: string;
  subtitle: string;
  peaks: number[];
  tone: "me" | "them";
  lines: Line[];
  captured: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-none border border-border/60 bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5">
        {captured ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" />
        )}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{subtitle}</p>
      <Waveform peaks={peaks} tone={tone} />
      <div className="mt-2 min-h-[2.5rem] text-sm">
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <p key={index} className="text-foreground">
              {line.text}
            </p>
          ))
        ) : (
          <p className="text-xs italic text-muted-foreground">
            {captured ? "No speech was transcribed on this track." : "Nothing was captured."}
          </p>
        )}
      </div>
    </div>
  );
}

export function MeetingCaptureCheck({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [remaining, setRemaining] = useState(TEST_SECONDS);
  const [waves, setWaves] = useState<Record<MeetingTrackId, number[]>>({ mic: [], system: [] });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const stopTimer = useRef<number | null>(null);

  // Level events must be collected for the whole recording, so the subscription lives
  // across the phase changes rather than inside the recording effect.
  useEffect(() => {
    if (!open) return;
    const off = window.ipc.on("meeting:captureLevel", (levels: MeetingLevels) => {
      if (sessionRef.current && levels.sessionId !== sessionRef.current) return;
      setWaves((current) => ({
        mic: [...current.mic, levels.peaks.mic ?? 0].slice(-WAVE_SAMPLES * 2),
        system: [...current.system, levels.peaks.system ?? 0].slice(-WAVE_SAMPLES * 2),
      }));
    });
    return () => off();
  }, [open]);

  const reset = useCallback(() => {
    setPhase("intro");
    setRemaining(TEST_SECONDS);
    setWaves({ mic: [], system: [] });
    setLines([]);
    setError(null);
    sessionRef.current = null;
  }, []);

  const finish = useCallback(async () => {
    setPhase("transcribing");
    try {
      const { queued } = await window.ipc.invoke("meeting:stopCapture", null);
      // Transcription is a setting. With it off nothing will ever report progress, and
      // waiting for an event that cannot arrive would leave this on "Transcribing…"
      // forever — the waveforms alone still answer what the check is asking.
      if (!queued) setPhase("result");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }, []);

  const start = useCallback(async () => {
    // "Run it again" must not strand the previous attempt's session.
    const previous = sessionRef.current;
    if (previous) {
      sessionRef.current = null;
      void window.ipc
        .invoke("meeting:deleteSession", { sessionId: previous, deleteNote: true })
        .catch(() => {});
    }
    setError(null);
    setWaves({ mic: [], system: [] });
    setLines([]);
    setRemaining(TEST_SECONDS);
    try {
      const result = await window.ipc.invoke("meeting:startCapture", {});
      if (!result.started) {
        setError(result.error ?? "Could not start recording.");
        setPhase("error");
        return;
      }
      sessionRef.current = result.sessionId ?? null;
      setPhase("recording");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }, []);

  // Countdown, and the auto-stop at zero. Ten seconds is the whole promise, so it ends
  // itself rather than waiting for the user to remember to stop it.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          void finish();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    stopTimer.current = id;
    return () => window.clearInterval(id);
  }, [phase, finish]);

  // The transcript lands asynchronously in the queue, so the result waits on the
  // progress event for this session rather than polling.
  useEffect(() => {
    if (phase !== "transcribing") return;
    // A backstop for the job that never reports — a crashed worker, a queue busy with a
    // real meeting. Ten seconds of audio transcribes in about a second; a minute of
    // waiting means it is not coming.
    const timeout = window.setTimeout(() => setPhase("result"), 60_000);
    const off = window.ipc.on("meeting:captureProgress", (progress) => {
      if (sessionRef.current && progress.sessionId !== sessionRef.current) return;
      if (progress.phase === "failed") {
        setError(progress.error ?? "Transcription failed.");
        setPhase("error");
        return;
      }
      if (progress.phase !== "done") return;
      void (async () => {
        try {
          const { segments } = await window.ipc.invoke("meeting:sessionTranscript", {
            sessionId: sessionRef.current!,
          });
          setLines(segments.map((s) => ({ speaker: s.speaker, text: s.text })));
        } catch {
          // The waveforms alone still answer the question the check is asking.
        }
        setPhase("result");
      })();
    });
    return () => {
      window.clearTimeout(timeout);
      off();
    };
  }, [phase]);

  const dismiss = useCallback(
    async (done: boolean) => {
      if (stopTimer.current) window.clearInterval(stopTimer.current);
      // Stop anything still running: closing the dialog must never leave a recording
      // the user did not ask for.
      if (phase === "recording") {
        try {
          await window.ipc.invoke("meeting:stopCapture", null);
        } catch {
          // Main owns the state; nothing here can improve on a failed stop.
        }
      }
      // The check is a setup test, not a meeting. Leaving it behind would put a
      // ten-second recording in the list, a note in the workspace, and a summary and
      // commitment pass over "testing, one two" — every one of which the user would
      // then have to clean up.
      const sessionId = sessionRef.current;
      if (sessionId) {
        try {
          await window.ipc.invoke("meeting:deleteSession", { sessionId, deleteNote: true });
        } catch {
          // A test recording we could not remove is untidy, not harmful.
        }
      }
      if (done) {
        try {
          await window.ipc.invoke("ui:setState", { meetingCaptureCheckDone: true });
        } catch {
          // Worst case the check is offered again, which is harmless.
        }
      }
      reset();
      onOpenChange(false);
    },
    [onOpenChange, phase, reset],
  );

  const micLines = lines.filter((line) => line.speaker === "me");
  const systemLines = lines.filter((line) => line.speaker === "them");
  const micCaptured = waves.mic.some((peak) => peak > 0);
  const systemCaptured = waves.system.some((peak) => peak > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && void dismiss(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check your meeting setup</DialogTitle>
          <DialogDescription>
            {phase === "intro" &&
              "Ten seconds. Play any video or music, and talk over it — then you'll see both sides of the conversation captured separately."}
            {phase === "recording" && "Recording. Keep the audio playing and keep talking."}
            {phase === "transcribing" && "Transcribing on this Mac…"}
            {phase === "result" &&
              (micCaptured && systemCaptured
                ? "Both sides were captured on separate tracks. That is what makes the transcript know who said what."
                : "Here is what was captured.")}
            {phase === "error" && "The check could not finish."}
          </DialogDescription>
        </DialogHeader>

        {phase === "intro" && (
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. Start any video, song, or call playing out loud.</li>
            <li>2. Press Start, then say a sentence over it.</li>
            <li>3. We record ten seconds and show you both tracks.</li>
          </ol>
        )}

        {phase === "recording" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-medium tabular-nums">{remaining}s left</span>
            </div>
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs text-muted-foreground">You (microphone)</p>
                <Waveform peaks={waves.mic} tone="me" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs text-muted-foreground">Them (system audio)</p>
                <Waveform peaks={waves.system} tone="them" />
              </div>
            </div>
          </div>
        )}

        {phase === "transcribing" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Nothing is uploaded — this runs on your machine.
          </div>
        )}

        {phase === "result" && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <Column
                title="You"
                subtitle="Your microphone"
                peaks={waves.mic}
                tone="me"
                lines={micLines}
                captured={micCaptured}
              />
              <Column
                title="Them"
                subtitle="System audio"
                peaks={waves.system}
                tone="them"
                lines={systemLines}
                captured={systemCaptured}
              />
            </div>
            {/* The specific failure, not a generic "something went wrong" — each of
                these has a different fix, and finding out after a real meeting is the
                outcome this whole check exists to prevent. */}
            {!systemCaptured && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                No system audio was captured. Check that something was actually playing out loud,
                and that screen recording is allowed in System Settings › Privacy & Security.
              </p>
            )}
            {!micCaptured && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <Mic className="mt-0.5 size-3.5 shrink-0" />
                Your microphone recorded silence. Check the input device and that microphone access
                is allowed.
              </p>
            )}
          </div>
        )}

        {phase === "error" && (
          <p className="flex items-start gap-1.5 py-4 text-sm text-amber-600 dark:text-amber-500">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          {phase === "intro" && (
            <>
              <Button type="button" variant="ghost" onClick={() => void dismiss(true)}>
                Skip
              </Button>
              <Button type="button" onClick={() => void start()}>
                Start the check
              </Button>
            </>
          )}
          {phase === "recording" && (
            <Button type="button" variant="outline" onClick={() => void finish()}>
              Stop now
            </Button>
          )}
          {(phase === "result" || phase === "error") && (
            <>
              <Button type="button" variant="outline" onClick={() => void start()}>
                Run it again
              </Button>
              <Button type="button" onClick={() => void dismiss(true)}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
