import { describe, expect, it } from "vitest";

import {
  decideConversationChangeKeys,
  DECIDE_CONVERSATION_CHANGE_STALE_TIME,
} from "./decide-conversation-change-keys";

describe("decideConversationChangeKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(decideConversationChangeKeys.list()[0]).toBe("decide-conversation-change");
    expect(decideConversationChangeKeys.detail("abc")).toEqual([
      "decide-conversation-change",
      "detail",
      "abc",
      {},
    ]);
    expect(DECIDE_CONVERSATION_CHANGE_STALE_TIME).toBe(15_000);
  });
});
