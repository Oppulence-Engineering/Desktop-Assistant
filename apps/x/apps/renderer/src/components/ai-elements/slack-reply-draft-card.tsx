"use client";

import { useCallback, useState } from "react";
import { CheckCircleIcon, Copy, LoaderIcon, MessageSquareIcon, Send } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SlackReplyDraftCardProps {
  teamId: string;
  channel: string;
  threadTs: string;
  text: string;
  status: "pending" | "running" | "completed" | "error";
}

export function SlackReplyDraftCard({
  teamId,
  channel,
  threadTs,
  text,
  status,
}: SlackReplyDraftCardProps) {
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isReady = status === "completed";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Slack draft copied");
    } catch {
      toast.error("Failed to copy Slack draft");
    }
  }, [text]);

  const handleSend = useCallback(async () => {
    setSendState("sending");
    setErrorMessage(null);
    try {
      const result = await window.ipc.invoke("slack:sendReplyDraft", {
        teamId,
        channel,
        threadTs,
        text,
      });
      if (!result.success) {
        setSendState("error");
        setErrorMessage(result.error || "Failed to send Slack reply");
        toast.error(result.error || "Failed to send Slack reply");
        return;
      }
      setSendState("sent");
      toast.success("Slack reply sent");
    } catch {
      setSendState("error");
      setErrorMessage("Failed to send Slack reply");
      toast.error("Failed to send Slack reply");
    }
  }, [channel, teamId, text, threadTs]);

  return (
    <div className="not-prose mb-4 border bg-card text-card-foreground">
      <div className="flex items-start gap-3 border-b px-3 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center bg-muted text-muted-foreground">
          <MessageSquareIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Slack reply draft</span>
            {sendState === "sent" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                <CheckCircleIcon className="size-3.5" />
                Sent
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {teamId} / {channel} / {threadTs}
          </p>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="max-h-56 overflow-auto border bg-muted/40 p-3 text-sm leading-6 whitespace-pre-wrap break-words">
          {text}
        </div>
        {errorMessage && <p className="mt-2 text-xs text-destructive">{errorMessage}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Review before sending. The assistant did not post this automatically.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCopy} disabled={!isReady}>
            <Copy className="mr-1.5 size-3.5" />
            Copy
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!isReady || sendState === "sending" || sendState === "sent"}
          >
            {sendState === "sending" ? (
              <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />
            ) : sendState === "sent" ? (
              <CheckCircleIcon className="mr-1.5 size-3.5" />
            ) : (
              <Send className="mr-1.5 size-3.5" />
            )}
            {sendState === "sent" ? "Sent" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
