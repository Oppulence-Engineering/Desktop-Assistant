import { NextRequest, NextResponse } from "next/server";

import { readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { fetchViewer, fetchViewerIdentity } from "@/lib/auth/rowboat-api";
import { resolveSessionRefresh } from "@/lib/auth/session-refresh";
import { BrowserSessionResponseSchema } from "@/lib/auth/schemas";

export async function GET(request: NextRequest) {
  let session = readSessionCookie(request);
  if (!session) {
    return NextResponse.json(BrowserSessionResponseSchema.parse({ authenticated: false }), {
      status: 401,
    });
  }

  const refreshedSession = await resolveSessionRefresh({
    session,
    sessionExpiredResponse: () =>
      NextResponse.json(BrowserSessionResponseSchema.parse({ authenticated: false }), {
        status: 401,
      }),
    refreshUnavailableResponse: () =>
      NextResponse.json(
        { error: "session refresh is temporarily unavailable", code: "session_unavailable" },
        { status: 503 },
      ),
  });
  if (!refreshedSession.ok) {
    return refreshedSession.response;
  }
  session = refreshedSession.session;
  const refreshed = refreshedSession.refreshed;

  let viewer: Awaited<ReturnType<typeof fetchViewer>> | undefined;
  let identity: Awaited<ReturnType<typeof fetchViewerIdentity>> | undefined;
  try {
    viewer = await fetchViewer(session);
  } catch {
    try {
      identity = await fetchViewerIdentity(session);
    } catch {
      return NextResponse.json(
        { error: "could not verify viewer identity", code: "session_unavailable" },
        { status: 502 },
      );
    }
  }

  const payload = BrowserSessionResponseSchema.parse({
    authenticated: true,
    user: {
      id: viewer?.user.id ?? identity?.user.id,
      workosUserId: session.user.workosUserId,
      email: viewer?.user.email || identity?.user.email || session.user.email,
      sessionId: session.user.sessionId,
      organizationId: session.user.organizationId,
      role: session.user.role,
      permissions: session.user.permissions,
    },
    billing: viewer?.billing,
    expiresAt: session.expiresAt,
  });
  const response = NextResponse.json(payload);
  if (refreshed) setSessionCookie(response, session);
  return response;
}
