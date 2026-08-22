import {
  DEFAULT_DIARIZATION_SETTINGS,
  type DiarizationMode,
  type DiarizationSettings,
  type TranscriptionProvider,
} from "@x/shared/diarization";

/**
 * Diarization feature-flag resolution (RFC 017 §"Rollback plan"). The four
 * LOCAL_DIARIZATION_* environment variables are developer/operator overrides that
 * win over the persisted `transcription.json` `diarization` block, which in turn
 * wins over the hardcoded off-by-default. Rolling back is flipping
 * LOCAL_DIARIZATION_ENABLED off — RFC 009 local STT / cloud meetings are
 * untouched.
 */

/** Parse a tri-state boolean env var: true/false/undefined (unset → no override). */
export function parseEnvFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

/** Apply LOCAL_DIARIZATION_* env overrides on top of the persisted settings. */
export function resolveDiarizationSettings(
  persisted: Partial<DiarizationSettings> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DiarizationSettings {
  const base: DiarizationSettings = { ...DEFAULT_DIARIZATION_SETTINGS, ...(persisted ?? {}) };
  const enabled = parseEnvFlag(env.LOCAL_DIARIZATION_ENABLED);
  const betaUI = parseEnvFlag(env.LOCAL_DIARIZATION_BETA_UI);
  const refinement = parseEnvFlag(env.LOCAL_DIARIZATION_REFINEMENT);
  const fixtureMode = parseEnvFlag(env.LOCAL_DIARIZATION_FIXTURE_MODE);
  return {
    ...base,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(betaUI !== undefined ? { betaUI } : {}),
    ...(refinement !== undefined ? { refinement } : {}),
    ...(fixtureMode !== undefined ? { fixtureMode } : {}),
  };
}

/**
 * Whether local diarization should run for this session: it requires the flag on
 * AND the meeting to be transcribed on-device (cloud meetings already diarize via
 * the provider).
 */
export function diarizationActive(
  settings: DiarizationSettings,
  provider: TranscriptionProvider,
): boolean {
  return settings.enabled && provider === "whisper-local";
}

/**
 * The diarization mode to record in provenance:
 *  - `off` when local diarization isn't active or it failed,
 *  - `beta` while the quality gates haven't promoted it (v1),
 *  - `default` is reserved for post-graduation.
 */
export function diarizationModeFor(
  settings: DiarizationSettings,
  provider: TranscriptionProvider,
  succeeded = true,
): DiarizationMode {
  if (!diarizationActive(settings, provider) || !succeeded) return "off";
  // v1 ships beta only; the gates in RFC 017 promote this to "default".
  return "beta";
}
