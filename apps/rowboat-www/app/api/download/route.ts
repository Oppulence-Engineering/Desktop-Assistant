/**
 * Download resolver for the Oppulence desktop apps.
 *
 * Two apps ship installers from two different repositories:
 *   - "desktop" -> Oppulence Desktop
 *   - "voice"   -> Oppulence Voice (the OpenWhispr build)
 *
 * A single endpoint detects the visitor's platform, looks up the latest release
 * for the requested app, and redirects to the matching installer.
 *
 * Usage:
 *   GET /api/download                              -> Desktop, auto-detected
 *   GET /api/download?platform=mac-arm64           -> Desktop, explicit platform
 *   GET /api/download?app=voice                    -> Voice, auto-detected
 *   GET /api/download?app=voice&platform=mac-arm64 -> Voice, explicit platform
 *
 * Resolution: walks recent releases newest-first and redirects to the first one
 * that actually has an installer for the platform. This keeps downloads working
 * when the latest release is missing a platform (e.g. macOS builds were dropped
 * after v0.1.16) and auto-upgrades the moment that platform ships again.
 *
 * Failure mode: any miss (rate limit, unknown platform, no matching asset) falls
 * back to that app's public releases page, so the user always lands somewhere
 * useful rather than on an error.
 *
 * Config: DESKTOP_RELEASES_REPO and VOICE_RELEASES_REPO ("owner/repo") override
 * the source repositories; GITHUB_TOKEN buys authenticated rate-limit headroom.
 */

import { type NextRequest, NextResponse } from "next/server";

import { resolveApp, resolveDownloadTarget, resolvePlatform } from "@/lib/api/download/resolver";
import { parseSearchParams } from "@/lib/api/routes/parse";
import { DownloadQuerySchema } from "@/lib/api/routes/schemas/download";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const query = parseSearchParams(params, DownloadQuerySchema);
  const app = resolveApp(query.success ? (query.data.app ?? null) : null);
  const platform =
    query.success && query.data.platform ? query.data.platform : resolvePlatform(request, null);
  const target = await resolveDownloadTarget(app, platform);
  return NextResponse.redirect(target.url, 302);
}
