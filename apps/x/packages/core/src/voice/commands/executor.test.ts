import { describe, expect, it, vi } from "vitest";
import { executeVoiceCommand } from "./executor.js";

describe("executeVoiceCommand", () => {
  it("refuses destructive email commands without confirmation", async () => {
    const emailActions = fakeEmailActions();
    const result = await executeVoiceCommand(
      { kind: "email.triage", query: "old newsletters", action: "archive" },
      { confirmed: false, emailActions },
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("confirmation");
    expect(emailActions.archiveByQuery).not.toHaveBeenCalled();
  });

  it("executes confirmed email archive through the email action engine", async () => {
    const emailActions = fakeEmailActions();
    const result = await executeVoiceCommand(
      { kind: "email.triage", query: "old newsletters", action: "archive" },
      { confirmed: true, emailActions },
    );

    expect(result.success).toBe(true);
    expect(emailActions.archiveByQuery).toHaveBeenCalledWith("old newsletters");
  });

  it("stages safe reply and rule commands without destructive confirmation", async () => {
    const emailActions = fakeEmailActions();

    await expect(
      executeVoiceCommand(
        { kind: "email.composeReply", threadId: "thread-1", body: "Thanks, I will review." },
        { confirmed: false, emailActions },
      ),
    ).resolves.toEqual({ success: true });
    await expect(
      executeVoiceCommand(
        { kind: "email.createRule", description: "archive newsletters after reading" },
        { confirmed: false, emailActions },
      ),
    ).resolves.toEqual({ success: true });

    expect(emailActions.composeReply).toHaveBeenCalledWith("thread-1", "Thanks, I will review.");
    expect(emailActions.createRule).toHaveBeenCalledWith("archive newsletters after reading");
  });

  it("fails closed for unsupported confirmed triage actions", async () => {
    const result = await executeVoiceCommand(
      { kind: "email.triage", query: "flight reminders", action: "snooze" },
      { confirmed: true, emailActions: fakeEmailActions() },
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("snooze");
  });
});

function fakeEmailActions() {
  return {
    archiveByQuery: vi.fn().mockResolvedValue(undefined),
    labelByQuery: vi.fn().mockResolvedValue(undefined),
    composeReply: vi.fn().mockResolvedValue(undefined),
    createRule: vi.fn().mockResolvedValue(undefined),
  };
}
