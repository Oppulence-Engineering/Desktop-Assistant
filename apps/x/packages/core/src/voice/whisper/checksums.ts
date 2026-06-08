/**
 * Pinned SHA-256 checksums for the whisper.cpp model catalog (RFC 009 §9/§21).
 *
 * GENERATED — do not hand-edit. Populate with:
 *
 *   node apps/x/scripts/whisper-fetch-checksums.mjs
 *
 * which reads the authoritative hashes from the whisper.cpp Hugging Face manifest
 * and writes this map (keyed by catalog id). A model with no entry here is
 * **refused at download time** rather than trusted — so an unverified download can
 * never be installed (the headline integrity guarantee of the local engine).
 *
 * Empty until the fetch script runs in CI / a maintainer populates it; the feature
 * ships dark behind a capability gate until then.
 */
export const CHECKSUMS: Record<string, string> = {
  // 'base.en-q5_1': '<sha256 from manifest>',
  // 'silero-v5.1.2': '<sha256 from manifest>',
};
