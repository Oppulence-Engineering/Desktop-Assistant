import { describe, expect, it } from "vitest";

import {
  runCommitmentRecoveryKeys,
  RUN_COMMITMENT_RECOVERY_STALE_TIME,
} from "./run-commitment-recovery-keys";

describe("runCommitmentRecoveryKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(runCommitmentRecoveryKeys.list()[0]).toBe("run-commitment-recovery");
    expect(runCommitmentRecoveryKeys.detail("abc")).toEqual([
      "run-commitment-recovery",
      "detail",
      "abc",
      {},
    ]);
    expect(RUN_COMMITMENT_RECOVERY_STALE_TIME).toBe(15_000);
  });
});
