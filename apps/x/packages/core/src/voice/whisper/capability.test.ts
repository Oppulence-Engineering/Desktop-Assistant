import { describe, it, expect } from "vitest";
import { capabilityFromSystemInfo, parseAccel } from "./capability.js";

describe("parseAccel", () => {
  it("detects Core ML when COREML = 1", () => {
    expect(parseAccel("n_threads = 7 | METAL = 1 | COREML = 1")).toBe("coreml");
  });

  it("detects Core ML from a linked CoreML framework probe", () => {
    expect(parseAccel("/System/Library/Frameworks/CoreML.framework/Versions/A/CoreML")).toBe(
      "coreml",
    );
  });

  it("prefers Metal over CPU when Core ML is absent", () => {
    expect(parseAccel("AVX2 = 1 | METAL = 1 | COREML = 0")).toBe("metal");
  });

  it("detects Metal from whisper.cpp's actual systeminfo shape", () => {
    expect(
      parseAccel(
        "WHISPER : COREML = 0 | OPENVINO = 0 | Metal : EMBED_LIBRARY = 1 | CPU : NEON = 1",
      ),
    ).toBe("metal");
  });

  it("detects CUDA and Vulkan", () => {
    expect(parseAccel("CUDA = 1")).toBe("cuda");
    expect(parseAccel("VULKAN = 1 | CUDA = 0")).toBe("vulkan");
  });

  it("falls back to cpu when nothing is enabled", () => {
    expect(parseAccel("AVX = 1 | AVX2 = 1 | METAL = 0 | COREML = 0")).toBe("cpu");
    expect(parseAccel("")).toBe("cpu");
  });
});

describe("capabilityFromSystemInfo", () => {
  it("does not claim Core ML on Apple Silicon when the probe has no Core ML evidence", () => {
    expect(capabilityFromSystemInfo("", 8, "darwin", "arm64")).toMatchObject({
      supported: true,
      accel: "metal",
    });
  });
});
