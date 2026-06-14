import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  captureLlmUsage: vi.fn(),
  languageModel: vi.fn((model: string) => ({ model })),
  createProvider: vi.fn(() => ({ languageModel: mocks.languageModel })),
  withUseCase: vi.fn((_meta: unknown, fn: () => Promise<unknown>) => fn()),
  workDir: "/tmp/rowboat-summarize-meeting-test",
  outsideDir: "/tmp/rowboat-summarize-meeting-outside",
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

vi.mock("../config/config.js", () => ({
  WorkDir: mocks.workDir,
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

  it("does not include calendar events when the meeting timestamp is invalid", async () => {
    await fs.rm(mocks.workDir, { recursive: true, force: true });
    await fs.mkdir(path.join(mocks.workDir, "calendar_sync"), { recursive: true });
    await fs.writeFile(
      path.join(mocks.workDir, "calendar_sync", "unrelated.json"),
      JSON.stringify({
        summary: "Unrelated confidential event",
        start: { dateTime: "2026-06-13T12:00:00.000Z" },
        end: { dateTime: "2026-06-13T13:00:00.000Z" },
        attendees: [{ email: "private@example.com" }],
      }),
    );
    mocks.generateText.mockResolvedValue({
      text: "### Summary\n- Meeting notes.",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    await summarizeMeeting("**You:** Normal transcript.", "not-a-date");

    const prompt = mocks.generateText.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).not.toContain("Unrelated confidential event");
    expect(prompt).not.toContain("private@example.com");
  });

  it("does not load calendar event source paths outside WorkDir", async () => {
    await fs.rm(mocks.workDir, { recursive: true, force: true });
    await fs.rm(mocks.outsideDir, { recursive: true, force: true });
    await fs.mkdir(mocks.outsideDir, { recursive: true });
    await fs.writeFile(
      path.join(mocks.outsideDir, "secret.json"),
      JSON.stringify({
        summary: "Secret outside event",
        attendees: [{ email: "secret@example.com" }],
        organizer: { email: "owner@example.com" },
      }),
    );
    mocks.generateText.mockResolvedValue({
      text: "### Summary\n- Meeting notes.",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    await summarizeMeeting(
      "**You:** Normal transcript.",
      "2026-06-13T12:00:00.000Z",
      JSON.stringify({
        summary: "Linked meeting",
        source: "../rowboat-summarize-meeting-outside/secret.json",
      }),
    );

    const prompt = mocks.generateText.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain("Linked meeting");
    expect(prompt).not.toContain("secret@example.com");
    expect(prompt).not.toContain("owner@example.com");
  });
});
