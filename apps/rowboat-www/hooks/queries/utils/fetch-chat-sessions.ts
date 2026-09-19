import { ListAgentSessions200Response } from "@/lib/api/generated/zod/agent-sessions/agent-sessions";
import { isOptionalRequestFailure, requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { SessionMeta } from "@/lib/chat-sessions";

const CHAT_SESSIONS_PATH = "/agent-sessions";

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

export async function loadChatSessions(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<SessionMeta[]> {
  try {
    const data = await request({
      path: CHAT_SESSIONS_PATH,
      schema: ListAgentSessions200Response,
      signal,
    });
    return data.sessions.map((session) => ({
      runId: session.sessionId,
      title: sessionTitle(session),
      agent: session.agent,
      updatedAt: new Date(session.lastActivityAt || session.createdAt).getTime(),
    }));
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export function fetchChatSessions(signal?: AbortSignal): Promise<SessionMeta[]> {
  return loadChatSessions(requestJson, signal);
}
