import { useCallback, useEffect, useRef, useState } from "react";
import { onRendererEvent } from "@/lib/renderer-events";
import { buildDeepgramListenUrl } from "@/lib/deepgram-listen-url";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import posthog from "posthog-js";
import * as analytics from "@/lib/analytics";
import {
  rankedAvailableMicrophoneIds,
  uniqueMicrophonePriority,
} from "@/lib/dictation-microphones";
import { prepareVoiceCapture } from "@/lib/voice-capture-startup";
import {
  DICTATION_LANGUAGE_CODES,
  type DictationLanguage,
  type TranscriptionProvider,
} from "@x/shared/transcription";

// 'transcribing' is whisper-local only: the mic is released and the on-device engine
// is producing text (no live interim, unlike Deepgram's per-word partials).
export type VoiceState = "idle" | "connecting" | "listening" | "transcribing";
type SubmitFailure = "no-speech" | "transcription" | null;
type VoiceSurface = "voice" | "dictation" | "command";
type VoiceSubmitMetrics = {
  audioDurationMs: number;
  transcriptionDurationMs?: number;
  engine: "parakeet" | "whisper" | "solomon" | "deepgram" | "unknown";
  language?: DictationLanguage;
};

const DICTATION_LANGUAGES = new Set<string>(DICTATION_LANGUAGE_CODES);

function deepgramParams(language: DictationLanguage): URLSearchParams {
  return new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    // Nova-3 multilingual is the supported streaming auto-detection path.
    language: language === "auto" ? "multi" : language,
    endpointing: "100",
    no_delay: "true",
  });
}
// At 16 kHz this is a 32 ms capture quantum. The previous 2,048-frame processor
// could leave up to 128 ms of the user's final word waiting in Web Audio when the
// hold shortcut was released. Keep the callback small while the mic is active so
// local inference can begin closer to key-up and trailing speech is not clipped.
const VOICE_CAPTURE_BUFFER_SIZE = 512;
const MICROPHONE_CONSTRAINTS = {
  channelCount: 1,
  sampleRate: 16000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} satisfies MediaTrackConstraints;

async function openRankedMicrophone(priority: string[]): Promise<MediaStream | null> {
  const normalizedPriority = uniqueMicrophonePriority(priority);
  if (normalizedPriority.length) {
    try {
      const candidates = rankedAvailableMicrophoneIds(
        await navigator.mediaDevices.enumerateDevices(),
        normalizedPriority,
      );
      for (const deviceId of candidates) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            audio: { ...MICROPHONE_CONSTRAINTS, deviceId: { exact: deviceId } },
          });
        } catch (error) {
          console.warn("[voice] ranked microphone unavailable; trying the next device", {
            deviceId,
            error,
          });
        }
      }
    } catch (error) {
      console.warn("[voice] could not enumerate ranked microphones", error);
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_CONSTRAINTS }).catch((error) => {
    console.error("Microphone access denied:", error);
    return null;
  });
}

// Cache auth details so we don't need IPC round-trips on every mic click
let cachedAuth:
  | { type: "solomon"; url: string; token: string }
  | { type: "local"; apiKey: string }
  | null = null;

