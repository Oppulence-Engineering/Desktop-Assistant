/**
 * Whisper's non-speech annotations.
 *
 * Given near-silence, whisper does not return nothing — it returns its best guess at
 * what the noise was: `[Music]`, `[BLANK_AUDIO]`, `[Applause]`, `♪`. Harmless in a
 * dictation box, corrosive in a meeting transcript, where it appears as a participant
 * saying "[Music]".
 *
 * This matters much more for dual-track capture than it did before: one of the two
 * tracks is usually the quiet one (your microphone picking up speaker bleed, or their
 * side while you talk), so there is almost always a track in exactly the state that
 * produces these.
 *
 * The test is structural rather than a word list — a segment is non-speech if *all* of
 * it is bracketed annotation or punctuation. That catches annotations we have not seen
 * while keeping real speech that merely contains one, e.g. "so [inaudible] by Friday".
 */

/** Bracketed/parenthesized/asterisked annotations, musical notes, and bare punctuation. */
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/g;
const PUNCTUATION_ONLY = /^[\s.,!?;:'"—–\-_·…]*$/;

/**
 * True when a transcript segment carries no actual speech.
 *
 * ```
 * isNonSpeech("[Music]")                   // true
 * isNonSpeech("♪♪")                        // true
 * isNonSpeech("so [inaudible] by Friday")  // false — real words remain
 * ```
 */
export function isNonSpeech(text: string): boolean {
  const withoutAnnotations = text.replace(ANNOTATION, " ");
  return PUNCTUATION_ONLY.test(withoutAnnotations);
}
