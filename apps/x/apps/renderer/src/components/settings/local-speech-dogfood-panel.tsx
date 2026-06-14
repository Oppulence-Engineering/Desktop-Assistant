import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, Mic, Square } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { WhisperDiagnosticResult } from "@x/shared/dist/transcription.js";

const TARGET_SAMPLE_RATE = 16000;
const EXPECTED_TEXT = "the quick brown fox jumps over the lazy dog";

type Status = "idle" | "recording" | "transcribing";

export function LocalSpeechDogfoodPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<WhisperDiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const recordingRef = useRef(false);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const stopAudio = useCallback(() => {
    requestIdRef.current += 1;
    recordingRef.current = false;
    disconnectNode(processorRef.current);
    disconnectNode(sourceRef.current);
    stopMediaStream(streamRef.current);
    closeAudioContext(audioCtxRef.current);
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAudio();
    };
  }, [stopAudio]);

  const startRecording = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);
    setResult(null);
    setLevel(0);
    chunksRef.current = [];

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        stopMediaStream(stream);
        return;
      }

      audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        stopMediaStream(stream);
        closeAudioContext(audioCtx);
        return;
      }

      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      sourceRef.current = source;
      processorRef.current = processor;
      recordingRef.current = true;
      setStatus("recording");

      const inputSampleRate = audioCtx.sampleRate;
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;

        const float32 = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(float32ToInt16(float32, inputSampleRate));
        setLevel(levelFromSamples(float32));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err) {
      stopMediaStream(stream);
      closeAudioContext(audioCtx);
      if (mountedRef.current && requestIdRef.current === requestId) {
        stopAudio();
        setStatus("idle");
        setError(err instanceof Error ? err.message : "Microphone unavailable");
      }
    }
  }, [stopAudio]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    stopAudio();
    setLevel(0);

    const pcm = concatChunks(chunks);
    if (pcm.length === 0) {
      setStatus("idle");
      return;
    }

    setStatus("transcribing");
    try {
      const diagnostic = await window.ipc.invoke("whisper:diagnose", {
        pcm16: pcm.buffer as ArrayBuffer,
        sampleRate: TARGET_SAMPLE_RATE,
        expectedText: EXPECTED_TEXT,
      });
      setResult(diagnostic);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnostic failed");
    } finally {
      setStatus("idle");
    }
  }, [stopAudio]);

  const recording = status === "recording";
  const transcribing = status === "transcribing";

  return (
    <div className="rounded-none border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">Local mic check</div>
          <div className="truncate text-xs text-muted-foreground">{EXPECTED_TEXT}</div>
        </div>
        {recording ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={stopRecording}>
            <Square className="size-3.5 fill-current" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={startRecording}
            disabled={transcribing}
          >
            {transcribing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Mic className="size-3.5" />
            )}
            {transcribing ? "Running" : "Record"}
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Progress value={recording ? level : 0} className="h-1.5 rounded-none" />
        <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
          {recording ? `${level}%` : transcribing ? "..." : "0%"}
        </span>
      </div>

      {result && (
        <div className="mt-3 grid gap-2 border-t pt-3 text-xs">
          <ResultRow label="Model" value={result.model} />
          <ResultRow label="Accel" value={result.accel} />
          <ResultRow label="Duration" value={formatMs(result.durationMs)} />
          <div className="flex items-start gap-2">
            {result.success ? (
              <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 break-words",
                result.success ? "text-foreground" : "text-destructive",
              )}
            >
              {result.success
                ? result.text || "No speech detected"
                : result.code || "engine_crashed"}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 border-t pt-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function concatChunks(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function closeAudioContext(audioCtx: AudioContext | null): void {
  void audioCtx?.close().catch(() => {});
}

function disconnectNode(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    /* already disconnected */
  }
}

function float32ToInt16(input: Float32Array, sourceSampleRate: number): Int16Array {
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sample = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return output;
}

function levelFromSamples(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(100, Math.round(rms * 240));
}

function formatMs(durationMs: number): string {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs)}ms`;
}
