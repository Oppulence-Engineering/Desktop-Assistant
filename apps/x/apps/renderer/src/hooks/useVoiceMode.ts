import { useCallback, useRef, useState } from "react";
import { buildDeepgramListenUrl } from "@/lib/deepgram-listen-url";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import posthog from "posthog-js";
import * as analytics from "@/lib/analytics";
import type { TranscriptionProvider } from "@x/shared/dist/transcription.js";

// 'transcribing' is whisper-local only: the mic is released and the on-device engine
// is producing text (no live interim, unlike Deepgram's per-word partials).
export type VoiceState = "idle" | "connecting" | "listening" | "transcribing";

const DEEPGRAM_PARAMS = new URLSearchParams({
  model: "nova-3",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  language: "en",
  endpointing: "100",
  no_delay: "true",
});
const DEEPGRAM_LISTEN_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`;

// Cache auth details so we don't need IPC round-trips on every mic click
let cachedAuth:
  | { type: "solomon"; url: string; token: string }
  | { type: "local"; apiKey: string }
  | null = null;

export function useVoiceMode() {
  const { refresh: refreshSolomonAccount } = useSolomonAccount();
  const [state, setState] = useState<VoiceState>("idle");
  const [interimText, setInterimText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transcriptBufferRef = useRef("");
  const interimRef = useRef("");
  // Buffer audio chunks captured before the WebSocket is ready
  const audioBufferRef = useRef<ArrayBuffer[]>([]);
  // Resolved transcription provider + on-device PCM accumulation (RFC 009 §12/§14)
  const providerRef = useRef<TranscriptionProvider>("deepgram");
  const pcmChunksRef = useRef<Int16Array[]>([]);

  // Refresh cached auth details (called on warmup, not on mic click)
  const refreshAuth = useCallback(async () => {
    // Resolve which provider to use first — the tiering + capability gate runs in main.
    try {
      const resolved = await window.ipc.invoke("transcription:getVoiceProvider", null);
      providerRef.current = resolved.provider;
    } catch {
      providerRef.current = "deepgram";
    }
    if (providerRef.current === "whisper-local") {
      // No cloud auth needed for on-device transcription.
      cachedAuth = null;
      return;
    }
    const account = await refreshSolomonAccount();
    if (account?.signedIn && account.accessToken && account.config?.websocketApiUrl) {
      cachedAuth = {
        type: "solomon",
        url: account.config.websocketApiUrl,
        token: account.accessToken,
      };
    } else {
      const config = await window.ipc.invoke("voice:getConfig", null);
      if (config?.deepgram) {
        cachedAuth = { type: "local", apiKey: config.deepgram.apiKey };
      }
    }
  }, [refreshSolomonAccount]);

  // Create and connect a Deepgram WebSocket using cached auth.
  // Starts the connection and returns immediately (does not wait for open).
  const connectWs = useCallback(async () => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    )
      return;

    // Refresh auth if we don't have it cached yet
    if (!cachedAuth) {
      await refreshAuth();
    }
    if (!cachedAuth) return;

    let ws: WebSocket;
    if (cachedAuth.type === "solomon") {
      const listenUrl = buildDeepgramListenUrl(cachedAuth.url, DEEPGRAM_PARAMS);
      ws = new WebSocket(listenUrl, ["bearer", cachedAuth.token]);
    } else {
      ws = new WebSocket(DEEPGRAM_LISTEN_URL, ["token", cachedAuth.apiKey]);
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

      const transcript = data.channel.alternatives[0].transcript;
      if (!transcript) return;

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
  }, [refreshAuth]);

  // Stop audio capture and close WS
  const stopAudioCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    audioBufferRef.current = [];
    setInterimText("");
    transcriptBufferRef.current = "";
    interimRef.current = "";
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;

    transcriptBufferRef.current = "";
    interimRef.current = "";
    setInterimText("");
    audioBufferRef.current = [];
    pcmChunksRef.current = [];

    // Show listening immediately — don't wait for WebSocket
    setState("listening");
    analytics.voiceInputStarted();
    posthog.people.set_once({ has_used_voice: true });

    const useLocal = providerRef.current === "whisper-local";
    analytics.transcriptionStarted({ provider: providerRef.current, mode: "voice" });

    // Kick off mic + (cloud only) WebSocket in parallel, don't await WebSocket
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
        console.error("Microphone access denied:", err);
        return null;
      }),
      useLocal ? Promise.resolve() : connectWs(),
    ]);

    if (!stream) {
      setState("idle");
      return;
    }

    mediaStreamRef.current = stream;

    // Start audio capture immediately — buffer if WS isn't open yet
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      if (providerRef.current === "whisper-local") {
        // Accumulate locally; we transcribe the whole utterance on submit().
        pcmChunksRef.current.push(int16);
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(int16.buffer);
      } else {
        // WebSocket still connecting — buffer the audio
        audioBufferRef.current.push(int16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }, [state, connectWs]);

  /** Concatenate buffered on-device PCM, transcribe via IPC, return the text. */
  const submitLocal = useCallback(async (): Promise<string> => {
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    stopAudioCapture();

    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total === 0) return "";
    const merged = new Int16Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    setState("transcribing");
    const startedAt = performance.now();
    try {
      const res = await window.ipc.invoke("whisper:transcribe", {
        pcm16: merged.buffer as ArrayBuffer,
        sampleRate: 16000,
        channels: 1,
      });
      if (!res.success) {
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
      return (res.text ?? "").trim();
    } catch {
      analytics.transcriptionFailed({
        provider: "whisper-local",
        mode: "voice",
        code: "engine_crashed",
      });
      return "";
    } finally {
      setState("idle");
    }
  }, [stopAudioCapture]);

  /** Stop recording and return the full transcript. Async to support on-device transcription. */
  const submit = useCallback(async (): Promise<string> => {
    if (providerRef.current === "whisper-local") {
      return submitLocal();
    }
    // Cloud path: the transcript is already accumulated from the WS stream.
    let text = transcriptBufferRef.current;
    if (interimRef.current) {
      text += (text ? " " : "") + interimRef.current;
    }
    text = text.trim();
    stopAudioCapture();
    return text;
  }, [stopAudioCapture, submitLocal]);

  /** Cancel recording without returning transcript */
  const cancel = useCallback(() => {
    pcmChunksRef.current = [];
    stopAudioCapture();
  }, [stopAudioCapture]);

  /** Pre-cache provider + auth so the mic click skips IPC round-trips */
  const warmup = useCallback(() => {
    refreshAuth().catch(() => {});
  }, [refreshAuth]);

  return { state, interimText, start, submit, cancel, warmup };
}
