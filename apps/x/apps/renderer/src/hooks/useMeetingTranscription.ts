import { useCallback, useEffect, useRef, useState } from "react";
import { buildDeepgramListenUrl } from "@/lib/deepgram-listen-url";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import { openWhisperStream, type WhisperStreamHandle } from "@/lib/whisper-stream";
import * as analytics from "@/lib/analytics";
import type { TranscriptionProvider } from "@x/shared/dist/transcription.js";

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

export interface CalendarEventMeta {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  conferenceLink?: string;
  source?: string;
}

function formatTranscript(
  entries: TranscriptEntry[],
  date: string,
  calendarEvent?: CalendarEventMeta,
): string {
  const noteTitle = calendarEvent?.summary || "Meeting Notes";
  const lines = [
    "---",
    "type: meeting",
    "source: solomon",
    `title: ${noteTitle}`,
    `date: "${date}"`,
  ];
  if (calendarEvent) {
    // Serialize as a JSON string on one line — the frontmatter system
    // only supports flat key: value pairs, not nested YAML objects.
    const eventObj: Record<string, string> = {};
    if (calendarEvent.summary) eventObj.summary = calendarEvent.summary;
    if (calendarEvent.start?.dateTime) eventObj.start = calendarEvent.start.dateTime;
    else if (calendarEvent.start?.date) eventObj.start = calendarEvent.start.date;
    if (calendarEvent.end?.dateTime) eventObj.end = calendarEvent.end.dateTime;
    else if (calendarEvent.end?.date) eventObj.end = calendarEvent.end.date;
    if (calendarEvent.location) eventObj.location = calendarEvent.location;
    if (calendarEvent.htmlLink) eventObj.htmlLink = calendarEvent.htmlLink;
    if (calendarEvent.conferenceLink) eventObj.conferenceLink = calendarEvent.conferenceLink;
    if (calendarEvent.source) eventObj.source = calendarEvent.source;
    lines.push(`calendar_event: '${JSON.stringify(eventObj).replace(/'/g, "''")}'`);
  }
  lines.push("---", "", `# ${noteTitle}`, "");
  // Build the raw transcript text
  const transcriptLines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].speaker !== entries[i - 1].speaker) {
      transcriptLines.push("");
    }
    transcriptLines.push(`**${entries[i].speaker}:** ${entries[i].text}`);
    transcriptLines.push("");
  }
  const transcriptText = transcriptLines.join("\n").trim();
  const transcriptData = JSON.stringify({ transcript: transcriptText });
  lines.push("```transcript", transcriptData, "```");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useMeetingTranscription(onAutoStop?: () => void) {
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
  const dateRef = useRef<string>("");
  const calendarEventRef = useRef<CalendarEventMeta | undefined>(undefined);
  const privacyGenerationRef = useRef(0);

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
    const content = formatTranscript(entries, dateRef.current, calendarEventRef.current);
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

  // Append a final on-device segment to the transcript ("You"/"Other"), reusing the
  // same entry-coalescing + debounced-write + silence-timer machinery as Deepgram.
  const appendLocalFinal = useCallback(
    (segment: { text: string; speaker?: "you" | "other" }) => {
      if (!segment.text) return;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        console.log("[meeting] 2 minutes of silence — auto-stopping");
        onAutoStopRef.current?.();
      }, SILENCE_AUTO_STOP_MS);

      const speaker = segment.speaker === "other" ? "Other" : "You";
      const entries = transcriptRef.current;
      if (entries.length > 0 && entries[entries.length - 1].speaker === speaker) {
        entries[entries.length - 1].text += " " + segment.text;
      } else {
        entries.push({ speaker, text: segment.text });
      }
      scheduleDebouncedWrite();
    },
    [scheduleDebouncedWrite],
  );

  const start = useCallback(
    async (calendarEvent?: CalendarEventMeta): Promise<string | null> => {
      if (state !== "idle") return null;
      setState("connecting");

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

      // Check for failures — clean up any successful resources if something failed
      const failed =
        wsResult.status === "rejected" ||
        micResult.status === "rejected" ||
        (systemResult.status === "rejected" && !useLocalRef.current);

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
      if (systemResult.status === "rejected") {
        console.warn(
          "[meeting] System audio unavailable; continuing local transcription with microphone audio only:",
          systemResult.reason,
        );
      }

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
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            console.log("[meeting] 2 minutes of silence — auto-stopping");
            onAutoStopRef.current?.();
          }, SILENCE_AUTO_STOP_MS);

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

      const systemStream = systemResult.status === "fulfilled" ? systemResult.value : null;
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
      return notePath;
    },
    [state, cleanup, scheduleDebouncedWrite, refreshSolomonAccount, appendLocalFinal],
  );

  const stop = useCallback(async () => {
    if (state !== "recording") return;
    setState("stopping");

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
