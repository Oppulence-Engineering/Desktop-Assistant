import { utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WhisperError,
  timeoutFor,
  type RunResult,
  type WhisperErrorCode,
  type WhisperPcmRunner,
} from "@x/core/dist/voice/whisper/index.js";

type UtilityChild = ReturnType<typeof utilityProcess.fork>;

interface UtilityResponse {
  id: string;
  type: "transcribe:result";
  success: boolean;
  result?: RunResult;
  code?: string;
  message?: string;
}

interface PendingRequest {
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function utilityEntryPath(): string {
  return join(__dirname, "whisper-utility.cjs");
}

export class WhisperUtilityRunner {
  private child: UtilityChild | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly resolveBinaryPath: () => string) {}

  readonly transcribePcm: WhisperPcmRunner = (pcm, opts) => {
    const child = this.ensureChild();
    const id = randomUUID();
    const timeoutMs = (opts.timeoutMs ?? timeoutFor(opts.audioSeconds)) + 5_000;
    const pcm16 = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);

    return new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new WhisperError("engine_timeout", `utility process timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        child.postMessage({
          id,
          type: "transcribe",
          binPath: this.resolveBinaryPath(),
          pcm16,
          opts,
        });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new WhisperError("engine_unavailable", (err as Error).message));
      }
    });
  };

  private ensureChild(): UtilityChild {
    if (this.child) return this.child;

    const child = utilityProcess.fork(utilityEntryPath(), [], {
      stdio: "pipe",
      serviceName: "Whisper Transcription",
    });
    this.child = child;

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[voice] whisper utility stdout: ${text}`);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[voice] whisper utility stderr: ${text}`);
    });
    child.on("message", (message) => this.handleMessage(message as UtilityResponse));
    child.on("exit", (code) => {
      const err = new WhisperError("engine_crashed", `utility process exited: ${code}`);
      this.child = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(err);
        this.pending.delete(id);
      }
    });

    return child;
  }

  private handleMessage(message: UtilityResponse): void {
    if (message.type !== "transcribe:result") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.success && message.result) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(
      new WhisperError(
        (message.code as WhisperErrorCode | undefined) ?? "engine_crashed",
        message.message,
      ),
    );
  }
}
