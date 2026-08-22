import * as os from "node:os";
import * as path from "node:path";
import { defaultModelId, findModel } from "./catalog.js";
import { ModelManager, type ModelProgress, type ModelManagerDeps } from "./model-manager.js";
import { probe, type Capability } from "./capability.js";
import { transcribePcm, type RunResult, type RunOpts, type Segment } from "./runner.js";
import { deinterleaveStereoI16 } from "./wav.js";
import { vadModelPath } from "./bin.js";
import { Session, type StreamPort, type SessionOpts } from "./streaming.js";
import { runWhisperDiagnostic } from "./diagnostics.js";
import { chooseAutoModel, loadBenchmarkAudio } from "./benchmark.js";
import { WhisperError } from "./errors.js";
import type {
  WhisperBenchmarkProfile,
  WhisperDiagnosticResult,
  WhisperModelHealth,
  WhisperModelSummary,
  WhisperSegment,
} from "@x/shared/transcription";

export type { ModelProgress };

export interface TranscribeOpts {
  channels: 1 | 2;
  model?: string;
  lang?: string;
}

export interface TranscribeResult {
  text: string;
  segments: WhisperSegment[];
  rtf: number;
  durationMs: number;
  /** Effective language of the run, when the engine reported one. */
  language?: string;
  /** False when the model is an `.en` build, which ignores the requested language. */
  multilingualModel?: boolean;
}

export interface WhisperBenchmarkStore {
  read(): Promise<WhisperBenchmarkProfile[]>;
  write(profile: WhisperBenchmarkProfile): Promise<void>;
}

export type WhisperPcmRunner = (pcm: Int16Array, opts: RunOpts) => Promise<RunResult>;

const NOOP_BENCHMARK_STORE: WhisperBenchmarkStore = {
  async read() {
    return [];
  },
  async write() {
    /* optional persistence is wired by the main process */
  },
};

export function whisperBenchmarkDeviceId(): string {
  const cpu = os.cpus()[0]?.model ?? "unknown-cpu";
  const normalizedCpu =
    cpu
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "unknown-cpu";
  const memoryGb = Math.round(os.totalmem() / 1024 ** 3);
  return `${process.platform}-${process.arch}-${normalizedCpu}-${memoryGb}gb`;
}

/**
 * The single facade the IPC layer calls (RFC 009 §7, Appendix X). Ties together
 * the model manager (Appendix P), runner (Q), capability probe (U), catalog (E),
 * and streaming sessions (N); owns default-model resolution and the VAD path.
 *
 * Electron-free: `openStream` receives a structurally-typed {@link StreamPort}, so
 * the main process passes the real `MessagePortMain` without coupling core to Electron.
 */
export class WhisperService {
  private readonly mm: ModelManager;
  private readonly modelsDir: string;
  private readonly benchmarkStore: WhisperBenchmarkStore;
  private readonly transcribePcmRunner: WhisperPcmRunner;
  private readonly sessions = new Map<string, Session>();
  // Streams closed before their Session finished constructing (model still downloading)
  // — so the async openStream tail tears down instead of orphaning a Session.
  private readonly closedBeforeReady = new Set<string>();
  private seq = 0;

  constructor(
    workDir: string,
    onProgress: (p: ModelProgress) => void,
    deps: ModelManagerDeps = {},
    benchmarkStore: WhisperBenchmarkStore = NOOP_BENCHMARK_STORE,
    pcmRunner: WhisperPcmRunner = transcribePcm,
  ) {
    this.modelsDir = path.join(workDir, "models");
    this.mm = new ModelManager(this.modelsDir, onProgress, deps);
    this.benchmarkStore = benchmarkStore;
    this.transcribePcmRunner = pcmRunner;
  }

  capability(): Promise<Capability> {
    return probe();
  }

  async listModels(): Promise<WhisperModelSummary[]> {
    const list = await this.mm.list();
    return list
      .filter((m) => m.downloadable)
      .map((m) => ({
        id: m.id,
        label: m.label,
        sizeMb: m.sizeMb,
        installed: m.installed,
        recommended: !!m.recommendedDefault,
        english: m.english,
      }));
  }

  ensureModel(id: string): Promise<string> {
    return this.mm.ensure(id, { withVad: true });
  }

  removeModel(id: string): Promise<void> {
    return this.mm.remove(id);
  }

  verifyModel(id: string): Promise<WhisperModelHealth> {
    return this.mm.verifyModel(id);
  }

  repairModel(id: string): Promise<WhisperModelHealth> {
    return this.mm.repairModel(id);
  }

  /** Resolve the model id: explicit → auto selector → catalog default (locale-aware). */
  private async resolveModel(explicit?: string, capability?: Capability): Promise<string> {
    const requested = explicit?.trim();
    if (!requested) return defaultModelId();
    if (requested !== "auto")
      return findModel(requested)?.downloadable ? requested : defaultModelId();
    return this.resolveAutoModel(capability);
  }

  private async resolveAutoModel(capability?: Capability): Promise<string> {
    const deviceId = whisperBenchmarkDeviceId();
    const resolvedCapability = capability ?? (await this.capability());
    const profiles = (await this.benchmarkStore.read().catch(() => [])).filter(
      (profile) => profile.deviceId === deviceId && profile.accel === resolvedCapability.accel,
    );
    if (profiles.length === 0) return defaultModelId();

    const selected = chooseAutoModel({
      accel: resolvedCapability.accel,
      memoryGb: os.totalmem() / 1024 ** 3,
      profiles,
    });
    const hasMeasurement = profiles.some((profile) => profile.model === selected);
    return hasMeasurement && findModel(selected)?.downloadable ? selected : defaultModelId();
  }

