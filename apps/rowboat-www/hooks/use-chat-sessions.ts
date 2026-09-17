"use client";

import "client-only";

import { useCallback, useEffect, useState } from "react";

import {
  conversationFromAgentEvents,
  type AgentHistoryItem,
  type ConversationItem,
} from "@/lib/agent-history";
import {
  ListAgentSessionEvents200Response,
  ListAgentSessions200Response,
} from "@/lib/api/generated/zod/agent-sessions/agent-sessions";
import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import { requestDashboardJson } from "@/lib/dashboard-json";
import {
  listSessions,
  loadSession,
  mergeSessionLists,
  saveSession,
  type SessionMeta,
  type SessionScope,
} from "@/lib/chat-sessions";
import type { AgentRunSnapshot } from "@/hooks/use-agent-run";

type ChatMessage = Extract<AgentHistoryItem, { type: "message" }>;

type UseChatSessionsOptions = {
  activeRunId: string | null;
  conversation: ConversationItem[];
  onBeginOpen: () => void;
  onFailedOpen: (message: string) => void;
  onOpen: (snapshot: AgentRunSnapshot) => void;
  onSelectAgent: (agent: string) => void;
  scope: SessionScope;
  selectedAgent: string;
};

function sessionTitle(session: {
  agent: string;
  title?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
}): string {
  return (
    session.title ||
    `${session.agent} · ${new Date(session.lastActivityAt || session.createdAt).toLocaleDateString()}`
  );
}

/**
 * Owns the local transcript cache and durable history projection. The server
 * event log remains authoritative; the memory cache only avoids repeat loads
 * during one authenticated browser session.
 */
export function useChatSessions({
  activeRunId,
  conversation,
  onBeginOpen,
  onFailedOpen,
  onOpen,
  onSelectAgent,
  scope,
  selectedAgent,
}: UseChatSessionsOptions) {
  const [remoteSessions, setRemoteSessions] = useState<SessionMeta[]>([]);
  // The memory cache contains at most 30 entries, so deriving this projection
  // during render is safer than duplicating synchronized session-list state.
  const sessions = mergeSessionLists(listSessions(scope), remoteSessions);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await requestDashboardJson("/agent-sessions", ListAgentSessions200Response);
        const remote = data.sessions.map<SessionMeta>((session) => ({
          runId: session.sessionId,
          title: sessionTitle(session),
          agent: session.agent,
          updatedAt: new Date(session.lastActivityAt || session.createdAt).getTime(),
        }));
        if (!cancelled) setRemoteSessions(remote);
      } catch (error) {
        console.error("Failed to load durable chat history", error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    if (!activeRunId || conversation.length === 0) return;
    const firstMessage = conversation.find(
      (item): item is ChatMessage => item.type === "message" && item.role === "user",
    );
    saveSession(scope, {
      runId: activeRunId,
      title: (firstMessage?.content || "New conversation").slice(0, 60),
      agent: selectedAgent,
      updatedAt: Date.now(),
      items: conversation,
    });
  }, [activeRunId, conversation, scope, selectedAgent]);

  const openSession = useCallback(
    async (nextRunId: string) => {
      if (nextRunId === activeRunId) return;
      const stored = loadSession(scope, nextRunId);
      onBeginOpen();

      try {
        let items = stored?.items;
        const meta = sessions.find((entry) => entry.runId === nextRunId);
        if (!items) {
          const events: DurableAgentSessionEvent[] = [];
          let afterSeq: number | undefined;
          // Histories are deliberately bounded until the transcript view has
          // virtualized incremental loading for pathological 50k+ event runs.
          for (let page = 0; page < 50; page += 1) {
            const query = new URLSearchParams({ limit: "1000" });
            if (afterSeq !== undefined) query.set("afterSeq", String(afterSeq));
            const data = await requestDashboardJson(
              `/agent-sessions/${encodeURIComponent(nextRunId)}/events?${query}`,
              ListAgentSessionEvents200Response,
            );
            events.push(...data.events);
            if (data.nextSeq == null || data.nextSeq === afterSeq) break;
            afterSeq = data.nextSeq;
          }
          items = conversationFromAgentEvents(events);
          saveSession(scope, {
            runId: nextRunId,
            title: meta?.title || "Conversation",
            agent: meta?.agent,
            updatedAt: meta?.updatedAt || Date.now(),
            items,
          });
        }
        onOpen({ runId: nextRunId, items });
        const agent = stored?.agent || meta?.agent;
        if (agent) onSelectAgent(agent);
      } catch (error) {
        onFailedOpen(error instanceof Error ? error.message : "Could not load conversation");
      }
    },
    [activeRunId, onBeginOpen, onFailedOpen, onOpen, onSelectAgent, scope, sessions],
  );

  return { openSession, sessions };
}
