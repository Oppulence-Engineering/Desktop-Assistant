import { transcribePcm, type RunOpts, type RunResult } from "./runner.js";
import { deinterleaveStereoI16, concatI16 } from "./wav.js";
import { autoThreads, timeoutFor } from "./runner.js";
import { codeOf } from "./errors.js";
import type { WhisperErrorCode, WhisperSpeaker } from "@x/shared/transcription";

/**
 * Meeting-mode near-real-time pipeline (RFC 009 §15, Appendix N).
 *
 * Whisper decodes 30 s batches — there is no token streaming — so we segment on
 * speech boundaries with a cheap energy VAD and batch-transcribe each closed
 * segment as it ends (Silero `--vad` then cleans each segment inside whisper-cli).
 * One segmenter per channel: mic → "you", system → "other".
 */

const RATE = 16000;
const FRAME = 480; // 30 ms @ 16 kHz

// Backpressure: the renderer's credit window shrinks as the transcribe queue grows,
// so a device slower than realtime sheds incoming frames instead of buffering them.
const MAX_CREDITS = 6;
// Hard backstop: never retain more than this many closed segments (≈0.9 MB each).
const MAX_QUEUE = 16;

/** Structural port (matches Electron's `MessagePortMain`) — keeps core Electron-free. */
export interface StreamPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

type Channel = WhisperSpeaker;

interface SegParams {
  onMul: number;
  offMul: number;
  minOnFrames: number;
  hangoverMs: number;
  preRollMs: number;
  minSegmentMs: number;
  maxSegmentMs: number;
}

const DEFAULTS: SegParams = {
  onMul: 3.0, // onset threshold = noiseFloor × 3.0
  offMul: 1.8, // trailing threshold (hysteresis: off < on)
  minOnFrames: 3, // ~90 ms sustained to confirm onset (debounce clicks)
  hangoverMs: 700, // trailing silence before closing a segment
  preRollMs: 300, // audio kept before onset so word-starts aren't clipped
  minSegmentMs: 400, // drop sub-400 ms blips (coughs)
  maxSegmentMs: 28000, // force-cut before Whisper's 30 s context
};

interface ClosedSegment {
  channel: Channel;
  startSec: number;
  endSec: number;
  pcm: Int16Array;
}

/**
 * Real-time energy VAD segmenter for one channel. Feed exact FRAME-sized int16
 * frames; receive closed speech segments via the `onSegment` callback. The noise
 * floor adapts (EMA) only during silence, so a loud talker doesn't raise it.
 */
export class EnergyVadSegmenter {
  private state: "silence" | "maybe" | "speech" | "trailing" = "silence";
  private noiseFloor = 200; // adaptive RMS floor (int16 units)
  private onFrames = 0;
  private hangoverFrames = 0;
  private buf: Int16Array[] = []; // current segment frames (incl. pre-roll)
  private preRoll: Int16Array[] = []; // rolling pre-roll ring
  private framesSeen = 0; // for timestamps
  private readonly hangoverLimit: number;
  private readonly preRollLimit: number;
  private readonly minSegFrames: number;
  private readonly maxSegFrames: number;

  constructor(
    private readonly p: SegParams = DEFAULTS,
    private readonly onSegment?: (s: { startSec: number; endSec: number; pcm: Int16Array }) => void,
  ) {
    const framesPerSec = RATE / FRAME;
    this.hangoverLimit = Math.round((p.hangoverMs / 1000) * framesPerSec);
    this.preRollLimit = Math.round((p.preRollMs / 1000) * framesPerSec);
    this.minSegFrames = Math.round((p.minSegmentMs / 1000) * framesPerSec);
    this.maxSegFrames = Math.round((p.maxSegmentMs / 1000) * framesPerSec);
  }

  private rms(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  /** Feed exactly one FRAME-sized int16 frame. */
  pushFrame(frame: Int16Array): void {
    const energy = this.rms(frame);
    const onThreshold = this.noiseFloor * this.p.onMul;
    const offThreshold = this.noiseFloor * this.p.offMul;
    this.framesSeen++;

    // Maintain the pre-roll ring so confirmed onsets keep their leading audio.
    this.preRoll.push(frame);
    if (this.preRoll.length > this.preRollLimit) this.preRoll.shift();

    switch (this.state) {
      case "silence":
        this.noiseFloor = this.noiseFloor * 0.95 + energy * 0.05; // EMA, silence only
        if (energy > onThreshold) {
          this.state = "maybe";
          this.onFrames = 1;
        }
        break;
      case "maybe":
        if (energy > onThreshold) {
          if (++this.onFrames >= this.p.minOnFrames) {
            this.state = "speech";
            this.buf = [...this.preRoll]; // seed with pre-roll so onset isn't clipped
          }
        } else {
          this.state = "silence";
          this.onFrames = 0;
        }
        break;
      case "speech":
        this.buf.push(frame);
        if (energy < offThreshold) {
          this.state = "trailing";
          this.hangoverFrames = 1;
        }
        if (this.buf.length >= this.maxSegFrames) this.emit(); // forced cut
        break;
      case "trailing":
        this.buf.push(frame);
        if (energy >= offThreshold) {
          this.state = "speech";
          this.hangoverFrames = 0;
        } else if (++this.hangoverFrames >= this.hangoverLimit) {
          this.emit();
        }
        break;
    }
  }

  private emit(): void {
    const frames = this.buf;
    this.buf = [];
    this.state = "silence";
    this.onFrames = 0;
    this.hangoverFrames = 0;
    if (frames.length < this.minSegFrames) return; // drop blips
    const endFrame = this.framesSeen;
    const startFrame = endFrame - frames.length;
    this.onSegment?.({
      startSec: (startFrame * FRAME) / RATE,
      endSec: (endFrame * FRAME) / RATE,
      pcm: concatI16(frames),
    });
  }

  /** End of stream: flush an open segment. */
  flush(): void {
    if (this.state === "speech" || this.state === "trailing") this.emit();
  }
}

export interface SessionOpts {
  modelPath: string;
  vadModelPath: string;
  channels: 1 | 2;
  transcribePcm?: (pcm: Int16Array, opts: RunOpts) => Promise<RunResult>;
}

/**
 * One meeting transcription session bound to a transferred MessagePort
 * (Appendix G/N). Owns one segmenter per channel and a single-flight transcribe
 * worker, so a slow device degrades to higher latency, not unbounded memory.
 */
export class Session {
  private readonly chans: Record<Channel, EnergyVadSegmenter>;
  private readonly leftover: Record<Channel, Int16Array> = {
    you: new Int16Array(0),
    other: new Int16Array(0),
  };
  private readonly queue: ClosedSegment[] = [];
  // Serial transcribe chain: each closed segment appends a step, so segments
  // transcribe one-at-a-time and close() can await the whole tail.
  private pump: Promise<void> = Promise.resolve();
  private closing = false; // tearing down: stop accepting audio, drain the tail
  private closed = false; // fully torn down: port closed, no more work

