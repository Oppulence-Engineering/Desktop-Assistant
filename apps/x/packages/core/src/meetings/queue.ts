import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  renderTranscriptMarkdown,
  type MeetingKeepAudio,
  type MeetingSessionMeta,
  type MeetingTranscript,
  type MeetingTranscriptionProgress,
} from "@x/shared/dist/meetings.js";
import { applyRetention } from "./retention.js";
import {
  appendLog,
  exists,
  readMeta,
  writeJsonAtomic,
  META_FILE,
  TRANSCRIPT_JSON,
  TRANSCRIPT_MD,
} from "./session.js";
import { transcribeSession, type MeetingTranscriber } from "./transcribe.js";

/**
 * The transcription queue, where **the filesystem is the queue**: a session
 * directory holding `meta.json` and no `transcript.json` is pending work. Nothing
 * else tracks state, so quitting mid-transcription — or being killed — costs a retry
 * and never a meeting. {@link MeetingQueue.resumePending} rescans at launch.
 *
 * Jobs drain serially. Transcription is CPU-bound and whisper already single-flights
 * internally, so running two would only make both slower and the first result later.
 */

export interface MeetingQueueDeps {
  transcriber: MeetingTranscriber;
  /** Engine/model provenance recorded in the transcript. */
  engine: () => string;
  model: () => string;
  lang?: () => string | undefined;
  keepAudio: () => MeetingKeepAudio;
  /** Writes the workspace note; returns its path. Injected so core stays unaware of
   *  the workspace layer, and so tests can assert without a workspace. */
  writeNote?: (args: {
    dir: string;
    meta: MeetingSessionMeta;
    transcript: MeetingTranscript;
  }) => Promise<string | undefined>;
  onProgress?: (progress: MeetingTranscriptionProgress) => void;
}

export class MeetingQueue {
  private readonly queue: string[] = [];
  private draining = false;
  private current: string | null = null;

  constructor(
    private readonly root: string,
    private readonly deps: MeetingQueueDeps,
  ) {}

  /** Pending sessions, including the one in flight. */
  get depth(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  get transcribingSessionId(): string | undefined {
    return this.current ? path.basename(this.current) : undefined;
  }

  enqueue(dir: string): void {
    if (this.current === dir || this.queue.includes(dir)) return;
    this.queue.push(dir);
    this.emit(dir, "queued");
    void this.drain();
  }

  /**
   * Rescan for sessions that finished but were never transcribed. Directory names
   * sort chronologically, so oldest-first is a plain name sort.
   */
  async resumePending(): Promise<string[]> {
    const pending = await pendingSessions(this.root);
    for (const dir of pending) this.enqueue(dir);
    return pending;
  }

  /** Drop an existing transcript and transcribe again — e.g. after switching to a
   *  larger model. Only possible while the audio is still on disk. */
  async retranscribe(dir: string): Promise<void> {
    await fs.rm(path.join(dir, TRANSCRIPT_JSON), { force: true });
    await fs.rm(path.join(dir, TRANSCRIPT_MD), { force: true });
    this.enqueue(dir);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const dir = this.queue.shift()!;
        this.current = dir;
        try {
          await this.run(dir);
        } catch (err) {
          // One failed session must never block the rest of the queue.
          const message = (err as Error).message;
          await appendLog(dir, `transcription failed: ${message}`);
          this.emit(dir, "failed", { error: message });
        } finally {
          this.current = null;
        }
      }
    } finally {
      this.draining = false;
      // A session enqueued between the loop exiting and this flag clearing would
      // otherwise sit until the next enqueue.
      if (this.queue.length > 0) void this.drain();
    }
  }

  private async run(dir: string): Promise<void> {
    const meta = await readMeta(dir);
    if (!meta) throw new Error(`unreadable ${META_FILE}`);

    this.emit(dir, "transcribing", { fraction: 0 });
    const transcript = await transcribeSession({
      dir,
      meta,
      transcriber: this.deps.transcriber,
      engine: this.deps.engine(),
      model: this.deps.model(),
      lang: this.deps.lang?.(),
      onProgress: (fraction) => this.emit(dir, "transcribing", { fraction }),
    });

    this.emit(dir, "writing", { fraction: 1 });
    // Atomic, and written before the note: its existence is the "done" predicate, so
    // a crash between the two costs a note, not a re-transcription.
    await writeJsonAtomic(path.join(dir, TRANSCRIPT_JSON), transcript);
    await fs.writeFile(
      path.join(dir, TRANSCRIPT_MD),
      renderTranscriptMarkdown(transcript, path.basename(dir)),
      "utf8",
    );
    await appendLog(dir, `transcribed — ${transcript.segments.length} segments`);

    const notePath = await this.deps.writeNote?.({ dir, meta, transcript });
    await applyRetention({ dir, meta, mode: this.deps.keepAudio(), transcribed: true });
    this.emit(dir, "done", { notePath });
  }

  private emit(
    dir: string,
    phase: MeetingTranscriptionProgress["phase"],
    extra: Partial<MeetingTranscriptionProgress> = {},
  ): void {
    this.deps.onProgress?.({
      sessionId: path.basename(dir),
      phase,
      queueDepth: this.depth,
      ...extra,
    });
  }
}

/** Session directories with a `meta.json` and no `transcript.json`, oldest first. */
export async function pendingSessions(root: string): Promise<string[]> {
  const dirs = await sessionDirs(root);
  const pending: string[] = [];
  for (const dir of dirs) {
    if (
      (await exists(path.join(dir, META_FILE))) &&
      !(await exists(path.join(dir, TRANSCRIPT_JSON)))
    ) {
      pending.push(dir);
    }
  }
  return pending;
}

/** All session directories, oldest first by name. */
export async function sessionDirs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(root, name));
}
