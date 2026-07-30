import posthog from "posthog-js";

let appVersion: string | undefined;
let apiUrl: string | undefined;

function appVersionProperties(): Record<string, string> {
  return appVersion ? { app_version: appVersion } : {};
}

export function configureAnalyticsContext(props: { appVersion?: string; apiUrl?: string }) {
  appVersion = props.appVersion?.trim() || undefined;
  apiUrl = props.apiUrl?.trim() || undefined;

  const eventProperties = appVersionProperties();
  if (Object.keys(eventProperties).length > 0) {
    posthog.register(eventProperties);
  }

  const personProperties = {
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...eventProperties,
  };
  if (Object.keys(personProperties).length > 0) {
    posthog.people.set(personProperties);
  }
}

export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  posthog.identify(userId, {
    ...properties,
    ...appVersionProperties(),
  });
}

export function resetAnalyticsIdentity() {
  posthog.reset();
  configureAnalyticsContext({ appVersion, apiUrl });
}

export function chatSessionCreated(runId: string) {
  posthog.capture("chat_session_created", { run_id: runId });
}

export function chatMessageSent(props: {
  voiceInput?: boolean;
  voiceOutput?: string;
  searchEnabled?: boolean;
  voiceInputProvider?: string;
}) {
  posthog.capture("chat_message_sent", {
    voice_input: props.voiceInput ?? false,
    voice_output: props.voiceOutput ?? false,
    search_enabled: props.searchEnabled ?? false,
    ...(props.voiceInputProvider ? { voice_input_provider: props.voiceInputProvider } : {}),
  });
}

export function oauthConnected(provider: string) {
  posthog.capture("oauth_connected", { provider });
}

export function oauthDisconnected(provider: string) {
  posthog.capture("oauth_disconnected", { provider });
}

export function voiceInputStarted() {
  posthog.capture("voice_input_started");
}

// ---- Transcription (RFC 009 §19) — durations/metadata only, never audio or text ----

export type TranscriptionMode = "voice" | "meeting";

export function transcriptionStarted(props: {
  provider: string;
  mode: TranscriptionMode;
  model?: string;
  /** `native` = dual-track sidecar capture, `renderer` = in-app WebAudio pipeline. */
  captureEngine?: string;
  /** False when the system track never opened, so a one-sided transcript is
   *  distinguishable from a quiet meeting in aggregate. */
  systemAudioCaptured?: boolean;
}) {
  posthog.capture("transcription_started", {
    provider: props.provider,
    mode: props.mode,
    ...(props.model ? { model: props.model } : {}),
    ...(props.captureEngine ? { capture_engine: props.captureEngine } : {}),
    ...(props.systemAudioCaptured !== undefined
      ? { system_audio_captured: props.systemAudioCaptured }
      : {}),
  });
}

export function transcriptionCompleted(props: {
  provider: string;
  mode: TranscriptionMode;
  model?: string;
  audioMs?: number;
  latencyMs?: number;
  rtf?: number;
  accel?: string;
  fallback?: boolean;
}) {
  posthog.capture("transcription_completed", {
    provider: props.provider,
    mode: props.mode,
    ...(props.model ? { model: props.model } : {}),
    ...(props.audioMs != null ? { audio_ms: Math.round(props.audioMs) } : {}),
    ...(props.latencyMs != null ? { latency_ms: Math.round(props.latencyMs) } : {}),
    ...(props.rtf != null ? { rtf: props.rtf } : {}),
    ...(props.accel ? { accel: props.accel } : {}),
    fallback: props.fallback ?? false,
  });
}

export function transcriptionFailed(props: {
  provider: string;
  mode: TranscriptionMode;
  code: string;
  captureEngine?: string;
}) {
  posthog.capture("transcription_failed", {
    provider: props.provider,
    mode: props.mode,
    code: props.code,
    ...(props.captureEngine ? { capture_engine: props.captureEngine } : {}),
  });
}

export function whisperModelDownloaded(props: {
  id: string;
  sizeMb?: number;
  durationMs?: number;
}) {
  posthog.capture("whisper_model_downloaded", {
    id: props.id,
    ...(props.sizeMb != null ? { size_mb: props.sizeMb } : {}),
    ...(props.durationMs != null ? { duration_ms: Math.round(props.durationMs) } : {}),
  });
}

export function transcriptionProviderChanged(props: {
  feature: TranscriptionMode;
  from: string;
  to: string;
  reason: "user" | "quota" | "capability" | "remote" | "fallback";
}) {
  posthog.capture("transcription_provider_changed", props);
  // Person property: the user's preferred engine for the voice feature.
  if (props.feature === "voice") {
    posthog.people.set({ transcription_engine_pref: props.to });
  }
}

export function searchExecuted(types: string[]) {
  posthog.capture("search_executed", { types });
}

export function noteExported(format: string) {
  posthog.capture("note_exported", { format });
}

export function feedbackSubmitted(category: string) {
  posthog.capture("feedback_submitted", { category });
}
