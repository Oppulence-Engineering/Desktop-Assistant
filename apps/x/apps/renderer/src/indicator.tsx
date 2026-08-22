import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  MeetingCaptureStatus,
  MeetingLevels,
  MeetingTrackId,
} from "@x/shared/meetings";

/**
 * The recording indicator.
 *
 * Its own entry point, in its own window, deliberately sharing nothing with the app
 * bundle: it has to stay up when every app window is closed, and it should cost
 * essentially nothing to render five times a second for an hour. No Tailwind, no theme
 * bootstrap, no router — a status light is not a page.
 *
 * It holds no state that main does not already broadcast. `meeting:captureState` and
 * `meeting:captureLevel` go to every window, so this is a pure view; the only thing it
 * sends back is the stop the user asked for.
 */

const TRACK_LABEL: Record<MeetingTrackId, string> = { mic: "You", system: "Them" };

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const CSS = `
* { box-sizing: border-box; }
.pill {
  display: flex; align-items: center; gap: 10px;
  height: 44px; margin: 2px; padding: 0 8px 0 12px;
  border-radius: 22px;
  background: rgba(24, 24, 27, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  color: #fafafa;
  font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  /* Drag the whole pill; the button opts back out below. */
  -webkit-app-region: drag;
}
.dot {
  position: relative; flex: none; width: 8px; height: 8px;
  border-radius: 50%; background: #ef4444;
}
.dot::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: #ef4444; animation: ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
/* Someone who set "reduce motion" should still see the dot, just not the pulse. */
@media (prefers-reduced-motion: reduce) { .dot::after { animation: none; } }
.dot.paused { background: #a1a1aa; }
.dot.paused::after { animation: none; }
/* Standby is amber and hollow — deliberately not a red dot with different copy.
   A live microphone that looks identical to a recording one is the confusion this
   whole surface exists to prevent, and colour reads before text does. */
.dot.standby { background: transparent; border: 2px solid #f59e0b; width: 10px; height: 10px; }
.dot.standby::after { animation: none; background: transparent; }
.label { flex: none; font-size: 10px; letter-spacing: 0.02em; color: #fcd34d; }
.pill.standby-pill { background: rgba(41, 37, 24, 0.94); border-color: rgba(245, 158, 11, 0.35); }

.time { flex: none; font-variant-numeric: tabular-nums; font-size: 13px; letter-spacing: 0.2px; }
.tracks { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.track { display: flex; align-items: center; gap: 5px; }
.track-label { flex: none; width: 26px; font-size: 9px; color: rgba(250,250,250,0.55); }
.meter { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.14); overflow: hidden; }
.meter > i { display: block; height: 100%; border-radius: 2px; background: #34d399; transition: width 90ms linear; }
.meter.silent > i { background: #71717a; }

.stop {
  -webkit-app-region: no-drag;
  flex: none; display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.16); background: rgba(239, 68, 68, 0.18);
  color: #fca5a5; cursor: pointer; padding: 0;
}
.stop:hover:not(:disabled) { background: rgba(239, 68, 68, 0.32); color: #fff; }
.stop:disabled { opacity: 0.5; cursor: default; }
.stop > span { display: block; width: 9px; height: 9px; border-radius: 1.5px; background: currentColor; }
.warn { flex: none; font-size: 10px; color: #fbbf24; -webkit-app-region: no-drag; }

.record {
  -webkit-app-region: no-drag;
  flex: none; display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid rgba(245,158,11,0.4); background: rgba(245, 158, 11, 0.18);
  color: #fcd34d; cursor: pointer; padding: 0;
}
.record:hover { background: rgba(239, 68, 68, 0.35); color: #fff; border-color: rgba(239,68,68,0.5); }
.record > span { display: block; width: 10px; height: 10px; border-radius: 50%; background: currentColor; }
.dismiss { width: 22px; height: 22px; background: transparent; border-color: rgba(255,255,255,0.14); color: rgba(250,250,250,0.6); }
.dismiss:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; }
.cross { position: relative; width: 8px; height: 8px; }
.cross::before, .cross::after {
  content: ""; position: absolute; top: 3px; left: -1px; width: 10px; height: 1.5px;
  background: currentColor; border-radius: 1px;
}
.cross::before { transform: rotate(45deg); }
.cross::after { transform: rotate(-45deg); }
`;

