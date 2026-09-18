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
 * Signed-in users are linked by `externalId` and their verified email. The
 * email is an unverified inbox hint unless we also mint `emailHash`. That
 * hash is opt-in: a mismatched HMAC takes the widget down, so we never send
 * one by default.
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

  let externalId: string | undefined;
  let email: string | undefined;
  try {
    const identity = await fetchViewerIdentity(session);
    externalId = identity?.user.id || undefined;
    email = identity?.user.email || undefined;
  } catch {
    // The inbox can still see who is chatting from the sealed session when
    // rowboat-api is down. That email is an unverified hint, never hashed.
  }
  externalId = externalId || session.user.workosUserId || undefined;
  email = email || session.user.email || undefined;

  const hash = email && shouldIdentifySupportChatCustomer() ? emailHash(email) : null;
  const customer =
    externalId || email
      ? {
          ...(externalId ? { externalId } : {}),
          ...(email ? { email } : {}),
          ...(hash ? { emailHash: hash } : {}),
        }
      : undefined;

  return NextResponse.json(
    SupportChatConfigSchema.parse({
      configured: true,
      appId,
      labelTypeIds,
      customer,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