  constructor(
    private readonly port: StreamPort,
    private readonly opts: SessionOpts,
  ) {
    const make = (channel: Channel) =>
      new EnergyVadSegmenter(DEFAULTS, (s) => this.enqueue({ channel, ...s }));
    this.chans = { you: make("you"), other: make("other") };
    this.port.on("message", (e) => this.onMessage(e.data));
    this.port.start();
    this.port.postMessage({ v: 1, type: "ready", credits: MAX_CREDITS });
  }

  private onMessage(message: unknown): void {
    const m = message as { type?: string; pcm16?: ArrayBuffer; seq?: number };
    if (m?.type === "audio" && m.pcm16) {
      if (this.closing) return; // tearing down — stop accepting new audio
      const { mic, sys } =
        this.opts.channels === 2
          ? deinterleaveStereoI16(new Int16Array(m.pcm16))
          : { mic: new Int16Array(m.pcm16), sys: new Int16Array(0) };
      this.feed("you", mic);
      if (this.opts.channels === 2) this.feed("other", sys);
      // Credit reflects queue depth: as the backlog grows the renderer's window
      // shrinks to 0 and it drops frames, rather than buffering without bound.
      this.postCredits(m.seq ?? 0);
    } else if (m?.type === "flush") {
      this.chans.you.flush();
      this.chans.other.flush();
    } else if (m?.type === "close") {
      this.close();
    }
  }

  /** Re-frame an arbitrary chunk into exact FRAME-sized frames (carry leftover). */
  private feed(ch: Channel, chunk: Int16Array): void {
    const merged = concatI16([this.leftover[ch], chunk]);
    let i = 0;
    for (; i + FRAME <= merged.length; i += FRAME) {
      this.chans[ch].pushFrame(merged.subarray(i, i + FRAME));
    }
    this.leftover[ch] = merged.slice(i); // keep the partial frame
  }

  private enqueue(seg: ClosedSegment): void {
    this.queue.push(seg);
    // Bounded backstop: under sustained backpressure drop the OLDEST queued segment
    // rather than grow main-process memory without bound.
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    // Append to the serial pump so segments transcribe one at a time.
    this.pump = this.pump.then(() => this.transcribeNext());
  }

  private postCredits(seq?: number): void {
    if (this.closed) return;
    const message: { v: 1; type: "ack"; credits: number; seq?: number } = {
      v: 1,
      type: "ack",
      credits: Math.max(0, MAX_CREDITS - this.queue.length),
    };
    if (seq !== undefined) message.seq = seq;
    try {
      this.port.postMessage(message);
    } catch {
      /* port already gone */
    }
  }

  /** Transcribe one queued segment (single-flight via the pump chain). */
  private async transcribeNext(): Promise<void> {
    const seg = this.queue.shift();
    if (!seg || this.closed) return;
    const audioSeconds = seg.endSec - seg.startSec;
    try {
      const run = this.opts.transcribePcm ?? transcribePcm;
      const r = await run(seg.pcm, {
        modelPath: this.opts.modelPath,
        vadModelPath: this.opts.vadModelPath,
        lang: "en",
        threads: autoThreads(),
        audioSeconds,
        timeoutMs: timeoutFor(audioSeconds),
      });
      if (r.text && !this.closed) {
        this.port.postMessage({
          v: 1,
          type: "final",
          segment: { start: seg.startSec, end: seg.endSec, text: r.text, speaker: seg.channel },
        });
      }
    } catch (err) {
      if (!this.closed)
        this.port.postMessage({ v: 1, type: "error", code: codeOf(err) as WhisperErrorCode });
    } finally {
      // If backlog drove credits to 0, the renderer is paused and cannot trigger
      // another ack by sending audio. Proactively replenish as the queue drains.
      this.postCredits();
    }
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    // Flush the open tail segments — these append onto the pump BEFORE we await it.
    this.chans.you.flush();
    this.chans.other.flush();
    // Await the entire pump (any in-flight transcription + the just-flushed tail),
    // THEN signal completion and close the port — so trailing finals are delivered.
    void this.pump.finally(() => {
      this.closed = true;
      try {
        this.port.postMessage({ v: 1, type: "done" });
      } catch {
        /* port already gone */
      }
      this.port.close();
    });
  }
}
