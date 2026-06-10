import type { WhisperErrorCode } from "@x/shared/dist/transcription.js";

export type { WhisperErrorCode };

/**
 * The single typed error for the local-transcription engine (RFC 009 §18).
 *
 * Every model-manager / runner / streaming failure throws a `WhisperError` whose
 * `code` belongs to the error taxonomy. The IPC layer returns the `code` (not the
 * message) so the renderer can map it to a recovery action.
 */
export class WhisperError extends Error {
  constructor(
    public readonly code: WhisperErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "WhisperError";
  }
}

/** Best-effort extraction of a WhisperErrorCode from an unknown thrown value. */
export function codeOf(
  err: unknown,
  fallback: WhisperErrorCode = "engine_crashed",
): WhisperErrorCode {
  if (err instanceof WhisperError) return err.code;
  return fallback;
}
