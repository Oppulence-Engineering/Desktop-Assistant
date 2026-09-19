import { describe, expect, it } from "vitest";

import {
  correctConversationEvidenceKeys,
  CORRECT_CONVERSATION_EVIDENCE_STALE_TIME,
} from "./correct-conversation-evidence-keys";

describe("correctConversationEvidenceKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(correctConversationEvidenceKeys.list()[0]).toBe("correct-conversation-evidence");
    expect(correctConversationEvidenceKeys.detail("abc")).toEqual([
      "correct-conversation-evidence",
      "detail",
      "abc",
      {},
    ]);
    expect(CORRECT_CONVERSATION_EVIDENCE_STALE_TIME).toBe(15_000);
  });
});
