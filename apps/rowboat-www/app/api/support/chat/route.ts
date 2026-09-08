import { NextRequest, NextResponse } from "next/server";

import { readSessionCookie } from "@/lib/auth/cookies";
import { fetchViewerIdentity } from "@/lib/auth/rowboat-api";
import { emailHash, getSupportChatConfig } from "@/lib/support/config";

/**
 * GET /api/support/chat — everything the browser needs to boot Plain's chat
 * widget.
 *
 * The email hash is minted here rather than in the client bundle because it is
 * a bearer credential for the customer's identity: leaking the chat secret
 * would let anyone impersonate any customer in our support inbox. The email is
 * taken from the sealed session (and preferably from rowboat-api's verified
 * viewer record), never from a query parameter.
 *
 * Anonymous callers get `{ appId }` with no identity, which is the correct
 * state for the marketing site: visitors can still chat, and Plain's own email
 * verification handles identifying them.
 */
export async function GET(request: NextRequest) {
  const { appId } = getSupportChatConfig();
  // No chat app configured (local dev, self-hosted): report it plainly so the
  // client can skip loading Plain's script entirely.
  if (!appId) {
    return NextResponse.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  }

  const session = readSessionCookie(request);
  if (!session) {
    return NextResponse.json(
      { configured: true, appId },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Prefer the API's verified email over the cookie copy so a stale sealed
  // session can't pin the widget to an address the user no longer owns. The
  // lookup is best-effort: support must stay reachable when the API is down.
  let email = session.user.email;
  try {
    const identity = await fetchViewerIdentity(session);
    if (identity?.user.email) email = identity.user.email;
  } catch {
    // fall through to the session email
  }

  const hash = email ? emailHash(email) : null;
  return NextResponse.json(
    {
      configured: true,
      appId,
      // Only claim an identity when we can also prove it. An unverified email
      // would be rejected by Plain and risks merging the wrong customer.
      customer: hash ? { email, emailHash: hash } : undefined,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
