import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  captureLlmUsage: vi.fn(),
  languageModel: vi.fn((model: string) => ({ model })),
  createProvider: vi.fn(() => ({ languageModel: mocks.languageModel })),
  withUseCase: vi.fn((_meta: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("../models/defaults.js", () => ({
  getMeetingNotesModel: vi.fn(async () => "openai/gpt-4.1-mini"),
  getDefaultModelAndProvider: vi.fn(async () => ({
    model: "openai/gpt-4.1-mini",
    provider: "solomon",
  })),
  resolveProviderConfig: vi.fn(async () => ({ flavor: "solomon" })),
}));

vi.mock("../models/models.js", () => ({
  createProvider: mocks.createProvider,
}));

vi.mock("../analytics/usage.js", () => ({
  captureLlmUsage: mocks.captureLlmUsage,
}));

vi.mock("../analytics/use_case.js", () => ({
  withUseCase: mocks.withUseCase,
}));

import { summarizeMeeting } from "./summarize_meeting.js";

describe("summarizeMeeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed LLM notes when the cloud summarizer succeeds", async () => {
    mocks.generateText.mockResolvedValue({
      text: "\n### Decisions\n- Ship it.\n",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    await expect(summarizeMeeting("**You:** Ship it.")).resolves.toBe("### Decisions\n- Ship it.");
    expect(mocks.captureLlmUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: "meeting_note",
        model: "openai/gpt-4.1-mini",
        provider: "solomon",
      }),
    );
  });

  it("falls back to local extractive notes when cloud auth is temporarily unavailable", async () => {
    mocks.generateText.mockRejectedValue(
      new Error("AuthUnavailableError: Solomon AI token refresh backing off"),
    );
    const transcript = `---
type: meeting
---

# Dogfood Utility Stream

\`\`\`transcript
{"transcript":"**You:** We agreed to ship the billing retry fix. **Other:** Andrej will update the runbook. We need to follow up with Anna tomorrow."}
\`\`\`
`;

    const notes = await summarizeMeeting(transcript, "2026-06-13T04:00:00.000Z");

    expect(notes).toContain("### Summary");
    expect(notes).toContain("We agreed to ship the billing retry fix.");
    expect(notes).toContain("Andrej will update the runbook.");
    expect(notes).toContain("### Action items");
    expect(notes).toContain("Follow up with Anna tomorrow.");
    expect(mocks.captureLlmUsage).not.toHaveBeenCalled();
  });
});
