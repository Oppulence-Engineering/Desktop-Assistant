import type { VoiceCommandIntent } from "@x/shared/transcription";

export interface VoiceEmailActions {
  archiveByQuery(query?: string): Promise<void>;
  labelByQuery(query: string | undefined, label: string | undefined): Promise<void>;
  snoozeByQuery?(query?: string): Promise<void>;
  markWaitingByQuery?(query?: string): Promise<void>;
  unsubscribeByQuery?(query?: string): Promise<void>;
  composeReply(threadId: string | undefined, body: string): Promise<void>;
  createRule(description: string): Promise<void>;
}

export interface VoiceCommandDeps {
  confirmed: boolean;
  emailActions: VoiceEmailActions;
}

export async function executeVoiceCommand(
  intent: VoiceCommandIntent,
  deps: VoiceCommandDeps,
): Promise<{ success: boolean; message?: string }> {
  if (intent.kind === "email.triage" && !deps.confirmed) {
    return { success: false, message: "This email action requires confirmation." };
  }

  try {
    if (intent.kind === "email.triage") {
      return executeEmailTriage(intent, deps.emailActions);
    }
    if (intent.kind === "email.composeReply") {
      await deps.emailActions.composeReply(intent.threadId, intent.body);
      return { success: true };
    }
    if (intent.kind === "email.createRule") {
      await deps.emailActions.createRule(intent.description);
      return { success: true };
    }
    return { success: false, message: `Voice command "${intent.kind}" is not supported yet.` };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Voice command failed.",
    };
  }
}

async function executeEmailTriage(
  intent: Extract<VoiceCommandIntent, { kind: "email.triage" }>,
  emailActions: VoiceEmailActions,
): Promise<{ success: boolean; message?: string }> {
  if (intent.action === "archive") {
    await emailActions.archiveByQuery(intent.query);
    return { success: true };
  }
  if (intent.action === "label") {
    await emailActions.labelByQuery(intent.query, intent.label);
    return { success: true };
  }
  if (intent.action === "snooze" && emailActions.snoozeByQuery) {
    await emailActions.snoozeByQuery(intent.query);
    return { success: true };
  }
  if (intent.action === "mark_waiting" && emailActions.markWaitingByQuery) {
    await emailActions.markWaitingByQuery(intent.query);
    return { success: true };
  }
  if (intent.action === "unsubscribe" && emailActions.unsubscribeByQuery) {
    await emailActions.unsubscribeByQuery(intent.query);
    return { success: true };
  }
  return { success: false, message: `Email action "${intent.action}" is not wired yet.` };
}
