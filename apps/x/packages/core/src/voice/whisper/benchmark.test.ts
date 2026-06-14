import { describe, expect, it } from "vitest";
import { chooseAutoModel } from "./benchmark.js";

describe("chooseAutoModel", () => {
  it("chooses small on fast Apple Silicon when the base and small profiles are fast", () => {
    expect(
      chooseAutoModel({
        accel: "coreml",
        memoryGb: 32,
        profiles: [
          { model: "base.en-q5_1", rtf: 8 },
          { model: "small.en-q5_1", rtf: 3.2 },
        ],
      }),
    ).toBe("small.en-q5_1");
  });

  it("keeps base on CPU when small is below the speed margin", () => {
    expect(
      chooseAutoModel({
        accel: "cpu",
        memoryGb: 16,
        profiles: [
          { model: "base.en-q5_1", rtf: 1.3 },
          { model: "small.en-q5_1", rtf: 1.1 },
        ],
      }),
    ).toBe("base.en-q5_1");
  });
});
