import { describe, expect, it } from "vitest";

import {
  requestConversationDeletionKeys,
  REQUEST_CONVERSATION_DELETION_STALE_TIME,
} from "./request-conversation-deletion-keys";

describe("requestConversationDeletionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(requestConversationDeletionKeys.list()[0]).toBe("request-conversation-deletion");
    expect(requestConversationDeletionKeys.detail("abc")).toEqual([
      "request-conversation-deletion",
      "detail",
      "abc",
      {},
    ]);
    expect(REQUEST_CONVERSATION_DELETION_STALE_TIME).toBe(15_000);
  });
});
