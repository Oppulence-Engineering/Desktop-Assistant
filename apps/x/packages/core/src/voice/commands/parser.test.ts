import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "./parser.js";

describe("parseVoiceCommand", () => {
  it("parses email archive commands as confirmation-required", () => {
    const parsed = parseVoiceCommand("archive newsletters from last week", "email");

    expect(parsed.intent).toEqual({
      kind: "email.triage",
      query: "newsletters from last week",
      action: "archive",
    });
    expect(parsed.requiresConfirmation).toBe(true);
  });

  it("parses dictated text as a safe insert intent", () => {
    const parsed = parseVoiceCommand("write thanks I will review this today", "chat");

    expect(parsed.intent).toEqual({
      kind: "text.insert",
      text: "thanks I will review this today",
    });
    expect(parsed.requiresConfirmation).toBe(false);
  });

  it("parses meeting start commands", () => {
    const parsed = parseVoiceCommand("start recording product sync", "global");

    expect(parsed.intent).toEqual({
      kind: "meeting.startRecording",
      title: "product sync",
    });
    expect(parsed.requiresConfirmation).toBe(false);
  });

  it("parses label, snooze, waiting, and unsubscribe email triage commands safely", () => {
    expect(parseVoiceCommand("label vip leads as prospects", "email")).toEqual({
      intent: {
        kind: "email.triage",
        query: "vip leads",
        action: "label",
        label: "prospects",
      },
      requiresConfirmation: true,
    });
    expect(parseVoiceCommand("snooze vendor invoices", "email").intent).toEqual({
      kind: "email.triage",
      query: "vendor invoices",
      action: "snooze",
    });
    expect(parseVoiceCommand("mark customer follow ups as waiting", "email").intent).toEqual({
      kind: "email.triage",
      query: "customer follow ups",
      action: "mark_waiting",
    });
    expect(parseVoiceCommand("unsubscribe from sales newsletters", "email").intent).toEqual({
      kind: "email.triage",
      query: "sales newsletters",
      action: "unsubscribe",
    });
  });

  it("falls back to the command palette with surface context", () => {
    expect(parseVoiceCommand("open settings", "global")).toEqual({
      intent: { kind: "app.openCommand", query: "open settings" },
      requiresConfirmation: false,
    });
    expect(parseVoiceCommand("find invoices", "email")).toEqual({
      intent: { kind: "app.openCommand", query: "email: find invoices" },
      requiresConfirmation: false,
    });
  });
});
