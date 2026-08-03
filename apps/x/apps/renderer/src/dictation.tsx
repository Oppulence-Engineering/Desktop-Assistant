import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { useVoiceMode } from "@/hooks/useVoiceMode";
import {
  DICTATION_LANGUAGE_LABELS,
  type DictationFlowBarDock,
  type DictationLanguage,
} from "@x/shared/dist/transcription.js";

type DictationState = "idle" | "listening" | "transcribing" | "success" | "error";
type DictationMode = "push-to-talk" | "hands-free";
type CapturePurpose = "dictation" | "command";

const SESSION_WARNING_MS = 19 * 60 * 1_000;
const SESSION_LIMIT_MS = 20 * 60 * 1_000;
const COMMAND_LIMIT_MS = 60 * 1_000;

const CSS = `
* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
.dictation-pill {
  display: flex; align-items: center; gap: 10px;
  width: calc(100% - 4px); height: 52px; margin: 2px; padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 14px;
  background: rgba(20, 20, 23, 0.94); color: #fafafa;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
  font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  -webkit-app-region: drag; cursor: grab; user-select: none;
}
.dictation-pill:active { cursor: grabbing; }
.dictation-pill.idle {
  height: 38px; gap: 3px; padding: 0 5px 0 4px; border-radius: 999px;
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 21, 0.82);
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.3),
    0 1px 4px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.045);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  backdrop-filter: blur(20px) saturate(120%);
}
.dock-action {
  display: inline-flex; min-width: 0; height: 32px; flex: 1;
  align-items: center; justify-content: flex-start; gap: 7px;
  padding: 0 5px 0 2px; border: 0; border-radius: 999px;
  background: transparent; color: rgba(255, 255, 255, 0.78);
  font: inherit; cursor: pointer; -webkit-app-region: no-drag;
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
}
.dock-action:hover { background: rgba(255, 255, 255, 0.065); color: #fff; }
.dock-action:active { transform: scale(.97); }
.dock-action:focus-visible { outline: 2px solid #fb923c; outline-offset: 1px; }
.mic-orb {
  position: relative; display: inline-flex; width: 26px; height: 26px; flex: none;
  align-items: center; justify-content: center; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.075);
  color: rgba(255, 255, 255, 0.76);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
}
.dock-action:hover .mic-orb {
  background: rgba(255, 255, 255, 0.12); color: #fff; transform: scale(1.035);
}
.mic-orb svg { width: 13px; height: 13px; }
.dock-label {
  overflow: hidden; color: inherit; font-size: 11.5px;
  font-weight: 520; letter-spacing: -0.005em; text-overflow: ellipsis; white-space: nowrap;
}
.drag-grip {
  display: inline-flex; min-width: 14px; min-height: 28px;
  align-items: center; justify-content: center; border-radius: 999px;
  cursor: grab; -webkit-app-region: drag;
  transition: background 140ms ease;
}
.drag-grip:hover { background: rgba(255, 255, 255, 0.06); }
.drag-grip:active { cursor: grabbing; }
.grip-dots {
  width: 2px; height: 2px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 -4px 0 rgba(255, 255, 255, 0.18), 0 4px 0 rgba(255, 255, 255, 0.18);
}
.active-controls {
  display: inline-flex; flex: none; align-items: center; gap: 5px;
  -webkit-app-region: no-drag;
}
.control-button {
  display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,.12); border-radius: 50%;
  background: rgba(255,255,255,.07); color: #fafafa; cursor: pointer;
}
.control-button:hover { background: rgba(255,255,255,.15); }
.control-button.cancel:hover { background: rgba(239,68,68,.22); }
.control-button.stop { background: #fafafa; color: #141417; }
.control-button.stop:hover { background: #e7e7ea; }
.control-button svg { width: 14px; height: 14px; }
.state-dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: #f97316; }
.listening .state-dot { background: #ef4444; animation: pulse 1.1s ease-in-out infinite; }
.transcribing .state-dot { border: 2px solid rgba(255,255,255,0.28); border-top-color: #f97316; background: transparent; animation: spin .8s linear infinite; }
.success .state-dot { background: #34d399; }
.error .state-dot { background: #f59e0b; }
.copy { min-width: 0; flex: 1; cursor: default; -webkit-app-region: no-drag; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { margin-top: 3px; overflow: hidden; color: rgba(250,250,250,.52); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.keys { flex: none; color: rgba(250,250,250,.55); font-size: 10px; letter-spacing: .02em; }
.dock-left, .dock-right {
  flex-direction: column; justify-content: center; gap: 12px;
  width: calc(100% - 4px); height: calc(100% - 4px); padding: 16px 9px;
  text-align: center;
}
.dock-left .copy, .dock-right .copy {
  display: flex; min-height: 0; width: 100%; flex-direction: column;
  justify-content: center;
}
.dock-left .title, .dock-right .title {
  display: -webkit-box; white-space: normal; line-height: 1.35;
  -webkit-box-orient: vertical; -webkit-line-clamp: 4;
}
.dock-left .hint, .dock-right .hint {
  display: -webkit-box; margin-top: 7px; white-space: normal; line-height: 1.35;
  -webkit-box-orient: vertical; -webkit-line-clamp: 5;
}
.dock-left .keys, .dock-right .keys { max-width: 100%; line-height: 1.35; overflow-wrap: anywhere; }
.dock-left.idle, .dock-right.idle { padding: 7px 5px; gap: 4px; }
.dock-left.idle .dock-action, .dock-right.idle .dock-action {
  width: 46px; height: 76px; flex-direction: column; padding: 8px 3px;
  line-height: 1.25; text-align: center;
}
.dock-left.idle .dock-label, .dock-right.idle .dock-label {
  max-width: 42px; white-space: normal;
}
.dock-left.idle .drag-grip, .dock-right.idle .drag-grip {
  width: 34px; min-height: 16px; transform: rotate(90deg);
}
.dock-left .active-controls, .dock-right .active-controls { flex-direction: column; }
@keyframes pulse { 50% { transform: scale(.72); opacity: .55; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .state-dot { animation: none !important; } }
`;

