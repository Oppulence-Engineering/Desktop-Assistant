import type { QueryClient } from "@tanstack/react-query";

import { loadChatSessions } from "@/hooks/queries/utils/fetch-chat-sessions";
import { loadImpact } from "@/hooks/queries/utils/fetch-impact";
import {
  CHAT_SESSION_LIST_STALE_TIME,
  chatSessionKeys,
} from "@/hooks/queries/utils/chat-session-keys";
import { IMPACT_BUNDLE_STALE_TIME, impactKeys } from "@/hooks/queries/utils/impact-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

/** Seed home pulse and session list before the chat island paints. */
export async function prefetchChatHome(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    seedQuery(queryClient, {
      queryKey: impactKeys.all,
      queryFn: ({ signal }) => loadImpact(requestUpstreamJson, signal),
      staleTime: IMPACT_BUNDLE_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: chatSessionKeys.list(),
      queryFn: ({ signal }) => loadChatSessions(requestUpstreamJson, signal),
      staleTime: CHAT_SESSION_LIST_STALE_TIME,
    }),
  ]);
}
