import * as path from "node:path";
import { defaultModelId } from "./catalog.js";
import { ModelManager, type ModelProgress, type ModelManagerDeps } from "./model-manager.js";
import { probe, type Capability } from "./capability.js";
import { transcribePcm, type Segment } from "./runner.js";
import { deinterleaveStereoI16 } from "./wav.js";
import { vadModelPath } from "./bin.js";
import { Session, type StreamPort, type SessionOpts } from "./streaming.js";
import type { WhisperModelSummary, WhisperSegment } from "@x/shared/dist/transcription.js";

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
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  constructor(
    workDir: string,
    onProgress: (p: ModelProgress) => void,
    deps: ModelManagerDeps = {},
  ) {
    this.modelsDir = path.join(workDir, "models");
    this.mm = new ModelManager(this.modelsDir, onProgress, deps);
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
      }));
  }

  ensureModel(id: string): Promise<string> {
    return this.mm.ensure(id, { withVad: true });
  }

  removeModel(id: string): Promise<void> {
    return this.mm.remove(id);
  }

  /** Resolve the model id: explicit → catalog default (locale-aware). */
  private resolveModel(explicit?: string): string {
    return explicit ?? defaultModelId();
  }

  /**
   * Batch transcribe (voice mode). `channels: 2` → transcribe mic (ch0, "you") and
   * system (ch1, "other") as two mono passes and merge segments by start time.
   */
  async transcribe(pcm: Int16Array, opts: TranscribeOpts): Promise<TranscribeResult> {
    const modelPath = await this.mm.ensure(this.resolveModel(opts.model), { withVad: true });
    const vad = vadModelPath(this.modelsDir);
    const audioSeconds = pcm.length / 16000 / (opts.channels === 2 ? 2 : 1);

    if (opts.channels === 1) {
      return transcribePcm(pcm, { modelPath, vadModelPath: vad, lang: opts.lang, audioSeconds });
    }

    const { mic, sys } = deinterleaveStereoI16(pcm);
    const [you, other] = await Promise.all([
      transcribePcm(mic, { modelPath, vadModelPath: vad, lang: opts.lang, audioSeconds }),
      transcribePcm(sys, { modelPath, vadModelPath: vad, lang: opts.lang, audioSeconds }),
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
    };
  }

  /** Open a streaming meeting session bound to a transferred port (Appendix N/G). */
  openStream(port: StreamPort, opts: { model?: string; channels: 1 | 2 }): string {
    const id = `wstream-${++this.seq}`;
    void (async () => {
      const modelPath = await this.mm.ensure(this.resolveModel(opts.model), { withVad: true });
      const sessionOpts: SessionOpts = {
        modelPath,
        vadModelPath: vadModelPath(this.modelsDir),
        channels: opts.channels,
      };
      this.sessions.set(id, new Session(port, sessionOpts));
    })().catch(() => {
      // Model ensure failed → tell the renderer and tear down.
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
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }
}
