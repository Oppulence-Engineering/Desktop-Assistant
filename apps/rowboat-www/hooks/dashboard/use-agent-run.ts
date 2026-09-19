"use client";

import "client-only";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  applyAgentEvent,
  friendlyAgentError,
  type ApprovalRequest,
  type ConversationItem,
} from "@/lib/agents/agent-history";
import {
  parseKnownAgentStreamEvent,
  readAgentEventStream,
  type AgentStreamEvent,
} from "@/lib/agents/agent-stream";
import { dashboardFetch } from "@/lib/auth/client";
import { prepareWebChatInput } from "@/lib/agents/chat-attachments";
import { requestDashboardJson } from "@/lib/dashboard/dashboard-json";
import {
  ApprovalTokenResponseSchema,
  CreatedAgentSessionSchema,
  MutationResponseSchema,
} from "@/lib/dashboard/dashboard-schemas";

export type AgentRunStatus = "submitted" | "streaming" | "ready" | "error";

export type AgentRunSnapshot = {
  runId: string;
  items: ConversationItem[];
};

function isTerminalEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "agent.session_completed" ||
    event.type === "agent.session_failed" ||
    event.type === "agent.session_canceled"
  );
}

function createReconnectDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 1_000);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Owns one active durable agent run: transcript state, stream reconnects,
 * approvals, cancellation, attachments, and turn submission.
 */
