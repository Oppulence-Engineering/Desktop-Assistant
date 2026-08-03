import type { TranscriptionProvider } from "@x/shared/dist/transcription.js";

interface VoiceCaptureStartupOptions<TStream> {
  openMicrophone: () => Promise<TStream | null>;
  resolveProvider: () => Promise<TranscriptionProvider>;
  connectCloudTransport: (provider: TranscriptionProvider) => Promise<void>;
  disposeMicrophone: (stream: TStream) => void;
}

/**
 * Start microphone acquisition before waiting on provider/config IPC. Wireless
 * inputs often dominate startup latency, so serializing these steps clips the
 * beginning of speech for no benefit.
 */
export async function prepareVoiceCapture<TStream>({
  openMicrophone,
  resolveProvider,
  connectCloudTransport,
  disposeMicrophone,
}: VoiceCaptureStartupOptions<TStream>): Promise<{
  provider: TranscriptionProvider;
  stream: TStream | null;
  cloudTransportPromise: Promise<void>;
}> {
  const microphonePromise = openMicrophone();
  const provider = await resolveProvider();

  if (provider === "none") {
    const stream = await microphonePromise;
    if (stream) disposeMicrophone(stream);
    return { provider, stream: null, cloudTransportPromise: Promise.resolve() };
  }

  // Cloud audio is buffered until its socket opens, so auth/connection work must
  // not delay attaching Web Audio to an already-ready microphone.
  const cloudTransportPromise =
    provider === "whisper-local" ? Promise.resolve() : connectCloudTransport(provider);
  return { provider, stream: await microphonePromise, cloudTransportPromise };
}
