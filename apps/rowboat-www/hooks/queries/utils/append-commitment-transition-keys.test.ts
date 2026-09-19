import { describe, expect, it } from "vitest";

import {
  appendCommitmentTransitionKeys,
  APPEND_COMMITMENT_TRANSITION_STALE_TIME,
} from "./append-commitment-transition-keys";

describe("appendCommitmentTransitionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(appendCommitmentTransitionKeys.list()[0]).toBe("append-commitment-transition");
    expect(appendCommitmentTransitionKeys.detail("abc")).toEqual([
      "append-commitment-transition",
      "detail",
      "abc",
      {},
    ]);
    expect(APPEND_COMMITMENT_TRANSITION_STALE_TIME).toBe(15_000);
  });
});
