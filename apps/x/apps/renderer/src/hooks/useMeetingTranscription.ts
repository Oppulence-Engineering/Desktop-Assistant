import { useCallback, useEffect, useRef, useState } from "react";
import { buildDeepgramListenUrl } from "@/lib/deepgram-listen-url";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import { openWhisperStream, type WhisperStreamHandle } from "@/lib/whisper-stream";
import * as analytics from "@/lib/analytics";
import type { TranscriptionProvider } from "@x/shared/dist/transcription.js";
import {
  formatMeetingNote,
  type MeetingCalendarEvent,
  type MeetingResolvedEngine,
} from "@x/shared/dist/meetings.js";

export type MeetingTranscriptionState = "idle" | "connecting" | "recording" | "stopping";

const DEEPGRAM_PARAMS = new URLSearchParams({
  model: "nova-3",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "2",
  multichannel: "true",
  diarize: "true",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  language: "en",
});
const DEEPGRAM_LISTEN_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`;
const TRANSCRIPTION_CONFIG_CHANGED_EVENT = "transcription-config-changed";

// RMS threshold: system audio above this = "active" (speakers playing)
const SYSTEM_AUDIO_GATE_THRESHOLD = 0.005;

// Auto-stop after 2 minutes of silence (no transcript from Deepgram)
const SILENCE_AUTO_STOP_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Headphone detection
// ---------------------------------------------------------------------------
async function detectHeadphones(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const defaultOutput = outputs.find((d) => d.deviceId === "default");
    const label = (defaultOutput?.label ?? "").toLowerCase();
    // Heuristic: built-in speakers won't match these patterns
    const headphonePatterns = [
      "headphone",
      "airpod",
      "earpod",
      "earphone",
      "earbud",
      "bluetooth",
      "bt_",
      "jabra",
      "bose",
      "sony wh",
      "sony wf",
    ];
    return headphonePatterns.some((p) => label.includes(p));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------
interface TranscriptEntry {
  speaker: string;
  text: string;
}

/** Re-exported so existing importers keep working; the shape now lives in @x/shared
 *  because the native capture path in main needs the same type. */
export type CalendarEventMeta = MeetingCalendarEvent;

/**
 * The note formatter moved to `@x/shared/meetings` so the native capture engine
 * writes the identical note from the main process. Everything downstream depends on
 * that shape — the transcript block is an editor node, note listing filters on
 * `source: solomon`, and `meeting:summarize` prepends above the block — so there is
 * exactly one implementation on purpose.
 */
const formatTranscript = formatMeetingNote;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useMeetingTranscription(
  onAutoStop?: () => void,
  onSystemAudioUnavailable?: () => void,
) {
  const { refresh: refreshSolomonAccount } = useSolomonAccount({ autoRefresh: false });
  const [state, setState] = useState<MeetingTranscriptionState>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  // On-device streaming session (RFC 009 §15); null when using the Deepgram path.
  const streamHandleRef = useRef<WhisperStreamHandle | null>(null);
  const useLocalRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const interimRef = useRef<Map<number, { speaker: string; text: string }>>(new Map());
  const notePathRef = useRef<string>("");
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAutoStopRef = useRef(onAutoStop);
  onAutoStopRef.current = onAutoStop;
  const onSystemAudioUnavailableRef = useRef(onSystemAudioUnavailable);
  onSystemAudioUnavailableRef.current = onSystemAudioUnavailable;
  const dateRef = useRef<string>("");
  const calendarEventRef = useRef<CalendarEventMeta | undefined>(undefined);
  const privacyGenerationRef = useRef(0);
  // RFC 017 provenance fields written into the note frontmatter (provider/model,
  // diarization provider+mode, audio-uploaded, identity persistence).
  const provenanceRef = useRef<Record<string, string | boolean>>({});
  // Which engine the live session is using. `native` means the sidecar owns capture
  // and this hook holds no audio graph at all — it just reflects main's state.
  const engineRef = useRef<MeetingResolvedEngine>("renderer");

  const writeTranscriptToFile = useCallback(async () => {
    if (!notePathRef.current) return;
    const entries = [...transcriptRef.current];
    for (const interim of interimRef.current.values()) {
      if (!interim.text) continue;
      if (entries.length > 0 && entries[entries.length - 1].speaker === interim.speaker) {
        entries[entries.length - 1] = {
          speaker: interim.speaker,
          text: entries[entries.length - 1].text + " " + interim.text,
        };
      } else {
        entries.push({ speaker: interim.speaker, text: interim.text });
      }
    }
    if (entries.length === 0) return;
    const content = formatTranscript(
      entries,
      dateRef.current,
      calendarEventRef.current,
      provenanceRef.current,
    );
    try {
      await window.ipc.invoke("workspace:writeFile", {
        path: notePathRef.current,
        data: content,
        opts: { encoding: "utf8" },
      });
    } catch (err) {
      console.error("[meeting] Failed to write transcript:", err);
    }
  }, []);

  const scheduleDebouncedWrite = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      void writeTranscriptToFile();
    }, 1000);
  }, [writeTranscriptToFile]);

  const cleanup = useCallback(() => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamHandleRef.current) {
      void streamHandleRef.current.close();
      streamHandleRef.current = null;
    }
  }, []);

  useEffect(() => {
    const closeCloudTransportForLocalOnly = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.privacy?.localOnly !== true) return;
      privacyGenerationRef.current += 1;
      if (!useLocalRef.current || wsRef.current) {
        useLocalRef.current = true;
        cleanup();
        setState("idle");
      }
    };

    window.addEventListener(TRANSCRIPTION_CONFIG_CHANGED_EVENT, closeCloudTransportForLocalOnly);
    return () => {
      window.removeEventListener(
        TRANSCRIPTION_CONFIG_CHANGED_EVENT,
        closeCloudTransportForLocalOnly,
      );
    };
  }, [cleanup]);

  // Native capture lives in main, so main is the authority on whether a session is
  // running. Reconcile on mount (the window may have been closed through a recording,
  // or the session started from the tray) and follow every transition after that.
  useEffect(() => {
    let cancelled = false;

    const adopt = (status: { state: string; notePath?: string }) => {
      if (cancelled) return;
      if (status.state === "recording") {
        engineRef.current = "native";
        if (status.notePath) notePathRef.current = status.notePath;
        setState("recording");
      } else if (engineRef.current === "native" && status.state === "idle") {
        engineRef.current = "renderer";
        setState("idle");
      }
    };

    void window.ipc
      .invoke("meeting:captureStatus", null)
      .then(adopt)
      .catch(() => {
        /* native capture unavailable — the in-page path owns state */
      });

    const offState = window.ipc.on("meeting:captureState", adopt);
    // A session that ended without us asking: the tray stopped it, the app quit, or
    // the sidecar died. Either way the button must not stay stuck on "Stop".
    const offEnded = window.ipc.on("meeting:captureEnded", () => {
      if (cancelled || engineRef.current !== "native") return;
      engineRef.current = "renderer";
      setState("idle");
    });

    return () => {
      cancelled = true;
      offState?.();
      offEnded?.();
    };
  }, []);

  // E16: arm/reset the silence auto-stop timer. Shared by start() (so an all-silent
  // session still auto-stops), Deepgram ws.onmessage, and appendLocalFinal.
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      console.log("[meeting] 2 minutes of silence — auto-stopping");
      onAutoStopRef.current?.();
    }, SILENCE_AUTO_STOP_MS);
  }, []);

  // Append a final on-device segment to the transcript ("You"/"Other"), reusing the
  // same entry-coalescing + debounced-write + silence-timer machinery as Deepgram.
  const appendLocalFinal = useCallback(
    (segment: { text: string; speaker?: "you" | "other" }) => {
      if (!segment.text) return;
      resetSilenceTimer();

      const speaker = segment.speaker === "other" ? "Other" : "You";
      const entries = transcriptRef.current;
      if (entries.length > 0 && entries[entries.length - 1].speaker === speaker) {
        entries[entries.length - 1].text += " " + segment.text;
      } else {
        entries.push({ speaker, text: segment.text });
      }
      scheduleDebouncedWrite();
    },
    [scheduleDebouncedWrite, resetSilenceTimer],
  );

  const start = useCallback(
    async (calendarEvent?: CalendarEventMeta): Promise<string | null> => {
      if (state !== "idle") return null;
      setState("connecting");

      // Native capture: the sidecar records both tracks to disk and main transcribes
      // afterwards, so there is no audio graph, no socket, and no window dependency
      // here. Everything below this block is the in-page fallback for Windows/Linux
      // and macOS older than 14.2.
      engineRef.current = "renderer";
      try {
        const { engine } = await window.ipc.invoke("meeting:captureEngine", null);
        if (engine === "native") {
          const result = await window.ipc.invoke("meeting:startCapture", {
            calendarEventJson: calendarEvent ? JSON.stringify(calendarEvent) : undefined,
          });
          if (!result.started) {
            console.error("[meeting] native capture failed to start:", result.error);
            analytics.transcriptionFailed({
              provider: "whisper-local",
              mode: "meeting",
              code: "native_capture_failed",
              captureEngine: "native",
            });
            setState("idle");
            return null;
          }
          engineRef.current = "native";
          notePathRef.current = result.notePath ?? "";
          calendarEventRef.current = calendarEvent;
          if (!result.tracks.includes("system")) onSystemAudioUnavailableRef.current?.();
          analytics.transcriptionStarted({
            provider: "whisper-local",
            mode: "meeting",
            captureEngine: "native",
            systemAudioCaptured: result.tracks.includes("system"),
          });
          setState("recording");
          return result.notePath ?? null;
        }
      } catch (err) {
        // An unreachable handler must not block recording — fall through to the
        // in-page pipeline rather than refusing to record at all.
        console.warn("[meeting] could not resolve the capture engine:", err);
      }

      let meetingProvider: TranscriptionProvider = "deepgram";
      try {
        const resolved = await window.ipc.invoke("transcription:getMeetingProvider", null);
        meetingProvider = resolved.provider;
      } catch {
        /* default to cloud */
      }
      if (meetingProvider === "none") {
        console.warn("[meeting] local-only meeting transcription is unavailable on this device");
        analytics.transcriptionFailed({
          provider: "whisper-local",
          mode: "meeting",
          code: "device_unsupported",
        });
        setState("idle");
        return null;
      }
      useLocalRef.current = meetingProvider === "whisper-local";
      analytics.transcriptionStarted({ provider: meetingProvider, mode: "meeting" });

      // RFC 017: compute the meeting note provenance up front from the resolved
      // provider + config. Local diarization runs only on the on-device path and
      // only when the LOCAL_DIARIZATION beta is enabled; cloud meetings keep the
      // provider's (Deepgram) diarization. Mirrors core voice/diarization/provenance.
      try {
        const cfg = await window.ipc.invoke("transcription:getConfig", null);
        const local = meetingProvider === "whisper-local";
        const localDiarization = local && cfg.diarization?.enabled === true;
        provenanceRef.current = {
          transcription_provider: local ? "whisper.cpp" : meetingProvider,
          transcription_model: local ? cfg.whisper.model : "nova-3",
          diarization_provider: localDiarization ? "local" : local ? "none" : "deepgram",
          diarization_mode: localDiarization ? "beta" : local ? "off" : "default",
          ...(localDiarization ? { diarization_model: cfg.diarization.model } : {}),
          audio_uploaded: !local,
          speaker_identity_persistence: localDiarization ? "meeting_only" : "none",
        };
      } catch {
        provenanceRef.current = {};
      }
      const privacyGeneration = privacyGenerationRef.current;
      const localOnlyEnabled = async () => {
        try {
          const cfg = await window.ipc.invoke("transcription:getConfig", null);
          return cfg.privacy.localOnly;
        } catch {
          return false;
        }
      };
      const assertCloudAllowed = async () => {
        if (privacyGeneration !== privacyGenerationRef.current || (await localOnlyEnabled())) {
          useLocalRef.current = true;
          throw new Error("local-only privacy enabled");
        }
      };

      // Run independent setup steps in parallel for faster startup
      const [headphoneResult, wsResult, micResult, systemResult] = await Promise.allSettled([
        // 1. Detect headphones vs speakers
        detectHeadphones(),
        // 2. Set up the transport: on-device streaming session, or Deepgram WebSocket
        (async () => {
          if (useLocalRef.current) {
            const handle = await openWhisperStream({
              channels: 2,
              onFinal: (seg) => appendLocalFinal(seg),
              onError: (code) => {
                console.error("[meeting] whisper stream error:", code);
                // Record the failure so an empty on-device transcript is observable
                // rather than silent (cloud failures already surface; this matched it).
                analytics.transcriptionFailed({ provider: "whisper-local", mode: "meeting", code });
              },
            });
            if (!handle) throw new Error("whisper stream failed to open");
            console.log("[meeting] On-device streaming session opened");
            return handle;
          }
          await assertCloudAllowed();
          const account = await refreshSolomonAccount();
          await assertCloudAllowed();
          let ws: WebSocket;
          if (account?.signedIn && account.accessToken && account.config?.websocketApiUrl) {
            const listenUrl = buildDeepgramListenUrl(
              account.config.websocketApiUrl,
              DEEPGRAM_PARAMS,
            );
            console.log("[meeting] Using Solomon AI WebSocket");
            ws = new WebSocket(listenUrl, ["bearer", account.accessToken]);
          } else {
            const config = await window.ipc.invoke("voice:getConfig", null);
            await assertCloudAllowed();
            if (!config?.deepgram) {
              throw new Error("No Deepgram config available");
            }
            console.log("[meeting] Using Deepgram API key");
            ws = new WebSocket(DEEPGRAM_LISTEN_URL, ["token", config.deepgram.apiKey]);
          }
          // Track the socket immediately so a local-only toggle during the connect
          // window can close it before any audio pipeline starts.
          wsRef.current = ws;
          const ok = await new Promise<boolean>((resolve) => {
            ws.onopen = () => resolve(true);
            ws.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 5000);
          });
          try {
            await assertCloudAllowed();
          } catch (err) {
            if (wsRef.current === ws) wsRef.current = null;
            ws.close();
            throw err;
          }
          if (!ok) {
            if (wsRef.current === ws) wsRef.current = null;
            ws.close();
            throw new Error("WebSocket failed to connect");
          }
          console.log("[meeting] WebSocket connected");
          return ws;
        })(),
        // 3. Get mic stream
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        // 4. Get system audio via getDisplayMedia (loopback)
        (async () => {
          const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          stream.getVideoTracks().forEach((t) => t.stop());
          if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error("No audio track from getDisplayMedia");
          }
          console.log("[meeting] System audio captured");
          return stream;
        })(),
      ]);

      // Only the transport and the mic are load-bearing. A missing system track
      // degrades the meeting to one-sided rather than killing it — on macOS,
      // `audio: "loopback"` can yield no audio track at all, and losing your own
      // half of the conversation on top of theirs is the worse outcome.
      const failed = wsResult.status === "rejected" || micResult.status === "rejected";

      if (failed) {
        if (wsResult.status === "rejected")
          console.error("[meeting] WebSocket setup failed:", wsResult.reason);
        if (micResult.status === "rejected")
          console.error("[meeting] Microphone access denied:", micResult.reason);
        if (systemResult.status === "rejected")
          console.error("[meeting] System audio access denied:", systemResult.reason);
        // Clean up any resources that did succeed
        if (wsResult.status === "fulfilled") {
          wsResult.value.close();
        }
        if (micResult.status === "fulfilled") {
          micResult.value.getTracks().forEach((t) => t.stop());
        }
        if (systemResult.status === "fulfilled") {
          systemResult.value.getTracks().forEach((t) => t.stop());
        }
        cleanup();
        setState("idle");
        return null;
      }
      const systemAudioAvailable = systemResult.status === "fulfilled";
      if (!systemAudioAvailable) {
        console.warn(
          "[meeting] System audio unavailable; recording microphone only — the other side of the call will not be transcribed:",
          systemResult.reason,
        );
        onSystemAudioUnavailableRef.current?.();
      }
      // Make one-sided capture visible in the note rather than silently producing a
      // transcript that looks complete but only ever has "You" turns.
      provenanceRef.current.system_audio_captured = systemAudioAvailable;

      const usingHeadphones =
        headphoneResult.status === "fulfilled" ? headphoneResult.value : false;
      console.log(`[meeting] Audio output mode: ${usingHeadphones ? "headphones" : "speakers"}`);

      transcriptRef.current = [];
      interimRef.current = new Map();
      if (useLocalRef.current) {
        // On-device finals arrive via the stream's onFinal → appendLocalFinal (set at open).
        streamHandleRef.current = wsResult.value as WhisperStreamHandle;
      } else {
        const ws = wsResult.value as WebSocket;
        wsRef.current = ws;

        // Set up WS message handler
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (!data.channel?.alternatives?.[0]) return;
          const transcript = data.channel.alternatives[0].transcript;
          if (!transcript) return;

          // Reset silence auto-stop timer on any transcript
          resetSilenceTimer();

          const channelIndex = data.channel_index?.[0] ?? 0;
          const isMic = channelIndex === 0;

          // Channel 0 = mic = "You", Channel 1 = system audio with diarization
          let speaker: string;
          if (isMic) {
            speaker = "You";
          } else {
            // Use Deepgram diarization speaker ID for system audio channel
            const words = data.channel.alternatives[0].words;
            const speakerId = words?.[0]?.speaker;
            speaker = speakerId != null ? `Speaker ${speakerId}` : "System audio";
          }

          if (data.is_final) {
            interimRef.current.delete(channelIndex);
            const entries = transcriptRef.current;
            if (entries.length > 0 && entries[entries.length - 1].speaker === speaker) {
              entries[entries.length - 1].text += " " + transcript;
            } else {
              entries.push({ speaker, text: transcript });
            }
          } else {
            interimRef.current.set(channelIndex, { speaker, text: transcript });
          }
          scheduleDebouncedWrite();
        };

        ws.onclose = () => {
          console.log("[meeting] WebSocket closed");
          wsRef.current = null;
        };
      }

      const micStream = micResult.value;
      micStreamRef.current = micStream;

      const systemStream = systemAudioAvailable ? systemResult.value : null;
      systemStreamRef.current = systemStream;

      // ----- Audio pipeline -----
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const micSource = audioCtx.createMediaStreamSource(micStream);
      const merger = audioCtx.createChannelMerger(2);

      micSource.connect(merger, 0, 0); // mic → channel 0
      if (systemStream) {
        const systemSource = audioCtx.createMediaStreamSource(systemStream);
        systemSource.connect(merger, 0, 1); // system audio → channel 1
      } else {
        const silentSystemSource = audioCtx.createConstantSource();
        const silentSystemGain = audioCtx.createGain();
        silentSystemGain.gain.value = 0;
        silentSystemSource.connect(silentSystemGain);
        silentSystemGain.connect(merger, 0, 1);
        silentSystemSource.start();
      }

      const processor = audioCtx.createScriptProcessor(4096, 2, 2);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // Cloud path needs an open socket; the local stream is always ready once opened.
        if (!useLocalRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN))
          return;

        const micRaw = e.inputBuffer.getChannelData(0);
        const sysRaw = e.inputBuffer.getChannelData(1);

        // Mode 1 (headphones): pass both streams through unmodified
        // Mode 2 (speakers): gate/mute mic when system audio is active
        let micOut: Float32Array;
        if (usingHeadphones) {
          micOut = micRaw;
        } else {
          // Compute system audio RMS to detect activity
          let sysSum = 0;
          for (let i = 0; i < sysRaw.length; i++) sysSum += sysRaw[i] * sysRaw[i];
          const sysRms = Math.sqrt(sysSum / sysRaw.length);

          if (sysRms > SYSTEM_AUDIO_GATE_THRESHOLD) {
            // System audio is playing — mute mic to prevent bleed
            micOut = new Float32Array(micRaw.length); // all zeros
          } else {
            // System audio is silent — pass mic through
            micOut = micRaw;
          }
        }

        // Interleave mic (ch0) + system audio (ch1) into stereo int16 PCM
        const int16 = new Int16Array(micOut.length * 2);
        for (let i = 0; i < micOut.length; i++) {
          const s0 = Math.max(-1, Math.min(1, micOut[i]));
          const s1 = Math.max(-1, Math.min(1, sysRaw[i]));
          int16[i * 2] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff;
          int16[i * 2 + 1] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff;
        }
        if (useLocalRef.current) {
          streamHandleRef.current?.send(int16.buffer);
        } else {
          wsRef.current?.send(int16.buffer);
        }
      };

      merger.connect(processor);
      processor.connect(audioCtx.destination);

      // Create the note file, organized by date like voice memos
      const now = new Date();
      const dateStr = now.toISOString();
      dateRef.current = dateStr;
      const dateFolder = dateStr.split("T")[0]; // YYYY-MM-DD
      const timestamp = dateStr.replace(/:/g, "-").replace(/\.\d+Z$/, "");
      const filename = calendarEvent?.summary
        ? calendarEvent.summary
            .replace(/[\\/*?:"<>|]/g, "")
            .replace(/\s+/g, "_")
            .substring(0, 100)
            .trim()
        : `meeting-${timestamp}`;
      const notePath = `knowledge/Meetings/solomon/${dateFolder}/${filename}.md`;
      notePathRef.current = notePath;
      calendarEventRef.current = calendarEvent;
      const initialContent = formatTranscript([], dateStr, calendarEvent);
      await window.ipc.invoke("workspace:writeFile", {
        path: notePath,
        data: initialContent,
        opts: { encoding: "utf8", mkdirp: true },
      });

      setState("recording");
      // E16: arm the silence timer once at the start so an all-silent session
      // (muted mic / broken capture, zero transcripts) still auto-stops.
      resetSilenceTimer();
      return notePath;
    },
    [
      state,
      cleanup,
      scheduleDebouncedWrite,
      refreshSolomonAccount,
      appendLocalFinal,
      resetSilenceTimer,
    ],
  );

  const stop = useCallback(async () => {
    if (state !== "recording") return;
    setState("stopping");

    // Native capture: main finalizes the files and queues transcription. The note is
    // rewritten with the transcript when that finishes, which the caller learns about
    // through `meeting:captureProgress` rather than by awaiting here — a long meeting
    // must not hold the stop button hostage.
    if (engineRef.current === "native") {
      try {
        await window.ipc.invoke("meeting:stopCapture", null);
      } catch (err) {
        console.error("[meeting] native stop failed:", err);
      }
      engineRef.current = "renderer";
      analytics.transcriptionCompleted({ provider: "whisper-local", mode: "meeting" });
      setState("idle");
      return;
    }

    // On-device: drain the engine's tail first — close() flushes the open segment,
    // waits for the trailing finals (which land in transcriptRef via appendLocalFinal)
    // plus the 'done' signal, so the last utterance is included in the final write.
    if (streamHandleRef.current) {
      await streamHandleRef.current.close();
      streamHandleRef.current = null;
    }

    cleanup();
    interimRef.current = new Map();
    await writeTranscriptToFile();

    analytics.transcriptionCompleted({
      provider: useLocalRef.current ? "whisper-local" : "deepgram",
      mode: "meeting",
    });
    setState("idle");
  }, [state, cleanup, writeTranscriptToFile]);

  return { state, start, stop };
}
