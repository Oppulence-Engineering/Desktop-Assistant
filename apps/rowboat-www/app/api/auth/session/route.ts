import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import {
  fetchViewer,
  fetchViewerIdentity,
  refreshWorkOSSession,
  shouldRefreshSession,
} from "@/lib/auth/rowboat-api";
import { BrowserSessionResponseSchema } from "@/lib/auth/schemas";

export async function GET(request: NextRequest) {
  let session = readSessionCookie(request);
  if (!session) {
    return NextResponse.json(BrowserSessionResponseSchema.parse({ authenticated: false }), {
      status: 401,
    });
  }

  let refreshed = false;
  if (shouldRefreshSession(session)) {
    let next: Awaited<ReturnType<typeof refreshWorkOSSession>>;
    try {
      next = await refreshWorkOSSession(session);
    } catch {
      return NextResponse.json(
        { error: "session refresh is temporarily unavailable", code: "session_unavailable" },
        { status: 503 },
      );
    }
    if (!next) {
      const response = NextResponse.json(
        BrowserSessionResponseSchema.parse({ authenticated: false }),
        { status: 401 },
      );
      clearAuthCookies(response);
      return response;
    }
    session = next;
    refreshed = true;
  }

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