export function useVoiceMode(options: { surface?: VoiceSurface } = {}) {
  const surface = options.surface ?? "voice";
  const { refresh: refreshSolomonAccount } = useSolomonAccount({ autoRefresh: false });
  const [state, setState] = useState<VoiceState>("idle");
  // React state commits asynchronously. Keep the capture gate synchronous so a
  // cancel followed immediately by another shortcut press can start at once.
  const stateRef = useRef<VoiceState>("idle");
  const [interimText, setInterimText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const deviceChangeHandlerRef = useRef<(() => void) | null>(null);
  const captureGenerationRef = useRef(0);
  const microphoneRecoveryRef = useRef<Promise<void> | null>(null);
  const recoverMicrophoneHandlerRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const captureMicrophonePriorityRef = useRef<string[]>([]);
  const [activeMicrophoneLabel, setActiveMicrophoneLabel] = useState<string | null>(null);
  const transcriptBufferRef = useRef("");
  const interimRef = useRef("");
  // Buffer audio chunks captured before the WebSocket is ready
  const audioBufferRef = useRef<ArrayBuffer[]>([]);
  // Resolved transcription provider + on-device PCM accumulation (RFC 009 §12/§14)
  const providerRef = useRef<TranscriptionProvider>("deepgram");
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const lastSubmitFailureRef = useRef<SubmitFailure>(null);
  const lastSubmitMetricsRef = useRef<VoiceSubmitMetrics | null>(null);
  const captureSurfaceRef = useRef<VoiceSurface>(surface);
  const captureLanguageRef = useRef<DictationLanguage>("auto");
  const detectedLanguagesRef = useRef<Set<DictationLanguage>>(new Set());
  const privacyGenerationRef = useRef(0);

  const updateState = useCallback((nextState: VoiceState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const readLocalOnlyPrivacy = useCallback(async (): Promise<boolean> => {
    try {
      const cfg = await window.ipc.invoke("transcription:getConfig", null);
      return cfg.privacy.localOnly;
    } catch {
      /* Keep the existing provider/auth path if config cannot be read. */
    }
    return false;
  }, []);

  const resolveProvider = useCallback(async (): Promise<TranscriptionProvider> => {
    // Resolve which provider to use first — the tiering + capability gate runs in main.
    try {
      const resolved = await window.ipc.invoke("transcription:getVoiceProvider", null);
      providerRef.current = resolved.provider;
    } catch {
      providerRef.current = "deepgram";
    }
    console.log("[voice] provider resolved", { provider: providerRef.current });
    if (providerRef.current === "whisper-local" || providerRef.current === "none") {
      cachedAuth = null;
    }
    return providerRef.current;
  }, []);

  // Refresh cached auth details (called on warmup, not on mic click)
  const refreshAuth = useCallback(
    async (resolvedProvider?: TranscriptionProvider) => {
      const provider = resolvedProvider ?? (await resolveProvider());
      if (provider === "whisper-local" || provider === "none") return;

      // No stale cloud credentials should survive a cloud auth refresh.
      cachedAuth = null;
      const account = await refreshSolomonAccount();
      if (providerRef.current === "whisper-local" || (await readLocalOnlyPrivacy())) {
        providerRef.current = "whisper-local";
        cachedAuth = null;
        return;
      }
      if (account?.signedIn && account.accessToken && account.config?.websocketApiUrl) {
        cachedAuth = {
          type: "solomon",
          url: account.config.websocketApiUrl,
          token: account.accessToken,
        };
      } else {
        const config = await window.ipc.invoke("voice:getConfig", null);
        if (await readLocalOnlyPrivacy()) {
          providerRef.current = "whisper-local";
          cachedAuth = null;
          return;
        }
        if (config?.deepgram) {
          cachedAuth = { type: "local", apiKey: config.deepgram.apiKey };
        }
      }
    },
    [refreshSolomonAccount, resolveProvider, readLocalOnlyPrivacy],
  );

  // Create and connect a Deepgram WebSocket using cached auth.
  // Starts the connection and returns immediately (does not wait for open).
  const connectWs = useCallback(
    async (resolvedProvider?: TranscriptionProvider, expectedCaptureGeneration?: number) => {
      const generation = privacyGenerationRef.current;
      const provider = resolvedProvider ?? (await resolveProvider());
      if (provider === "whisper-local" || provider === "none") return;
      if (
        expectedCaptureGeneration !== undefined &&
        expectedCaptureGeneration !== captureGenerationRef.current
      ) {
        return;
      }

      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      )
        return;

      // Refresh auth if we don't have it cached yet
      if (!cachedAuth) {
        await refreshAuth(provider);
      }
      if (
        generation !== privacyGenerationRef.current ||
        (expectedCaptureGeneration !== undefined &&
          expectedCaptureGeneration !== captureGenerationRef.current) ||
        providerRef.current === "whisper-local" ||
        (await readLocalOnlyPrivacy())
      ) {
        providerRef.current = "whisper-local";
        cachedAuth = null;
        return;
      }
      if (!cachedAuth) return;

      const params = deepgramParams(captureLanguageRef.current);
      let ws: WebSocket;
      if (cachedAuth.type === "solomon") {
        const listenUrl = buildDeepgramListenUrl(cachedAuth.url, params);
        ws = new WebSocket(listenUrl, ["bearer", cachedAuth.token]);
      } else {
        ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
          "token",
          cachedAuth.apiKey,
        ]);
      }
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[voice] WebSocket connected");
        // Flush any buffered audio captured while we were connecting
        const buffered = audioBufferRef.current;
        audioBufferRef.current = [];
        for (const chunk of buffered) {
          ws.send(chunk);
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (!data.channel?.alternatives?.[0]) return;

        const alternative = data.channel.alternatives[0];
        const transcript = alternative.transcript;
        if (!transcript) return;

        const reportedLanguages = [
          ...(Array.isArray(alternative.languages) ? alternative.languages : []),
          ...(Array.isArray(alternative.words)
            ? alternative.words.map((word: { language?: unknown }) => word.language)
            : []),
        ];
        for (const value of reportedLanguages) {
          if (typeof value === "string" && value !== "auto" && DICTATION_LANGUAGES.has(value)) {
            detectedLanguagesRef.current.add(value as DictationLanguage);
          }
        }

        if (data.is_final) {
          transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + transcript;
          interimRef.current = "";
          setInterimText(transcriptBufferRef.current);
        } else {
          interimRef.current = transcript;
          setInterimText(
            transcriptBufferRef.current + (transcriptBufferRef.current ? " " : "") + transcript,
          );
        }
      };

      ws.onerror = () => {
        console.error("[voice] WebSocket error");
        // Auth may be stale — clear cache so next attempt refreshes
        cachedAuth = null;
      };

      ws.onclose = () => {
        console.log("[voice] WebSocket closed");
        wsRef.current = null;
      };
    },
    [refreshAuth, resolveProvider, readLocalOnlyPrivacy],
  );

  // Stop audio capture and close WS
  const stopAudioCapture = useCallback((nextState: VoiceState = "idle") => {
    captureGenerationRef.current += 1;
    if (deviceChangeHandlerRef.current) {
      navigator.mediaDevices.removeEventListener("devicechange", deviceChangeHandlerRef.current);
      deviceChangeHandlerRef.current = null;
    }
    microphoneRecoveryRef.current = null;
    recoverMicrophoneHandlerRef.current = null;
    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    setActiveMicrophoneLabel(null);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    audioBufferRef.current = [];
    setInterimText("");
    transcriptBufferRef.current = "";
    interimRef.current = "";
    updateState(nextState);
  }, [updateState]);

  useEffect(() => {
    const closeCloudTransportForLocalOnly = (
      detail: { privacy?: { localOnly?: boolean } } | undefined,
    ) => {
      if (detail?.privacy?.localOnly !== true) return;
      privacyGenerationRef.current += 1;
      cachedAuth = null;
      if (providerRef.current !== "whisper-local" || wsRef.current) {
        providerRef.current = "whisper-local";
        stopAudioCapture();
      }
    };

    return onRendererEvent("transcription-config-changed", closeCloudTransportForLocalOnly);
  }, [stopAudioCapture]);

  const start = useCallback(
    async (
      nextSurface: VoiceSurface = surface,
      nextLanguage: DictationLanguage = nextSurface === "voice" ? "en" : "auto",
      nextMicrophonePriority: string[] = [],
    ): Promise<{
      provider: TranscriptionProvider;
      started: boolean;
    }> => {
      if (stateRef.current !== "idle") {
        return { provider: providerRef.current, started: false };
      }
      // Claim the capture synchronously before any provider or microphone work
      // begins. This prevents two rapid shortcut events from opening two mics.
      updateState("connecting");
      captureSurfaceRef.current = nextSurface;
      captureLanguageRef.current = nextLanguage;
      captureMicrophonePriorityRef.current = uniqueMicrophonePriority(nextMicrophonePriority);
      detectedLanguagesRef.current.clear();

      transcriptBufferRef.current = "";
      interimRef.current = "";
      setInterimText("");
      audioBufferRef.current = [];
      pcmChunksRef.current = [];
      lastSubmitFailureRef.current = null;
      lastSubmitMetricsRef.current = null;
      const captureGeneration = ++captureGenerationRef.current;

      analytics.voiceInputStarted();
      posthog.people.set_once({ has_used_voice: true });

      console.log("[voice] starting microphone acquisition");
      const { provider, stream, cloudTransportPromise } = await prepareVoiceCapture({
        openMicrophone: () => openRankedMicrophone(captureMicrophonePriorityRef.current),
        resolveProvider,
        connectCloudTransport: (resolvedProvider) => connectWs(resolvedProvider, captureGeneration),
        disposeMicrophone: (unusedStream) => {
          unusedStream.getTracks().forEach((track) => track.stop());
        },
      });
      void cloudTransportPromise.catch((error) => {
        console.error("[voice] cloud transport startup failed", error);
      });
      // A canceled acquisition may resolve after its replacement has started.
      // Dispose only its own stream and never mutate the replacement's state.
      if (captureGeneration !== captureGenerationRef.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return { provider: providerRef.current, started: false };
      }
      if (provider === "none") {
        console.warn("[voice] local-only transcription is unavailable on this device");
        analytics.transcriptionFailed({
          provider: "whisper-local",
          mode: "voice",
          code: "device_unsupported",
        });
        updateState("idle");
        return { provider: "none", started: false };
      }
      console.log("[voice] starting mic capture", { provider });
      analytics.transcriptionStarted({ provider: providerRef.current, mode: "voice" });

      if (!stream) {
        console.warn("[voice] mic capture did not start");
        updateState("idle");
        return { provider: providerRef.current, started: false };
      }

      mediaStreamRef.current = stream;
      console.log("[voice] mic capture started", {
        audioTracks: stream.getAudioTracks().length,
        provider,
      });

      // Start audio capture immediately — buffer if WS isn't open yet
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch((error) => {
          console.warn("[voice] audio context resume failed", error);
        });
      }
      if (
        captureGeneration !== captureGenerationRef.current ||
        audioCtxRef.current !== audioCtx
      ) {
        stream.getTracks().forEach((track) => track.stop());
        await audioCtx.close().catch(() => {});
        return { provider: providerRef.current, started: false };
      }
      const source = audioCtx.createMediaStreamSource(stream);
      mediaSourceRef.current = source;
      const processor = audioCtx.createScriptProcessor(VOICE_CAPTURE_BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        if (captureSurfaceRef.current !== "voice" || providerRef.current === "whisper-local") {
          // Dictation always retains its exact in-memory PCM until submit so a
          // failed cloud transcript can still become a local retry item.
          pcmChunksRef.current.push(int16);
        }
        if (
          providerRef.current !== "whisper-local" &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          wsRef.current.send(int16.buffer);
        } else if (providerRef.current !== "whisper-local") {
          // WebSocket still connecting — buffer the audio
          audioBufferRef.current.push(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      const installRecoveryHandler = (activeStream: MediaStream) => {
        const track = activeStream.getAudioTracks()[0];
        setActiveMicrophoneLabel(track?.label || null);
        if (track) {
          track.onended = () => {
            void recoverMicrophone(true);
          };
        }
      };

      const recoverMicrophone = async (force = false): Promise<void> => {
        if (captureGeneration !== captureGenerationRef.current || !processorRef.current) return;
        if (microphoneRecoveryRef.current) return microphoneRecoveryRef.current;

        const recovery = (async () => {
          const currentStream = mediaStreamRef.current;
          const currentTrack = currentStream?.getAudioTracks()[0];
          let availableDevices: MediaDeviceInfo[] = [];
          try {
            availableDevices = await navigator.mediaDevices.enumerateDevices();
          } catch (error) {
            if (!force) {
              console.warn("[voice] could not refresh microphone availability", error);
              return;
            }
          }
          const ranked = rankedAvailableMicrophoneIds(
            availableDevices,
            captureMicrophonePriorityRef.current,
          );
          const desiredDeviceId = ranked[0];
          if (!force && currentTrack?.readyState === "live") {
            const currentDeviceId = currentTrack.getSettings().deviceId;
            if (desiredDeviceId && currentDeviceId === desiredDeviceId) return;
            if (
              !desiredDeviceId &&
              (!currentDeviceId ||
                availableDevices.some(
                  (device) => device.kind === "audioinput" && device.deviceId === currentDeviceId,
                ))
            ) {
              return;
            }
          }

          const replacement = await openRankedMicrophone(captureMicrophonePriorityRef.current);
          if (!replacement) return;
          if (
            captureGeneration !== captureGenerationRef.current ||
            !audioCtxRef.current ||
            !processorRef.current
          ) {
            replacement.getTracks().forEach((track) => track.stop());
            return;
          }

          const replacementSource = audioCtxRef.current.createMediaStreamSource(replacement);
          replacementSource.connect(processorRef.current);
          const previousSource = mediaSourceRef.current;
          const previousStream = mediaStreamRef.current;
          mediaSourceRef.current = replacementSource;
          mediaStreamRef.current = replacement;
          installRecoveryHandler(replacement);
          previousSource?.disconnect();
          previousStream?.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
          });
          console.log("[voice] microphone recovered without ending capture", {
            label: replacement.getAudioTracks()[0]?.label,
          });
        })().finally(() => {
          if (microphoneRecoveryRef.current === recovery) microphoneRecoveryRef.current = null;
        });
        microphoneRecoveryRef.current = recovery;
        return recovery;
      };
      recoverMicrophoneHandlerRef.current = recoverMicrophone;

      installRecoveryHandler(stream);
      const handleDeviceChange = () => {
        void recoverMicrophone(false);
      };
      deviceChangeHandlerRef.current = handleDeviceChange;
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
      updateState("listening");
      return { provider: providerRef.current, started: true };
    },
    [connectWs, resolveProvider, surface, updateState],
  );

  /** Concatenate buffered on-device PCM, transcribe via IPC, return the text. */
  const submitLocal = useCallback(async (): Promise<string> => {
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    stopAudioCapture("transcribing");

    const total = chunks.reduce((n, c) => n + c.length, 0);
    console.log("[voice] local submit captured samples", {
      chunks: chunks.length,
      samples: total,
      audioMs: (total / 16000) * 1000,
    });
    // Ignore accidental taps shorter than 180 ms. Besides producing no useful speech,
    // ultra-short clips are disproportionately likely to make an ASR model hallucinate.
    if (total < 2_880) {
      lastSubmitFailureRef.current = "no-speech";
      updateState("idle");
      return "";
    }
    const merged = new Int16Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const startedAt = performance.now();
    try {
      const request = {
        pcm16: merged.buffer as ArrayBuffer,
        sampleRate: 16000 as const,
        channels: 1 as const,
      };
      const activeSurface = captureSurfaceRef.current;
      const res =
        activeSurface !== "voice"
          ? await window.ipc.invoke("dictation:transcribe", {
              ...request,
              lang: captureLanguageRef.current,
              retainForRetry: activeSurface === "dictation",
            })
          : await window.ipc.invoke("whisper:transcribe", request);
      console.log("[voice] whisper transcribe completed", {
        success: res.success,
        engine: "engine" in res ? res.engine : "whisper",
        code: res.success ? undefined : res.code,
        textLength: res.success ? (res.text ?? "").length : 0,
        rtf: res.success ? res.rtf : undefined,
      });
      if (!res.success) {
        lastSubmitFailureRef.current = "transcription";
        analytics.transcriptionFailed({
          provider: "whisper-local",
          mode: "voice",
          code: res.code ?? "engine_crashed",
        });
        return "";
      }
      analytics.transcriptionCompleted({
        provider: "whisper-local",
        mode: "voice",
        audioMs: (total / 16000) * 1000,
        latencyMs: performance.now() - startedAt,
        rtf: res.rtf,
      });
      const text = (res.text ?? "").trim();
      const responseLanguage =
        "language" in res &&
        typeof res.language === "string" &&
        DICTATION_LANGUAGES.has(res.language)
          ? (res.language as DictationLanguage)
          : captureLanguageRef.current;
      lastSubmitMetricsRef.current = {
        audioDurationMs: (total / 16000) * 1000,
        transcriptionDurationMs: res.durationMs,
        engine: "engine" in res && res.engine === "parakeet" ? "parakeet" : "whisper",
        language: responseLanguage,
      };
      lastSubmitFailureRef.current = text ? null : "transcription";
      return text;
    } catch (error) {
      lastSubmitFailureRef.current = "transcription";
      console.error("[voice] whisper transcribe failed", error);
      analytics.transcriptionFailed({
        provider: "whisper-local",
        mode: "voice",
        code: "engine_crashed",
      });
      return "";
    } finally {
      updateState("idle");
    }
  }, [stopAudioCapture, updateState]);

  /** Stop recording and return the full transcript. Async to support on-device transcription. */
  const submit = useCallback(async (): Promise<string> => {
    if (providerRef.current === "whisper-local") {
      return submitLocal();
    }
    // Cloud path: the transcript is already accumulated from the WS stream.
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    let text = transcriptBufferRef.current;
    if (interimRef.current) {
      text += (text ? " " : "") + interimRef.current;
    }
    text = text.trim();
    stopAudioCapture();
    if (text) {
      const selectedLanguage = captureLanguageRef.current;
      const detected = [...detectedLanguagesRef.current];
      lastSubmitMetricsRef.current = {
        audioDurationMs: (chunks.reduce((count, chunk) => count + chunk.length, 0) / 16000) * 1000,
        engine: providerRef.current === "solomon" ? "solomon" : "deepgram",
        language:
          selectedLanguage !== "auto"
            ? selectedLanguage
            : detected.length === 1
              ? detected[0]
              : "auto",
      };
      lastSubmitFailureRef.current = null;
      return text;
    }
    const total = chunks.reduce((count, chunk) => count + chunk.length, 0);
    if (total < 2_880) {
      lastSubmitFailureRef.current = "no-speech";
      return "";
    }
    lastSubmitFailureRef.current = "transcription";
    if (captureSurfaceRef.current === "dictation") {
      const merged = new Int16Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      await window.ipc
        .invoke("dictation:saveFailedAudio", {
          pcm16: merged.buffer as ArrayBuffer,
          sampleRate: 16_000,
          channels: 1,
          errorCode: "cloud_transcription_failed",
          language: captureLanguageRef.current,
        })
        .catch((error) => console.warn("[voice] could not save failed dictation audio", error));
    }
    return text;
  }, [stopAudioCapture, submitLocal]);

  /** Cancel recording without returning transcript */
  const cancel = useCallback(() => {
    pcmChunksRef.current = [];
    lastSubmitFailureRef.current = null;
    lastSubmitMetricsRef.current = null;
    stopAudioCapture();
  }, [stopAudioCapture]);

  /** Pre-cache provider + auth so the mic click skips IPC round-trips */
  const warmup = useCallback(() => {
    refreshAuth().catch(() => {});
  }, [refreshAuth]);

  const lastSubmitFailure = useCallback(() => lastSubmitFailureRef.current, []);
  const lastSubmitMetrics = useCallback(() => lastSubmitMetricsRef.current, []);
  const setMicrophonePriority = useCallback(async (priority: string[]) => {
    captureMicrophonePriorityRef.current = uniqueMicrophonePriority(priority);
    await recoverMicrophoneHandlerRef.current?.(false);
  }, []);

  return {
    state,
    interimText,
    activeMicrophoneLabel,
    start,
    submit,
    cancel,
    warmup,
    setMicrophonePriority,
    lastSubmitFailure,
    lastSubmitMetrics,
  };
}
