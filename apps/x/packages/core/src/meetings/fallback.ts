import { pcmStats } from "../voice/whisper/index.js";
import { SILENCE_PEAK_THRESHOLD, type MeetingTranscriber } from "./transcribe.js";

/**
 * A fast transcriber with a correct one behind it.
 *
 * Parakeet is roughly four times faster than whisper end-to-end, but it can return
 * **nothing at all** for audio that plainly contains speech — deterministically, on the
 * same file, while whisper transcribes it fine. Observed on a real dual-track capture:
 * the system track (peak 1.0, clearly audible, transcribed correctly by whisper) came
 * back with zero tokens, and scaling the input changed the outcome unpredictably.
 *
 * For a meeting that failure is not "a slightly worse transcript" — it is losing one
 * side of the conversation with no error to notice. So an empty result on a window that
 * demonstrably has signal is treated as a failure of the fast path and retried on the
 * slow one. Silence still costs nothing: a quiet window is expected to be empty and is
 * not retried.
 */

export interface FallbackOpts {
  /** Called when the fast engine came back empty on audio with signal. */
  onFallback?: (reason: string) => void;
}

export function withTranscriberFallback(
  fast: MeetingTranscriber,
  slow: MeetingTranscriber,
  opts: FallbackOpts = {},
): MeetingTranscriber {
  return {
    async transcribe(pcm, transcribeOpts) {
      let result: { segments: { start: number; end: number; text: string }[] };
      try {
        result = await fast.transcribe(pcm, transcribeOpts);
      } catch (err) {
        // A hard failure is also a reason to fall back, not to lose the window.
        opts.onFallback?.(`fast engine failed: ${(err as Error).message}`);
        return slow.transcribe(pcm, transcribeOpts);
      }

      if (result.segments.length > 0) return result;

      // Empty is the right answer for a quiet window; only escalate when there was
      // something to hear.
      const stats = pcmStats(pcm);
      if (stats.peak < SILENCE_PEAK_THRESHOLD) return result;

      opts.onFallback?.(
        `fast engine returned nothing for ${stats.audioSeconds.toFixed(1)}s of audio ` +
          `at peak ${stats.peak.toFixed(3)} — retrying on the slower engine`,
      );
      return slow.transcribe(pcm, transcribeOpts);
    },
  };
}
