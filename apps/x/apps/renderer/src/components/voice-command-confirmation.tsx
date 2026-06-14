import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VoiceCommandIntent } from "@x/shared/dist/transcription.js";

export interface VoiceCommandConfirmationProps {
  intent: VoiceCommandIntent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExecuted?: (result: { success: boolean; message?: string }) => void;
}

export function VoiceCommandConfirmation({
  intent,
  open,
  onOpenChange,
  onExecuted,
}: VoiceCommandConfirmationProps) {
  const [isRunning, setIsRunning] = useState(false);
  const summary = useMemo(() => (intent ? describeIntent(intent) : null), [intent]);
  const destructive = intent ? requiresConfirmation(intent) : false;

  const confirm = async () => {
    if (!intent) return;
    setIsRunning(true);
    try {
      const result = await window.ipc.invoke("voice:executeCommand", {
        intent,
        confirmed: destructive,
      });
      onExecuted?.(result);
      if (result.success) onOpenChange(false);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm voice command</DialogTitle>
          <DialogDescription>Review the parsed action before Rowboat applies it.</DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-3 rounded-none border bg-muted/20 p-3 text-sm">
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">Action</div>
              <div className="mt-1 text-foreground">{summary.action}</div>
            </div>
            {summary.query ? (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Affected email query
                </div>
                <div className="mt-1 break-words text-foreground">{summary.query}</div>
              </div>
            ) : null}
            {summary.detail ? (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Details</div>
                <div className="mt-1 break-words text-foreground">{summary.detail}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRunning}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!intent || isRunning}>
            {isRunning ? "Running" : destructive ? "Confirm" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function requiresConfirmation(intent: VoiceCommandIntent): boolean {
  return intent.kind === "email.triage";
}

function describeIntent(intent: VoiceCommandIntent): {
  action: string;
  query?: string;
  detail?: string;
} {
  if (intent.kind === "email.triage") {
    return {
      action: emailActionLabel(intent.action),
      query: intent.query ?? "Current email selection",
      detail: intent.label ? `Label: ${intent.label}` : undefined,
    };
  }
  if (intent.kind === "email.composeReply") {
    return { action: "Draft reply", query: intent.threadId, detail: intent.body };
  }
  if (intent.kind === "email.createRule") {
    return { action: "Create disabled email rule draft", detail: intent.description };
  }
  if (intent.kind === "meeting.startRecording") {
    return { action: "Start meeting recording", detail: intent.title };
  }
  if (intent.kind === "meeting.stopRecording") {
    return { action: "Stop meeting recording" };
  }
  if (intent.kind === "app.openCommand") {
    return { action: "Open command", detail: intent.query };
  }
  return { action: "Insert text", detail: intent.text };
}

function emailActionLabel(action: Extract<VoiceCommandIntent, { kind: "email.triage" }>["action"]) {
  if (action === "mark_waiting") return "Mark waiting";
  return action.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