export function Dictation() {
  const voice = useVoiceMode({ surface: "dictation" });
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  const [state, setState] = useState<DictationState>("idle");
  const [message, setMessage] = useState("Listening…");
  const [shortcut, setShortcut] = useState("Control + Option");
  const [mode, setMode] = useState<DictationMode>("push-to-talk");
  const [purpose, setPurpose] = useState<CapturePurpose>("dictation");
  const [language, setLanguage] = useState<DictationLanguage>("auto");
  const [dock, setDock] = useState<DictationFlowBarDock>("bottom");
  const modeRef = useRef<DictationMode>("push-to-talk");
  const purposeRef = useRef<CapturePurpose>("dictation");
  const sessionLanguageRef = useRef<DictationLanguage>("auto");
  const sessionMicrophonePriorityRef = useRef<string[]>([]);
  const pressedRef = useRef(false);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const releaseRequestedRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryPromiseRef = useRef<Promise<void> | null>(null);

  const report = useCallback((next: DictationState, nextMessage?: string) => {
    setState(next);
    if (nextMessage) setMessage(nextMessage);
    void window.ipc.invoke("dictation:updateState", {
      state: next,
      ...(nextMessage ? { message: nextMessage } : {}),
    });
  }, []);

  const clearSessionTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    warningTimerRef.current = null;
    limitTimerRef.current = null;
  }, []);

  const finish = useCallback(async () => {
    if (finishPromiseRef.current) return finishPromiseRef.current;
    const promise = (async () => {
      const releasedAt = performance.now();
      const purpose = purposeRef.current;
      clearSessionTimers();
      const started = await startPromiseRef.current;
      startPromiseRef.current = null;
      if (!started) return;

      report("transcribing", purpose === "command" ? "Transcribing command…" : "Transcribing…");
      const text = await voiceRef.current.submit();
      if (!text.trim()) {
        if (purpose === "command") {
          report("error", "No command captured");
          return;
        }
        const recovery = await window.ipc.invoke("dictation:getRecovery", null);
        const retryableFailure = voiceRef.current.lastSubmitFailure() === "transcription";
        report(
          "error",
          retryableFailure && recovery.audioAvailable
            ? "Transcription failed — press Control + Command + R to retry"
            : "No speech captured",
        );
        return;
      }

      if (purpose === "command") {
        report("transcribing", "Applying command…");
        const result = await window.ipc.invoke("dictation:applyCommand", { instruction: text });
        if (result.success) {
          report("success", `Command applied in ${Math.round(performance.now() - releasedAt)} ms`);
        } else {
          report("error", result.error ?? "Command Mode could not complete that edit");
        }
        return;
      }

      const metrics = voiceRef.current.lastSubmitMetrics();
      const result = await window.ipc.invoke("dictation:commit", {
        text,
        ...(metrics ?? {}),
      });
      if (result.success) {
        report("success", `Inserted in ${Math.round(performance.now() - releasedAt)} ms`);
      } else {
        report("error", result.error ?? "Could not insert the transcript");
      }
    })().finally(() => {
      pressedRef.current = false;
      releaseRequestedRef.current = false;
      finishPromiseRef.current = null;
      modeRef.current = "push-to-talk";
      purposeRef.current = "dictation";
      setMode("push-to-talk");
      setPurpose("dictation");
    });
    finishPromiseRef.current = promise;
    return promise;
  }, [clearSessionTimers, report]);

  const start = useCallback(
    async (nextMode: DictationMode = "push-to-talk", nextPurpose: CapturePurpose = "dictation") => {
      if (retryPromiseRef.current) {
        report("error", "Transcript currently processing");
        return;
      }
      if (pressedRef.current || finishPromiseRef.current) return;
      const generation = ++sessionGenerationRef.current;
      pressedRef.current = true;
      releaseRequestedRef.current = false;
      modeRef.current = nextMode;
      purposeRef.current = nextPurpose;
      setMode(nextMode);
      setPurpose(nextPurpose);
      const languageLabel = DICTATION_LANGUAGE_LABELS[sessionLanguageRef.current];
      report(
        "listening",
        nextPurpose === "command" ? "Starting command microphone…" : "Starting microphone…",
      );
      const promise = voiceRef.current
        .start(nextPurpose, sessionLanguageRef.current, sessionMicrophonePriorityRef.current)
        .then(({ started }) => started);
      startPromiseRef.current = promise;
      const started = await promise;
      if (generation !== sessionGenerationRef.current) {
        // The voice hook owns cleanup for this stale generation. Canceling here
        // would tear down a newer capture started immediately after this one.
        return;
      }
      if (!started) {
        startPromiseRef.current = null;
        pressedRef.current = false;
        report("error", "Microphone or transcription is unavailable");
        return;
      }
      report(
        "listening",
        nextPurpose === "command"
          ? `Listening for a command in ${languageLabel}…`
          : nextMode === "hands-free"
            ? `Hands-free · ${languageLabel}`
            : `Listening in ${languageLabel}…`,
      );
      if (nextPurpose === "dictation") {
        warningTimerRef.current = setTimeout(() => {
          report("listening", "One minute left in this dictation");
        }, SESSION_WARNING_MS);
      }
      limitTimerRef.current = setTimeout(
        () => {
          void finish();
        },
        nextPurpose === "command" ? COMMAND_LIMIT_MS : SESSION_LIMIT_MS,
      );
      if (releaseRequestedRef.current) await finish();
    },
    [finish, report],
  );

  const release = useCallback(async () => {
    if (!pressedRef.current || modeRef.current === "hands-free") return;
    releaseRequestedRef.current = true;
    await finish();
  }, [finish]);

  const lockHandsFree = useCallback(async () => {
    if (!pressedRef.current) {
      await start("hands-free");
      return;
    }
    modeRef.current = "hands-free";
    setMode("hands-free");
    releaseRequestedRef.current = false;
    report("listening", "Hands-free listening…");
  }, [report, start]);

  const cancel = useCallback(() => {
    sessionGenerationRef.current += 1;
    clearSessionTimers();
    voiceRef.current.cancel();
    pressedRef.current = false;
    releaseRequestedRef.current = false;
    startPromiseRef.current = null;
    finishPromiseRef.current = null;
    modeRef.current = "push-to-talk";
    purposeRef.current = "dictation";
    setMode("push-to-talk");
    setPurpose("dictation");
    report("idle");
  }, [clearSessionTimers, report]);

  const retryFailed = useCallback(async () => {
    if (pressedRef.current || finishPromiseRef.current || retryPromiseRef.current) {
      report("error", "Transcript currently processing");
      return;
    }
    const promise = (async () => {
      report("transcribing", "Retrying saved audio…");
      const result = await window.ipc.invoke("dictation:retryFailed", null);
      report(
        result.success ? "success" : "error",
        result.success ? "Recovered and inserted transcript" : result.error,
      );
    })().finally(() => {
      retryPromiseRef.current = null;
    });
    retryPromiseRef.current = promise;
    await promise;
  }, [report]);

  const controlDock = useCallback(
    async (action: "start" | "stop" | "cancel") => {
      const result = await window.ipc.invoke("dictation:controlDock", { action });
      if (!result.accepted && result.error) report("error", result.error);
    },
    [report],
  );

  useEffect(() => {
    voiceRef.current.warmup();
    const offShortcut = window.ipc.on(
      "dictation:shortcut",
      ({ phase, shortcut: nextShortcut, language: nextLanguage, microphonePriority }) => {
        setShortcut(nextShortcut);
        if (phase === "pressed") {
          sessionLanguageRef.current = nextLanguage;
          sessionMicrophonePriorityRef.current = microphonePriority;
          setLanguage(nextLanguage);
          void start();
        } else if (phase === "released") void release();
        else if (phase === "command-pressed") {
          sessionLanguageRef.current = nextLanguage;
          sessionMicrophonePriorityRef.current = microphonePriority;
          setLanguage(nextLanguage);
          void start("push-to-talk", "command");
        } else if (phase === "command-released") void finish();
        else if (phase === "hands-free-locked") void lockHandsFree();
        else if (phase === "hands-free-stop") void finish();
        else if (phase === "cancel") cancel();
        else if (phase === "retry") void retryFailed();
      },
    );
    const offState = window.ipc.on("dictation:state", (next) => {
      setState(next.state);
      if (next.message) setMessage(next.message);
      if (next.dock) setDock(next.dock);
    });
    const offDock = window.ipc.on("dictation:flowBarDockChanged", (next) => {
      setDock(next.dock);
    });
    const offLanguage = window.ipc.on("dictation:languageChanged", (next) => {
      if (!pressedRef.current) {
        sessionLanguageRef.current = next.language;
        setLanguage(next.language);
      }
    });
    const offMicrophones = window.ipc.on("dictation:microphonesChanged", (next) => {
      sessionMicrophonePriorityRef.current = next.microphonePriority;
      if (pressedRef.current) void voiceRef.current.setMicrophonePriority(next.microphonePriority);
    });
    return () => {
      offShortcut();
      offState();
      offDock();
      offLanguage();
      offMicrophones();
      clearSessionTimers();
      voiceRef.current.cancel();
    };
  }, [cancel, clearSessionTimers, finish, lockHandsFree, release, retryFailed, start]);

  const hint =
    state === "listening"
      ? voice.interimText ||
        (purpose === "command"
          ? `Release ${shortcut} to apply · Escape cancels`
          : mode === "hands-free"
            ? `Click ✓ to finish · ${shortcut} + Space also stops · ${DICTATION_LANGUAGE_LABELS[language]}${voice.activeMicrophoneLabel ? ` · ${voice.activeMicrophoneLabel}` : ""}`
            : `Release ${shortcut} to insert · ${DICTATION_LANGUAGE_LABELS[language]}${voice.activeMicrophoneLabel ? ` · ${voice.activeMicrophoneLabel}` : ""}`)
      : state === "transcribing"
        ? "Keeping focus in your current app"
        : state === "success"
          ? "Ready for the next thought"
          : "Check Transcription settings for permissions";

  return (
    <>
      <style>{CSS}</style>
      <div
        className={`dictation-pill dock-${dock} ${state}`}
        role="status"
        aria-live="polite"
        aria-label={
          state === "idle"
            ? "Desktop dictation ready. Click to start recording or drag to another screen edge."
            : `${message}. Drag to dock the dictation bar to another screen edge.`
        }
      >
        {state === "idle" ? (
          <>
            <button
              type="button"
              className="dock-action"
              onClick={() => void controlDock("start")}
              aria-label="Start dictation"
            >
              <span className="mic-orb" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="8" y="3" width="8" height="12" rx="4" />
                  <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
                </svg>
              </span>
              <span className="dock-label">Dictate</span>
            </button>
            <span className="drag-grip" title="Drag to dock" aria-hidden="true">
              <span className="grip-dots" />
            </span>
          </>
        ) : (
          <>
            {state === "listening" ? (
              <div className="active-controls">
                <button
                  type="button"
                  className="control-button cancel"
                  onClick={() => void controlDock("cancel")}
                  aria-label="Cancel dictation"
                  title="Cancel"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
            ) : (
              <span className="state-dot" aria-hidden="true" />
            )}
            <div className="copy">
              <div className="title" title={message}>
                {message}
              </div>
              <div className="hint" title={hint}>
                {hint}
              </div>
            </div>
            <div className="keys">
              {purpose === "command"
                ? "COMMAND"
                : mode === "hands-free"
                  ? "HANDS-FREE"
                  : shortcut}
            </div>
            {state === "listening" ? (
              <div className="active-controls">
                <button
                  type="button"
                  className="control-button stop"
                  onClick={() => void controlDock("stop")}
                  aria-label="Stop and insert dictation"
                  title="Stop and insert"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Dictation />
  </StrictMode>,
);
