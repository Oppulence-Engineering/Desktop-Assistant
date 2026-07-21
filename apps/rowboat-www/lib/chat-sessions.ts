"use client";

/**
 * Device-local chat session history. Each session stores its transcript so
 * conversations survive reloads and can be reopened from the sidebar; turns
 * keep flowing through the server session identified by runId.
 */

const INDEX_KEY = "oppulence:chat-sessions";
const SESSION_PREFIX = "oppulence:chat-session:";
const MAX_SESSIONS = 30;

export type SessionMeta = {
  runId: string;
  title: string;
  agent?: string;
  updatedAt: number;
};

export type StoredSession = SessionMeta & {
  items: unknown[];
};

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids.slice(0, MAX_SESSIONS)));
}

export function listSessions(): SessionMeta[] {
  if (typeof window === "undefined") return [];
  const metas: SessionMeta[] = [];
  for (const id of readIndex()) {
    const stored = loadSession(id);
    if (stored) {
      metas.push({
        runId: stored.runId,
        title: stored.title,
        agent: stored.agent,
        updatedAt: stored.updatedAt,
      });
    }
  }
  return metas;
}

export function loadSession(runId: string): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + runId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.runId !== "string" || !Array.isArray(parsed.items)) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_PREFIX + session.runId, JSON.stringify(session));
  } catch {
    return; // storage full — skip persisting rather than breaking chat
  }
  const ids = readIndex().filter((id) => id !== session.runId);
  ids.unshift(session.runId);
  for (const evicted of ids.slice(MAX_SESSIONS)) {
    localStorage.removeItem(SESSION_PREFIX + evicted);
  }
  writeIndex(ids);
}

export function deleteSession(runId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_PREFIX + runId);
  writeIndex(readIndex().filter((id) => id !== runId));
}
