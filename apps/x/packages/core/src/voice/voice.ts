import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { isSignedIn } from "../account/account.js";
import { getAccessToken } from "../auth/tokens.js";
import { WorkDir } from "../config/config.js";
import { API_URL } from "../config/env.js";
import {
  TranscriptionConfig,
  isCloudProvider,
  type TranscriptionProvider,
  type WhisperSettings,
} from "@x/shared/dist/transcription.js";

export interface VoiceConfig {
  deepgram: { apiKey: string } | null;
  elevenlabs: { apiKey: string; voiceId?: string } | null;
}

async function readJsonConfig(filename: string): Promise<Record<string, unknown> | null> {
  try {
    const configPath = path.join(WorkDir, "config", filename);
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getVoiceConfig(): Promise<VoiceConfig> {
  const dgConfig = await readJsonConfig("deepgram.json");
  const elConfig = await readJsonConfig("elevenlabs.json");

  return {
    deepgram: dgConfig?.apiKey ? { apiKey: dgConfig.apiKey as string } : null,
    elevenlabs: elConfig?.apiKey
      ? { apiKey: elConfig.apiKey as string, voiceId: elConfig.voiceId as string | undefined }
      : null,
  };
}

export async function synthesizeSpeech(
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const config = await getVoiceConfig();
  const signedIn = await isSignedIn();

  let url: string;
  let headers: Record<string, string>;

  if (signedIn) {
    const voiceId = config.elevenlabs?.voiceId || "UgBBYS2sOqTuMpoF3BR0";
    const accessToken = await getAccessToken();
    url = `${API_URL}/v1/voice/text-to-speech/${voiceId}`;
    headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // The proxy requires an idempotency key (httpx.RequireIdempotencyKey → 428 without it).
      // Each synthesis is a distinct one-shot request, so a fresh key per call is correct.
      "Idempotency-Key": randomUUID(),
    };
    console.log(
      "[voice] synthesizing speech via Rowboat proxy, text length:",
      text.length,
      "voiceId:",
      voiceId,
    );
  } else {
    if (!config.elevenlabs) {
      throw new Error(
        `ElevenLabs not configured. Create ${path.join(WorkDir, "config", "elevenlabs.json")} with { "apiKey": "<your-key>" }`,
      );
    }
    const voiceId = config.elevenlabs.voiceId || "UgBBYS2sOqTuMpoF3BR0";
    url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    headers = {
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json",
    };
    console.log(
      "[voice] synthesizing speech via ElevenLabs, text length:",
      text.length,
      "voiceId:",
      voiceId,
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    console.error("[voice] TTS API error:", response.status, errText);
    throw new Error(`TTS API error ${response.status}: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
  console.log("[voice] synthesized audio, base64 length:", audioBase64.length);
  return { audioBase64, mimeType: "audio/mpeg" };
}

// ============================================================================
// Transcription provider configuration & resolution (RFC 009 §12)
// ============================================================================

const TRANSCRIPTION_CONFIG_FILE = "transcription.json";

function transcriptionConfigPath(): string {
  return path.join(WorkDir, "config", TRANSCRIPTION_CONFIG_FILE);
}

/**
 * Read `~/.rowboat/config/transcription.json` if present, parsed (and migrated)
 * through the zod schema. Returns `null` when the file is absent — the signal that
 * the user has not explicitly chosen a provider yet (back-compat path, §36).
 * Unknown fields are ignored; an unknown `model` falls back to the catalog default.
 */
export async function readTranscriptionConfig(): Promise<TranscriptionConfig | null> {
  try {
    const raw = await fs.readFile(transcriptionConfigPath(), "utf8");
    return TranscriptionConfig.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The effective transcription config for display (settings UI). When no file
 * exists, defaults are synthesized from the schema — voice defaults to local,
 * meetings to cloud (the tiering policy, §16). Always returns a value.
 */
export async function getTranscriptionConfig(): Promise<TranscriptionConfig> {
  const existing = await readTranscriptionConfig();
  if (existing) return existing;
  return TranscriptionConfig.parse({});
}

/** A shallow patch for `transcription.json` (the `whisper` block may be partial). */
export interface TranscriptionConfigPatch {
  voiceProvider?: TranscriptionProvider;
  meetingProvider?: TranscriptionProvider;
  whisper?: Partial<WhisperSettings>;
}

/** Persist `transcription.json`, merging a partial update over the current config. */
export async function setTranscriptionConfig(
  patch: TranscriptionConfigPatch,
): Promise<TranscriptionConfig> {
  const current = await getTranscriptionConfig();
  // Only override keys the caller explicitly set — a patch field left `undefined`
  // (the common case when the settings UI changes one thing) must NOT clobber the
  // other persisted provider and get re-defaulted by the schema.
  const next = TranscriptionConfig.parse({
    ...current,
    ...(patch.voiceProvider !== undefined ? { voiceProvider: patch.voiceProvider } : {}),
    ...(patch.meetingProvider !== undefined ? { meetingProvider: patch.meetingProvider } : {}),
    whisper: { ...current.whisper, ...(patch.whisper ?? {}) },
  });
  const configPath = transcriptionConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(next, null, 2));
  return next;
}

/** Why a provider was chosen — surfaced for telemetry + UX notices (§17/§19). */
export type ProviderReason = "user" | "remote" | "capability" | "quota" | "fallback";

export interface VoiceProviderInput {
  /** The user's explicit choice from `transcription.json` (absent → not chosen). */
  userOverride?: TranscriptionProvider;
  /** The A/B-able fleet default from the account payload. */
  remoteDefault?: TranscriptionProvider;
  /** Whether the user is signed in (decides the cloud fallback target). */
  signedIn: boolean;
  /** Whether on-device transcription is viable here (binary present + capable). */
  localSupported: boolean;
}

/**
 * Resolve the voice-input provider (RFC 009 §12): user override → remote default →
 * `whisper-local`, then a capability gate downgrades local → cloud on unsupported
 * devices. The cloud target is the Solomon proxy when signed in, else direct BYOK.
 *
 * Pure function of its inputs (the caller probes capability) → unit-testable.
 */
export function resolveVoiceProvider(input: VoiceProviderInput): TranscriptionProvider {
  const want = input.userOverride ?? input.remoteDefault ?? "whisper-local";
  if (want === "whisper-local" && !input.localSupported) {
    return input.signedIn ? "solomon" : "deepgram";
  }
  return want;
}

export interface MeetingProviderInput extends VoiceProviderInput {
  /** BYOK: the user supplied their own Deepgram key (streams direct → never metered). */
  hasOwnDeepgramKey: boolean;
  /** Free cloud meeting minutes left; `null`/`undefined` → unlimited or unknown. */
  meetingMinutesRemaining?: number | null;
}

/**
 * Resolve the meeting provider (RFC 009 §16, Appendix O.8): meetings default to
 * cloud (diarization). When the free cloud quota is exhausted — and the user is not
 * BYOK — we transparently switch to on-device with a `quota` reason. Local is gated
 * by capability like voice.
 */
export function resolveMeetingProvider(input: MeetingProviderInput): {
  provider: TranscriptionProvider;
  reason: ProviderReason;
} {
  const chosenReason: ProviderReason = input.userOverride
    ? "user"
    : input.remoteDefault
      ? "remote"
      : "fallback";
  const want = input.userOverride ?? input.remoteDefault ?? "deepgram";

  if (want === "whisper-local") {
    if (!input.localSupported)
      return { provider: input.signedIn ? "solomon" : "deepgram", reason: "capability" };
    return { provider: "whisper-local", reason: chosenReason };
  }

  // Cloud chosen. BYOK streams direct to Deepgram → never metered → no quota gate.
  if (isCloudProvider(want) && !input.hasOwnDeepgramKey) {
    const remaining = input.meetingMinutesRemaining;
    if (typeof remaining === "number" && remaining <= 0 && input.localSupported) {
      return { provider: "whisper-local", reason: "quota" };
    }
  }
  return { provider: want, reason: chosenReason };
}
