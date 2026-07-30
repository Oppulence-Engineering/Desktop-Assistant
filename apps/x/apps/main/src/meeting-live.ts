import * as path from "node:path";
import type { MeetingTrackMeta, MeetingTranscriptSegment } from "@x/shared/dist/meetings.js";

/** Only the fields a live pass needs — the rest of `MeetingTrackMeta` is written at
 *  stop and is not known yet. */
type LiveTrack = Pick<MeetingTrackMeta, "id" | "speaker" | "file">;
import { readPcmChunk, readWavInfo } from "@x/core/dist/meetings/meetings.js";
import type { MeetingTranscriber } from "@x/core/dist/meetings/meetings.js";

/**
 * A transcript of the meeting *while it is still happening*.
 *
 * The plan for this assumed a live transcript already existed on disk. It does not —
 * native capture transcribes after the session ends, which is what makes it fast and
 * accurate. So this produces a second, throwaway transcript by periodically reading
 * whatever has been appended to the WAV files and transcribing just that.
 *
 * It is explicitly **not** the record. The post-session pass re-transcribes everything
 * in long chunks with full context and is what lands in the note; this exists so you can
 * ask "what did she say about the timeline?" without leaving the call. Cutting audio at
 * fixed intervals clips words at the boundaries, which is an acceptable price for a live
 * aid and would not be for an artifact you keep.
 *
 * No bot-based notetaker can do this well, because their transcript is in someone else's
 * cloud and arrives after the call.
 */

/** How often to pick up whatever has been recorded since the last pass. */
const INTERVAL_MS = 20_000;
/** Below this there is not enough audio to be worth a pass. */
const MIN_SECONDS = 8;

export interface LiveTranscriberDeps {
  transcriber: () => MeetingTranscriber;
  onSegments: (segments: MeetingTranscriptSegment[]) => void;
}

export class MeetingLiveTranscriber {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Per-track frame cursor: everything before it has already been transcribed. */
  private readonly cursors = new Map<string, number>();
  private dir: string | null = null;
  private tracks: LiveTrack[] = [];
  /** Bumped on every stop. A pass in flight when the session ends checks this before
   *  reporting, so a late result cannot land against the next session — or against no
   *  session at all, which broadcast an empty id and appended to a cleared panel. */
  private generation = 0;

  constructor(private readonly deps: LiveTranscriberDeps) {}

  get active(): boolean {
    return this.timer !== null;
  }

  start(dir: string, tracks: { id: string; speaker: string; file: string }[]): void {
    if (this.timer) return;
    this.dir = dir;
    // Offsets are not known until the session ends, so live segments are on each
    // track's own clock. Good enough to read; the final pass fixes the alignment.
    this.tracks = tracks.map((track) => ({
      id: track.id as MeetingTrackMeta["id"],
      speaker: track.speaker as MeetingTrackMeta["speaker"],
      file: track.file,
    }));
    this.cursors.clear();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
  }

  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dir = null;
    this.tracks = [];
    this.cursors.clear();
  }

  private async tick(): Promise<void> {
    // Passes must not overlap: a slow model would otherwise stack them and read the
    // same audio twice.
    if (this.running || !this.dir) return;
    this.running = true;
    const generation = this.generation;
    try {
      for (const track of this.tracks) {
        if (generation !== this.generation) break;
        await this.transcribeNew(this.dir, track, generation);
      }
    } catch (err) {
      // A live aid that fails is a live aid that is not there. It must never affect the
      // recording, the queue, or the transcript that actually gets kept.
      console.warn("[meeting] live transcription pass failed:", err);
    } finally {
      this.running = false;
    }
  }

  private async transcribeNew(dir: string, track: LiveTrack, generation: number): Promise<void> {
    const file = path.join(dir, track.file);
    // The header still says zero — the writer patches it on stop — so `readWavInfo`
    // derives the real length from the file size. That is the same path a crashed
    // session takes, which is why it already exists.
    const info = await readWavInfo(file);
    const cursor = this.cursors.get(track.id) ?? 0;
    const available = info.frames - cursor;
    if (available < info.sampleRate * MIN_SECONDS) return;

    const pcm = await readPcmChunk(file, info, cursor, available);
    if (pcm.length === 0) return;

    // Tracks are always mono — `TrackWriter` converts everything to 16 kHz mono on the
    // way in, which is the whole reason the host needs no decoder.
    const result = await this.deps.transcriber().transcribe(pcm, { channels: 1 });
    const baseMs = (cursor / info.sampleRate) * 1000;
    const segments: MeetingTranscriptSegment[] = [];
    for (const segment of result.segments) {
      const text = segment.text.trim();
      if (!text) continue;
      segments.push({
        speaker: track.speaker,
        start_ms: Math.round(baseMs + segment.start * 1000),
        end_ms: Math.round(baseMs + segment.end * 1000),
        text,
      });
    }

    // Advance only after a successful pass, so a failure re-reads rather than skipping
    // a stretch of the meeting entirely.
    this.cursors.set(track.id, cursor + available);
    // Transcription takes seconds; the meeting may have ended inside that window.
    if (generation !== this.generation) return;
    if (segments.length > 0) this.deps.onSegments(segments);
  }
}
