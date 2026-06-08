import type { WhisperSegment } from "@x/shared/dist/transcription.js";

/**
 * Renderer-side driver for a local streaming-transcription session (RFC 009 §15,
 * Appendix G). `whisper:openStream` returns a streamId; the main process transfers
 * a MessagePort which the preload re-posts onto the DOM window. We grab the port
 * (matched by streamId), then exchange transferable PCM frames for finals over it.
 */

interface StreamDownMessage {
  v: 1;
  type: "ack" | "partial" | "final" | "error";
  seq?: number;
  credits?: number;
  segment?: WhisperSegment;
  code?: string;
}

export interface WhisperStreamHandle {
  /** Send a chunk of interleaved int16 PCM (zero-copy transfer; respects credits). */
  send(pcm16: ArrayBuffer): void;
  /** Signal end-of-speech so the engine transcribes the open tail. */
  flush(): void;
  /** Transcribe the tail and tear down the session. */
  close(): Promise<void>;
}

export interface OpenWhisperStreamOptions {
  channels: 1 | 2;
  model?: string;
  onFinal: (segment: WhisperSegment) => void;
  onError?: (code: string) => void;
}

/** Open a streaming session. Returns null if the engine could not start. */
export async function openWhisperStream(
  opts: OpenWhisperStreamOptions,
): Promise<WhisperStreamHandle | null> {
  // Buffer any port that arrives before we learn our streamId (no lost-race window).
  const portsByStreamId = new Map<string, MessagePort>();
  let resolvePort: ((port: MessagePort) => void) | null = null;
  let myStreamId: string | null = null;

  const onWindowMessage = (event: MessageEvent) => {
    const streamId = (event.data as { __rowboatWhisperStreamPort?: string })
      ?.__rowboatWhisperStreamPort;
    const port = event.ports?.[0];
    if (!streamId || !port) return;
    if (myStreamId && streamId === myStreamId) {
      resolvePort?.(port);
    } else {
      portsByStreamId.set(streamId, port);
    }
  };
  window.addEventListener("message", onWindowMessage);

  let res: { streamId: string; code?: string };
  try {
    res = await window.ipc.invoke("whisper:openStream", {
      channels: opts.channels,
      model: opts.model,
    });
  } catch {
    window.removeEventListener("message", onWindowMessage);
    opts.onError?.("engine_unavailable");
    return null;
  }
  if (res.code || !res.streamId) {
    window.removeEventListener("message", onWindowMessage);
    opts.onError?.(res.code ?? "engine_unavailable");
    return null;
  }
  myStreamId = res.streamId;

  const port =
    portsByStreamId.get(myStreamId) ??
    (await new Promise<MessagePort>((resolve) => {
      resolvePort = resolve;
    }));
  window.removeEventListener("message", onWindowMessage);

  let credits = 3;
  let seq = 0;

  port.onmessage = (event: MessageEvent) => {
    const m = event.data as StreamDownMessage;
    if (m.type === "ack" && typeof m.credits === "number") {
      credits = m.credits;
    } else if (m.type === "final" && m.segment) {
      opts.onFinal(m.segment);
    } else if (m.type === "error" && m.code) {
      opts.onError?.(m.code);
    }
  };
  port.start();

  return {
    send(pcm16: ArrayBuffer) {
      if (credits <= 0) return; // backpressure: drop rather than grow an unbounded buffer
      credits--;
      port.postMessage({ v: 1, type: "audio", seq: seq++, pcm16, channels: opts.channels }, [
        pcm16,
      ]);
    },
    flush() {
      port.postMessage({ v: 1, type: "flush" });
    },
    async close() {
      try {
        port.postMessage({ v: 1, type: "close" });
      } catch {
        /* port already closed */
      }
      port.close();
      await window.ipc.invoke("whisper:closeStream", { streamId: myStreamId! }).catch(() => {});
    },
  };
}
