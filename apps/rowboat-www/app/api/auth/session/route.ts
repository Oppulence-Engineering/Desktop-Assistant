import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { fetchViewer, refreshWorkOSSession, shouldRefreshSession } from "@/lib/auth/rowboat-api";

export async function GET(request: NextRequest) {
  let session = readSessionCookie(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  let refreshed = false;
  if (shouldRefreshSession(session)) {
    const next = await refreshWorkOSSession(session);
    if (!next) {
      const response = NextResponse.json({ authenticated: false }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }
    session = next;
    refreshed = true;
  }

  try {
    const viewer = await fetchViewer(session);
    const response = NextResponse.json({
      authenticated: true,
      user: {
        id: viewer.user.id,
        workosUserId: session.user.workosUserId,
        email: viewer.user.email || session.user.email,
        sessionId: session.user.sessionId,
        organizationId: session.user.organizationId,
        role: session.user.role,
        permissions: session.user.permissions,
      },
      billing: viewer.billing,
      expiresAt: session.expiresAt,
    });
    if (refreshed) setSessionCookie(response, session);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not load viewer";
    return NextResponse.json({ error: message, code: "session_unavailable" }, { status: 502 });
  }
}
