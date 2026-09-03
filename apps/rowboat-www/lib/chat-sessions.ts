"use client";

import "client-only";

/**
 * Sensitive chat history is cached in memory only; the organization-scoped
 * agent-session event log is the durable source used after a reload.
 */

const MAX_SESSIONS = 30;

export type SessionScope = {
  organizationId?: string;
  userId: string;
};

export type SessionMeta = {
  runId: string;
  title: string;
  agent?: string;
  updatedAt: number;
};

export type StoredSession = SessionMeta & {
  items: unknown[];
};

const sessionsByScope = new Map<string, Map<string, StoredSession>>();

function scopeKey(scope: SessionScope): string {
  return `${scope.organizationId ?? "personal"}:${scope.userId}`;
}

function sessionsFor(scope: SessionScope): Map<string, StoredSession> {
  const key = scopeKey(scope);
  const existing = sessionsByScope.get(key);
  if (existing) return existing;
  const created = new Map<string, StoredSession>();
  sessionsByScope.set(key, created);
  return created;
}

export function listSessions(scope: SessionScope): SessionMeta[] {
  return [...sessionsFor(scope).values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(({ runId, title, agent, updatedAt }) => ({ runId, title, agent, updatedAt }));
}

export function loadSession(scope: SessionScope, runId: string): StoredSession | null {
  return sessionsFor(scope).get(runId) ?? null;
}

export function saveSession(scope: SessionScope, session: StoredSession): void {
  const sessions = sessionsFor(scope);
  sessions.set(session.runId, session);
  const overflow = [...sessions.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(MAX_SESSIONS);
  for (const stale of overflow) sessions.delete(stale.runId);
}