export function useAgentRun(selectedAgent: string) {
  const [runId, setRunId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [status, setStatus] = useState<AgentRunStatus>("ready");
  const [processing, setProcessing] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const streamAbortRef = useRef<AbortController | null>(null);

  const resetRun = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setRunId(null);
    setConversation([]);
    setStatus("ready");
  }, []);

  const openRun = useCallback((snapshot: AgentRunSnapshot) => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setConversation(snapshot.items);
    setRunId(snapshot.runId);
    setStatus("ready");
    setChatError(null);
  }, []);

  const beginOpenRun = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStatus("submitted");
    setChatError(null);
  }, []);

  const failOpenRun = useCallback((message: string) => {
    setConversation([]);
    setStatus("error");
    setChatError(message);
  }, []);

  const handleEvent = useCallback((rawEvent: AgentStreamEvent) => {
    const event = parseKnownAgentStreamEvent(rawEvent);
    if (!event) return;
    setConversation((items) => applyAgentEvent(items, event));

    switch (event.type) {
      case "agent.session_started":
      case "agent.turn_started":
      case "agent.llm_call_started":
      case "agent.approval_resolved":
        setProcessing(true);
        setStatus("streaming");
        break;
      case "agent.approval_requested":
      case "agent.turn_completed":
      case "agent.session_completed":
      case "agent.session_canceled":
      case "agent.session_paused":
        setProcessing(false);
        setStatus("ready");
        break;
      case "agent.turn_failed":
      case "agent.session_failed":
      case "agent.limit_exceeded":
        setChatError(
          event.data.error
            ? friendlyAgentError(event.data.error)
            : event.type === "agent.limit_exceeded"
              ? "This run reached its configured limit."
              : "The agent run failed.",
        );
        setProcessing(false);
        setStatus("error");
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    const streamUrl = `/api/rowboat/v1/agent-sessions/${encodeURIComponent(runId)}/stream`;
    streamAbortRef.current = controller;
    let afterSeq = -1;
    let terminal = false;

    const follow = async () => {
      while (!controller.signal.aborted && !terminal) {
        try {
          const cursor = afterSeq >= 0 ? `?afterSeq=${afterSeq}` : "";
          const response = await dashboardFetch(`${streamUrl}${cursor}`, {
            headers: { Accept: "application/x-ndjson" },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Agent stream failed (${response.status})`);
          }
          setChatError((current) =>
            current === "Connection to the agent was interrupted. Reconnecting…" ? null : current,
          );
          await readAgentEventStream(response.body, (event) => {
            afterSeq = Math.max(afterSeq, event.seq);
            terminal = isTerminalEvent(event);
            handleEvent(event);
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("Agent stream interrupted:", error);
          setChatError("Connection to the agent was interrupted. Reconnecting…");
        }
        if (!terminal) await createReconnectDelay(controller.signal);
      }
    };

    void follow();
    return () => {
      controller.abort();
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    };
  }, [handleEvent, runId]);

  const stopRun = useCallback(async () => {
    if (!runId) return;
    setStatus("submitted");
    try {
      await requestDashboardJson(
        `/agent-sessions/${encodeURIComponent(runId)}/cancel`,
        MutationResponseSchema,
        { method: "POST" },
      );
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setRunId(null);
      setProcessing(false);
      setStatus("ready");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not stop the run");
      setStatus("streaming");
    }
  }, [runId]);

  const resolveApproval = useCallback(
    async (approval: ApprovalRequest, decision: "granted" | "denied") => {
      if (!runId) return;
      setConversation((items) =>
        items.map((item) =>
          item.type === "approval" && item.approvalId === approval.approvalId
            ? { ...item, status: "resolving" }
            : item,
        ),
      );
      try {
        let approvalToken: string | undefined;
        if (decision === "granted" && approval.trustTier === "money-moving") {
          const token = await requestDashboardJson(
            `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}/token`,
            ApprovalTokenResponseSchema,
            { method: "POST" },
          );
          approvalToken = token.approvalToken;
        }
        await requestDashboardJson(
          `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}`,
          MutationResponseSchema,
          {
            method: "POST",
            headers: approvalToken ? { "X-Approval-Token": approvalToken } : undefined,
            body: JSON.stringify({ decision }),
          },
        );
        setConversation((items) =>
          items.map((item) =>
            item.type === "approval" && item.approvalId === approval.approvalId
              ? { ...item, status: decision }
              : item,
          ),
        );
      } catch (error) {
        setConversation((items) =>
          items.map((item) =>
            item.type === "approval" && item.approvalId === approval.approvalId
              ? { ...item, status: "pending" }
              : item,
          ),
        );
        setChatError(error instanceof Error ? error.message : "Could not resolve the approval");
      }
    },
    [runId],
  );

  const submit = useCallback(
    async (message: PromptInputMessage) => {
      if (!(message.text || message.files?.length)) return;

      let prepared: Awaited<ReturnType<typeof prepareWebChatInput>>;
      try {
        prepared = await prepareWebChatInput(message);
      } catch (error) {
        const nextError = error instanceof Error ? error : new Error("Could not read attachment");
        setChatError(nextError.message);
        setStatus("error");
        window.setTimeout(() => setStatus("ready"), 2_000);
        throw nextError;
      }

      const originalText = message.text || "";
      const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      setConversation((items) => [
        ...items,
        {
          id: userMessageId,
          type: "message",
          role: "user",
          content: prepared.display,
          timestamp: Date.now(),
        },
      ]);
      setStatus("submitted");
      setChatError(null);
      setText("");

      try {
        if (!runId) {
          const created = await requestDashboardJson(
            "/agent-sessions/",
            CreatedAgentSessionSchema,
            {
              method: "POST",
              body: JSON.stringify({
                agent: selectedAgent,
                input: prepared.input,
                title: prepared.display.slice(0, 120),
                channel: "web",
              }),
            },
          );
          setRunId(created.sessionId);
        } else {
          await requestDashboardJson(
            `/agent-sessions/${encodeURIComponent(runId)}/turns`,
            MutationResponseSchema,
            {
              method: "POST",
              body: JSON.stringify({ input: prepared.input }),
            },
          );
        }
        setStatus("streaming");
      } catch (error) {
        setConversation((items) => items.filter((item) => item.id !== userMessageId));
        setText(originalText);
        setChatError(error instanceof Error ? error.message : "Failed to send message");
        setStatus("error");
        window.setTimeout(() => setStatus("ready"), 2_000);
        throw error;
      }
    },
    [runId, selectedAgent],
  );

  return {
    beginOpenRun,
    chatError,
    conversation,
    failOpenRun,
    openRun,
    processing,
    resetRun,
    resolveApproval,
    runId,
    setChatError,
    setText,
    status,
    stopRun,
    submit,
    text,
  };
}
