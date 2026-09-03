import { describe, expect, it } from "vitest";

import { prepareWebChatInput } from "@/lib/chat-attachments";

describe("web chat attachments", () => {
  it("includes attached text in the agent input without dumping it into the transcript", async () => {
    const result = await prepareWebChatInput({
      text: "Summarize this",
      files: [
        {
          filename: "notes.txt",
          mediaType: "text/plain",
          url: "data:text/plain;base64,aGVsbG8gd29ybGQ=",
        },
      ],
    });

    expect(result.input).toContain("hello world");
    expect(result.display).toBe("Summarize this\n\nAttached: notes.txt");
    expect(result.display).not.toContain("hello world");
  });
});
