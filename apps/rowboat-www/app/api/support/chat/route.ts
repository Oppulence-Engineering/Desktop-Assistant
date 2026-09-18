import { connection, NextRequest, NextResponse } from "next/server";

import { SupportChatConfigSchema } from "@/lib/api/support/chat-schema";
import { readSessionCookie } from "@/lib/auth/cookies";
import { fetchViewerIdentity } from "@/lib/auth/rowboat-api";
import {
  emailHash,
  getSupportChatConfig,
  isPlainChatEnabled,
  shouldIdentifySupportChatCustomer,
} from "@/lib/support/config";

/**
 * GET /api/support/chat — everything the browser needs to boot Plain's chat
 * widget.
 *
 * The email hash is minted here rather than in the client bundle because it is
 * a bearer credential for the customer's identity: leaking the chat secret
 * would let anyone impersonate any customer in our support inbox. The email is
 * taken from rowboat-api's verified viewer record, never from a query parameter
 * or a stale sealed session copy.
 *
 * Anonymous callers get `{ appId }` with no identity, which is the correct
 * state for the marketing site: visitors can still chat, and Plain's own email
 * verification handles identifying them.
 */
export async function GET(request: NextRequest) {
  // Cache Components would otherwise prerender this handler at build time,
  // freezing one anonymous response for every user. The identity here is
  // per-request and per-user, so it must be resolved at request time.
  await connection();
  if (!isPlainChatEnabled()) {
    return NextResponse.json(SupportChatConfigSchema.parse({ configured: false }), {
      headers: { "cache-control": "no-store" },
    });
  }

  const { appId, labelTypeIds } = getSupportChatConfig();

  const session = readSessionCookie(request);
  if (!session) {
    return NextResponse.json(
      SupportChatConfigSchema.parse({ configured: true, appId, labelTypeIds }),
      { headers: { "cache-control": "no-store" } },
    );
  }

  let email: string | undefined;
  try {
    const identity = await fetchViewerIdentity(session);
    email = identity?.user.email || undefined;
  } catch {
    // Support stays reachable without a verified identity when the API is down.
  }

  const hash = email && shouldIdentifySupportChatCustomer() ? emailHash(email) : null;
  return NextResponse.json(
    SupportChatConfigSchema.parse({
      configured: true,
      appId,
      labelTypeIds,
      customer: hash ? { email, emailHash: hash } : undefined,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
