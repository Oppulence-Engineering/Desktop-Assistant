import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  probe: vi.fn(),
  transcribePcm: vi.fn(),
}));

vi.mock("./model-manager.js", () => ({
  ModelManager: vi.fn(function MockModelManager() {
    return {
      ensure: mocks.ensure,
      list: mocks.list,
      remove: mocks.remove,
    };
  }),
}));

vi.mock("./capability.js", () => ({
  probe: mocks.probe,
}));

vi.mock("./runner.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./runner.js")>();
  return {
    ...original,
    transcribePcm: mocks.transcribePcm,
  };
});

import { WhisperService } from "./service.js";

describe("WhisperService.diagnose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue("/models/custom.bin");
    mocks.probe.mockResolvedValue({ supported: true, accel: "coreml", cores: 10 });
    mocks.transcribePcm.mockResolvedValue({
      text: "bonjour",
      segments: [],
      rtf: 1.4,
      durationMs: 500,
    });
  });

  it("honors the configured model and language", async () => {
    const service = new WhisperService("/tmp/rowboat-whisper-test", () => {});
    const pcm16 = new Int16Array(32000);

    const result = await service.diagnose({
      pcm16,
      sampleRate: 16000,
      model: "small.en-q5_1",
      lang: "fr",
    });

    expect(mocks.ensure).toHaveBeenCalledWith("small.en-q5_1", { withVad: true });
    expect(mocks.transcribePcm).toHaveBeenCalledWith(
      pcm16,
      expect.objectContaining({
        modelPath: "/models/custom.bin",
        lang: "fr",
        audioSeconds: 2,
      }),
    );
    expect(result.model).toBe("small.en-q5_1");
  });

  it("defaults diagnostic language to English", async () => {
    const service = new WhisperService("/tmp/rowboat-whisper-test", () => {});

    await service.diagnose({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
    });

    expect(mocks.transcribePcm).toHaveBeenCalledWith(
      expect.any(Int16Array),
      expect.objectContaining({ lang: "en" }),
    );
  });
});

describe("WhisperService.benchmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue("/models/custom.bin");
    mocks.probe.mockResolvedValue({ supported: true, accel: "coreml", cores: 10 });
  });

  it("does not persist a benchmark profile when ASR returns no text or segments", async () => {
    const store = { read: vi.fn().mockResolvedValue([]), write: vi.fn() };
    mocks.transcribePcm.mockResolvedValue({
      text: "",
      segments: [],
      rtf: 8,
      durationMs: 500,
    });
    const service = new WhisperService("/tmp/rowboat-whisper-test", () => {}, {}, store);

    await expect(
      service.benchmark({ model: "base.en-q5_1", sampleSeconds: 10 }),
    ).rejects.toMatchObject({ code: "audio_invalid" });

    expect(store.write).not.toHaveBeenCalled();
  });
});
