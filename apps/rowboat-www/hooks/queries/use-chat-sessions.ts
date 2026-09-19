"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchChatSessions } from "@/hooks/queries/utils/fetch-chat-sessions";
import {
  CHAT_SESSION_LIST_STALE_TIME,
  chatSessionKeys,
} from "@/hooks/queries/utils/chat-session-keys";

export function useRemoteChatSessions() {
  return useQuery({
    queryKey: chatSessionKeys.list(),
    queryFn: ({ signal }) => fetchChatSessions(signal),
    staleTime: CHAT_SESSION_LIST_STALE_TIME,
  });
}
