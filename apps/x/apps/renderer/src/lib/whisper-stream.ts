import type { WhisperSegment } from "@x/shared/dist/transcription.js";

/**
 * Renderer-side driver for a local streaming-transcription session (RFC 009 §15,
 * Appendix G). `whisper:openStream` returns a streamId; the main process transfers
 * a MessagePort which the preload re-posts onto the DOM window. We grab the port
 * (matched by streamId), then exchange transferable PCM frames for finals over it.
 */

interface StreamDownMessage {
  v: 1;
  // 'done' is the terminal signal after the engine has drained + posted the tail finals.
  type: "ready" | "ack" | "partial" | "final" | "error" | "done";
  seq?: number;
  credits?: number;
  segment?: WhisperSegment;
  code?: string;
}

/** Hard ceiling on how long close() waits for the engine to drain the tail. */
const CLOSE_DRAIN_TIMEOUT_MS = 8000;
/** Hard ceiling on the MessagePort hand-off after openStream resolves. */
const PORT_HANDOFF_TIMEOUT_MS = 5000;
/** Hard ceiling on model/VAD ensure + Session construction after the port is handed off. */
const SESSION_READY_TIMEOUT_MS = 60_000;

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
  let resolvePort: ((port: MessagePort | null) => void) | null = null;
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

  // Await the transferred port, but never hang forever — if the hand-off is missed
  // (frame torn down → senderFrame null, streamId mismatch) reject so the caller can
  // clean up its mic/screen capture instead of being stuck "connecting".
  const buffered = portsByStreamId.get(myStreamId);
  const port =
    buffered ??
    (await new Promise<MessagePort | null>((resolve) => {
      resolvePort = resolve;
      setTimeout(() => resolve(null), PORT_HANDOFF_TIMEOUT_MS);
    }));
  window.removeEventListener("message", onWindowMessage);
  if (!port) {
    void window.ipc.invoke("whisper:closeStream", { streamId: myStreamId }).catch(() => {});
    opts.onError?.("engine_unavailable");
    return null;
  }

  let credits = 3;
  let seq = 0;
  let closed = false;
  let onDone: (() => void) | null = null;
  let ready = false;
  let resolveReady: ((ok: boolean) => void) | null = null;
  const readyPromise = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
    setTimeout(() => resolve(false), SESSION_READY_TIMEOUT_MS);
  });

  port.onmessage = (event: MessageEvent) => {
    const m = event.data as StreamDownMessage;
    if (m.type === "ready") {
      ready = true;
      if (typeof m.credits === "number") credits = m.credits;
      resolveReady?.(true);
    } else if (m.type === "ack" && typeof m.credits === "number") {
      credits = m.credits;
    } else if (m.type === "final" && m.segment) {
      opts.onFinal(m.segment);
    } else if (m.type === "error" && m.code) {
      opts.onError?.(m.code);
      if (!ready) resolveReady?.(false);
    } else if (m.type === "done") {
      onDone?.();
    }
  };
  port.start();
  if (!(await readyPromise)) {
    closed = true;
    port.close();
    void window.ipc.invoke("whisper:closeStream", { streamId: myStreamId }).catch(() => {});
    opts.onError?.("engine_unavailable");
    return null;
  }

  return {
    send(pcm16: ArrayBuffer) {
      if (closed || credits <= 0) return; // backpressure / teardown: drop rather than buffer or throw
      credits--;
      try {
        // Do not transfer the nested PCM ArrayBuffer here. In Electron's DOM
        // MessagePort -> MessagePortMain path, transferring this buffer can
        // detach/drop the payload before the main-process session sees it. The
        // meeting frame is small (~16 KB), so cloning is reliable and cheap.
        port.postMessage({ v: 1, type: "audio", seq: seq++, pcm16, channels: opts.channels });
      } catch {
        /* port closed mid-teardown (a late onaudioprocess) — drop the frame */
      }
    },
    flush() {
      if (closed) return;
      try {
        port.postMessage({ v: 1, type: "flush" });
      } catch {
        /* port already closed */
      }
    },
    async close() {
      // Idempotent: a second close() (e.g. stop() and a teardown both calling it) must not
      // re-post 'close', overwrite onDone, or double-invoke closeStream — which would leave
      // the first caller's drain to time out for the full CLOSE_DRAIN_TIMEOUT_MS.
      if (closed) return;
      // Stop accepting frames first, so a late onaudioprocess can't post onto the port
      // we're about to tear down.
      closed = true;
      // Ask the engine to transcribe the tail, then wait (bounded) for it to deliver
      // the trailing finals + the 'done' signal BEFORE closing our port — otherwise
      // the last utterance's final would arrive on an already-closed port and be lost.
      const drained = new Promise<void>((resolve) => {
        onDone = resolve;
        setTimeout(resolve, CLOSE_DRAIN_TIMEOUT_MS);
      });
      try {
        port.postMessage({ v: 1, type: "close" });
      } catch {
        /* port already closed */
      }
      await drained;
      port.close();
      await window.ipc.invoke("whisper:closeStream", { streamId: myStreamId! }).catch(() => {});
    },
  };
}
