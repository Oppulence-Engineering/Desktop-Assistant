import {
  configureWhisperBinary,
  codeOf,
  transcribePcm,
  type RunOpts,
  type RunResult,
} from "@x/core/voice/whisper/index";

interface ParentPort {
  on(event: "message", listener: (event: { data?: unknown } | UtilityRequest) => void): void;
  postMessage(message: UtilityResponse): void;
}

interface TranscribeRequest {
  id: string;
  type: "transcribe";
  binPath: string;
  pcm16: ArrayBuffer;
  opts: RunOpts;
}

type UtilityRequest = TranscribeRequest;

interface TranscribeSuccess {
  id: string;
  type: "transcribe:result";
  success: true;
  result: RunResult;
}

interface TranscribeFailure {
  id: string;
  type: "transcribe:result";
  success: false;
  code: string;
  message: string;
}

type UtilityResponse = TranscribeSuccess | TranscribeFailure;

const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort;

if (!parentPort) {
  throw new Error("whisper utility process started without parentPort");
}

parentPort.on("message", (event) => {
  const message = "data" in event ? event.data : event;
  void handleMessage(message as UtilityRequest);
});

async function handleMessage(message: UtilityRequest): Promise<void> {
  if (message.type !== "transcribe") return;

  try {
    configureWhisperBinary(message.binPath);
    const result = await transcribePcm(new Int16Array(message.pcm16), message.opts);
    parentPort.postMessage({
      id: message.id,
      type: "transcribe:result",
      success: true,
      result,
    });
  } catch (err) {
    parentPort.postMessage({
      id: message.id,
      type: "transcribe:result",
      success: false,
      code: codeOf(err),
      message: (err as Error)?.message ?? String(err),
    });
  }
}