/** What "standby" actually promises, in the tooltip rather than the pill. */
function standbyHint(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `Listening but writing nothing. Press record to keep the last ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function Meter({ track, peak }: { track: MeetingTrackId; peak: number }) {
  // Same perceptual curve as the in-app strip, so the two never disagree about how
  // loud something looked.
  const width = Math.min(100, Math.round(Math.sqrt(Math.max(0, peak)) * 100));
  return (
    <div className="track">
      <span className="track-label">{TRACK_LABEL[track]}</span>
      <div className={`meter${width === 0 ? " silent" : ""}`}>
        <i style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Indicator() {
  const [status, setStatus] = useState<MeetingCaptureStatus | null>(null);
  const [levels, setLevels] = useState<Partial<Record<MeetingTrackId, number>>>({});
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    // Ask once on mount: the window may open mid-session (reopened after a crash, or
    // shown late), and waiting for the next transition would show 0:00 until then.
    void window.ipc
      .invoke("meeting:captureStatus", null)
      .then(setStatus)
      .catch(() => {});
    const offState = window.ipc.on("meeting:captureState", (next) => setStatus(next));
    const offLevel = window.ipc.on("meeting:captureLevel", (next: MeetingLevels) =>
      setLevels(next.peaks),
    );
    return () => {
      offState();
      offLevel();
    };
  }, []);

  // Derived from the session's own start time rather than counted up, so the clock
  // stays right across a sleep/wake or a throttled frame.
  useEffect(() => {
    if (!status?.startedAt) {
      setElapsed(0);
      return;
    }
    const started = new Date(status.startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [status?.startedAt]);

  const recording = status?.state === "recording";
  const standby = status?.state === "standby";
  const tracks = status?.tracks?.length ? status.tracks : (["mic"] as MeetingTrackId[]);
  // Mic-only is worth saying here and not only in the app: it is the difference between
  // a transcript of a conversation and a transcript of one person talking.
  const micOnly = recording && !tracks.includes("system");
  const captureProblem = status?.captureHealth?.activeEvents[0];

  const stop = async () => {
    setStopping(true);
    try {
      await window.ipc.invoke("meeting:stopCapture", null);
    } catch {
      // Main owns the state; if the stop failed, the next broadcast says so.
      setStopping(false);
    }
  };

  const beginRecording = async () => {
    try {
      await window.ipc.invoke("meeting:beginRecording", null);
    } catch {
      // The next state broadcast is the source of truth either way.
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <div className={`pill${standby ? " standby-pill" : ""}`}>
        <span className={`dot${standby ? " standby" : recording ? "" : " paused"}`} />
        {standby ? (
          <span className="label" title={standbyHint(status?.standbySeconds ?? 0)}>
            STANDBY
          </span>
        ) : (
          <span className="time">{clock(elapsed)}</span>
        )}
        {micOnly && (
          <span className="warn" title="System audio is not being captured">
            mic only
          </span>
        )}
        {captureProblem && (
          <span className="warn" title={`${captureProblem.impact} ${captureProblem.remediation}`}>
            capture warning
          </span>
        )}
        <div className="tracks">
          {tracks.map((track) => (
            <Meter key={track} track={track} peak={levels[track] ?? 0} />
          ))}
        </div>
        {standby ? (
          <button
            type="button"
            className="record"
            onClick={() => void beginRecording()}
            title={`Keep the last ${Math.round((status?.standbySeconds ?? 0) / 60)} minutes and record`}
            aria-label="Start recording, keeping what was already said"
          >
            <span />
          </button>
        ) : (
          <button
            type="button"
            className="stop"
            onClick={() => void stop()}
            disabled={stopping || !recording}
            title="Stop recording"
            aria-label="Stop recording"
          >
            <span />
          </button>
        )}
        <button
          type="button"
          className="stop dismiss"
          onClick={() => void stop()}
          title={standby ? "Discard the buffer and stop" : undefined}
          aria-label="Stop"
          hidden={!standby}
        >
          <span className="cross" />
        </button>
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Indicator />
    </StrictMode>,
  );
}