  /**
   * Batch transcribe (voice mode). `channels: 2` → transcribe mic (ch0, "you") and
   * system (ch1, "other") as two mono passes and merge segments by start time.
   */
  async transcribe(pcm: Int16Array, opts: TranscribeOpts): Promise<TranscribeResult> {
    const modelId = await this.resolveModel(opts.model);
    const modelPath = await this.mm.ensure(modelId, { withVad: true });
    const vad = vadModelPath(this.modelsDir);
    const audioSeconds = pcm.length / 16000 / (opts.channels === 2 ? 2 : 1);

    if (opts.channels === 1) {
      return this.transcribePcmRunner(pcm, {
        modelPath,
        vadModelPath: vad,
        lang: opts.lang,
        audioSeconds,
      });
    }

    const { mic, sys } = deinterleaveStereoI16(pcm);
    const [you, other] = await Promise.all([
      this.transcribePcmRunner(mic, {
        modelPath,
        vadModelPath: vad,
        lang: opts.lang,
        audioSeconds,
      }),
      this.transcribePcmRunner(sys, {
        modelPath,
        vadModelPath: vad,
        lang: opts.lang,
        audioSeconds,
      }),
    ]);
    const segments: WhisperSegment[] = [
      ...you.segments.map((s: Segment) => ({ ...s, speaker: "you" as const })),
      ...other.segments.map((s: Segment) => ({ ...s, speaker: "other" as const })),
    ].sort((a, b) => a.start - b.start);
    return {
      segments,
      text: segments
        .map((s) => s.text)
        .join(" ")
        .trim(),
      rtf: Math.min(you.rtf, other.rtf),
      durationMs: Math.max(you.durationMs, other.durationMs),
      // Both halves ran the same model with the same requested language, so they agree
      // except when one side was silent enough to report nothing.
      language: you.language ?? other.language,
      multilingualModel: you.multilingualModel ?? other.multilingualModel,
    };
  }

  async diagnose(req: {
    pcm16: Int16Array;
    sampleRate: 16000;
    model?: string;
    lang?: string;
    expectedText?: string;
    retainDiagnostics?: boolean;
  }): Promise<WhisperDiagnosticResult> {
    const capability = await this.capability();
    const modelId = await this.resolveModel(req.model, capability);
    const audioSeconds = req.pcm16.length / req.sampleRate;

    return runWhisperDiagnostic({
      pcm16: req.pcm16,
      sampleRate: req.sampleRate,
      model: modelId,
      accel: capability.accel,
      expectedText: req.expectedText,
      retainDiagnostics: req.retainDiagnostics,
      transcribe: async () => {
        const modelPath = await this.mm.ensure(modelId, { withVad: true });
        return this.transcribePcmRunner(req.pcm16, {
          modelPath,
          vadModelPath: vadModelPath(this.modelsDir),
          lang: req.lang ?? "en",
          audioSeconds,
        });
      },
    });
  }

  async benchmark(input: {
    model?: string;
    sampleSeconds: number;
  }): Promise<WhisperBenchmarkProfile> {
    const requestedSeconds = Number.isFinite(input.sampleSeconds) ? input.sampleSeconds : 10;
    const sampleSeconds = Math.max(1, Math.min(60, requestedSeconds));
    const capability = await this.capability();
    const modelId = await this.resolveModel(input.model ?? "auto", capability);
    const audio = await loadBenchmarkAudio(sampleSeconds);
    const pcm = audio.pcm16;
    const result = await this.transcribe(pcm, { channels: 1, model: modelId, lang: "en" });
    if (result.text.trim().length === 0 && result.segments.length === 0) {
      throw new WhisperError("audio_invalid", "benchmark audio did not produce a transcript");
    }
    const profile: WhisperBenchmarkProfile = {
      deviceId: whisperBenchmarkDeviceId(),
      model: modelId,
      accel: capability.accel,
      sampleSeconds: pcm.length / audio.sampleRate,
      durationMs: result.durationMs,
      rtf: result.rtf,
      measuredAt: new Date().toISOString(),
    };
    await this.benchmarkStore.write(profile);
    return profile;
  }

  /** Open a streaming meeting session bound to a transferred port (Appendix N/G). */
  openStream(port: StreamPort, opts: { model?: string; channels: 1 | 2 }): string {
    const id = `wstream-${++this.seq}`;
    void (async () => {
      const modelId = await this.resolveModel(opts.model);
      const modelPath = await this.mm.ensure(modelId, { withVad: true });
      // The renderer may have closed the stream while the model was downloading.
      if (this.closedBeforeReady.delete(id)) {
        try {
          port.close();
        } catch {
          /* port already gone */
        }
        return;
      }
      const sessionOpts: SessionOpts = {
        modelPath,
        vadModelPath: vadModelPath(this.modelsDir),
        channels: opts.channels,
        transcribePcm: this.transcribePcmRunner,
      };
      this.sessions.set(id, new Session(port, sessionOpts));
    })().catch(() => {
      // Model ensure failed → tell the renderer and tear down.
      this.closedBeforeReady.delete(id);
      try {
        port.postMessage({ v: 1, type: "error", code: "model_not_installed" });
        port.close();
      } catch {
        /* port already gone */
      }
    });
    return id;
  }

  closeStream(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.close();
      this.sessions.delete(id);
    } else {
      // Session not constructed yet (model still downloading) — mark it so the
      // openStream tail tears the port down instead of orphaning the Session.
      this.closedBeforeReady.add(id);
    }
  }
}
