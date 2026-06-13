import type { VoiceCommandIntent } from "@x/shared/dist/transcription.js";

export type VoiceCommandSurface = "global" | "chat" | "email" | "meeting";

export interface ParsedVoiceCommand {
  intent: VoiceCommandIntent;
  requiresConfirmation: boolean;
}

export function parseVoiceCommand(text: string, surface: VoiceCommandSurface): ParsedVoiceCommand {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { intent: { kind: "app.openCommand", query: "" }, requiresConfirmation: false };
  }

  const lower = normalized.toLowerCase();

  const archive = lower.match(/^archive (.+)$/);
  if (archive) {
    return {
      intent: { kind: "email.triage", query: archive[1], action: "archive" },
      requiresConfirmation: true,
    };
  }

  const label = lower.match(/^label (.+) as (.+)$/);
  if (label) {
    return {
      intent: { kind: "email.triage", query: label[1], action: "label", label: label[2] },
      requiresConfirmation: true,
    };
  }

  const snooze = lower.match(/^snooze (.+)$/);
  if (snooze) {
    return {
      intent: { kind: "email.triage", query: snooze[1], action: "snooze" },
      requiresConfirmation: true,
    };
  }

  const waiting = lower.match(/^(?:mark )?(.+) as waiting$/);
  if (waiting) {
    return {
      intent: { kind: "email.triage", query: waiting[1], action: "mark_waiting" },
      requiresConfirmation: true,
    };
  }

  const unsubscribe = lower.match(/^unsubscribe(?: from)? (.+)$/);
  if (unsubscribe) {
    return {
      intent: { kind: "email.triage", query: unsubscribe[1], action: "unsubscribe" },
      requiresConfirmation: true,
    };
  }

  const createRule = normalized.match(/^(?:create|make) (?:an? )?rule(?: that)? (.+)$/i);
  if (createRule) {
    return {
      intent: { kind: "email.createRule", description: createRule[1] },
      requiresConfirmation: false,
    };
  }

  const startMeeting = normalized.match(/^start recording(?: (.+))?$/i);
  if (startMeeting) {
    return {
      intent: { kind: "meeting.startRecording", title: startMeeting[1] },
      requiresConfirmation: false,
    };
  }

  if (lower === "stop recording") {
    return { intent: { kind: "meeting.stopRecording" }, requiresConfirmation: false };
  }

  if (lower.startsWith("reply ")) {
    return {
      intent: { kind: "email.composeReply", body: normalized.slice("reply ".length) },
      requiresConfirmation: false,
    };
  }

  const writePrefix = lower.startsWith("write ")
    ? "write "
    : lower.startsWith("type ")
      ? "type "
      : "";
  if (writePrefix) {
    return {
      intent: { kind: "text.insert", text: normalized.slice(writePrefix.length) },
      requiresConfirmation: false,
    };
  }

  return {
    intent: {
      kind: "app.openCommand",
      query: surface === "global" ? normalized : `${surface}: ${normalized}`,
    },
    requiresConfirmation: false,
  };
}
