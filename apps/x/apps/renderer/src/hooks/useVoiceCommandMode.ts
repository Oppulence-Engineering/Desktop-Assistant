import { useCallback, useState } from "react";
import type { VoiceCommandIntent } from "@x/shared/dist/transcription.js";

export type VoiceCommandSurface = "global" | "chat" | "email" | "meeting";

export interface ParsedVoiceCommand {
  intent: VoiceCommandIntent;
  requiresConfirmation: boolean;
}

export interface VoiceCommandExecutionResult {
  success: boolean;
  message?: string;
}

export function useVoiceCommandMode(surface: VoiceCommandSurface = "global") {
  const [pendingIntent, setPendingIntent] = useState<VoiceCommandIntent | null>(null);
  const [lastResult, setLastResult] = useState<VoiceCommandExecutionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(
    async (
      intent: VoiceCommandIntent,
      confirmed: boolean,
    ): Promise<VoiceCommandExecutionResult> => {
      setIsRunning(true);
      try {
        const result = await window.ipc.invoke("voice:executeCommand", { intent, confirmed });
        setLastResult(result);
        if (result.success) setPendingIntent(null);
        return result;
      } finally {
        setIsRunning(false);
      }
    },
    [],
  );

  const runTranscript = useCallback(
    async (text: string): Promise<ParsedVoiceCommand> => {
      setIsRunning(true);
      try {
        const parsed = await window.ipc.invoke("voice:parseCommand", { text, surface });
        if (parsed.requiresConfirmation) {
          setPendingIntent(parsed.intent);
          setLastResult(null);
          return parsed;
        }
        const result = await window.ipc.invoke("voice:executeCommand", {
          intent: parsed.intent,
          confirmed: false,
        });
        setLastResult(result);
        return parsed;
      } finally {
        setIsRunning(false);
      }
    },
    [surface],
  );

  const confirmPending = useCallback(async (): Promise<VoiceCommandExecutionResult | null> => {
    if (!pendingIntent) return null;
    return execute(pendingIntent, true);
  }, [execute, pendingIntent]);

  const cancelPending = useCallback(() => {
    setPendingIntent(null);
  }, []);

  return {
    pendingIntent,
    lastResult,
    isRunning,
    runTranscript,
    execute,
    confirmPending,
    cancelPending,
  };
}
