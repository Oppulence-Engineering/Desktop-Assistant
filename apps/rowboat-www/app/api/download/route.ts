/**
 * Desktop download resolver for the Oppulence desktop app.
 *
 * A single endpoint detects the visitor's platform, looks up the latest desktop
 * release on GitHub, and redirects to the matching installer.
 *
 * Usage:
 *   GET /api/download                      -> auto-detect from User-Agent
 *   GET /api/download?platform=mac-arm64   -> explicit platform
 *
 * Resolution: walks recent releases newest-first and redirects to the first one
 * that actually has an installer for the platform. This keeps downloads working
 * when the latest release is missing a platform (e.g. macOS builds were dropped
 * after v0.1.16) and auto-upgrades the moment that platform ships again.
 *
 * Failure mode: any miss (rate limit, unknown platform, no matching asset) falls
 * back to the public releases page so the user always lands somewhere useful.
 *
 * Config: set DESKTOP_RELEASES_REPO ("owner/repo") to point at the repo that
 * publishes the desktop installers, and GITHUB_TOKEN for authenticated headroom.
 */

import { type NextRequest, NextResponse, userAgent } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = process.env.DESKTOP_RELEASES_REPO ?? "Oppulence-Engineering/Desktop-Assistant";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/**
 * Maps each supported platform key to a matcher over a release asset filename.
 */
const PLATFORM_MATCHERS = {
  "mac-arm64": /darwin-arm64.*\.dmg$/i,
  "mac-x64": /darwin-x64.*\.dmg$/i,
  "windows-x64": /win32-x64.*setup\.exe$/i,
  "linux-deb-x64": /_amd64\.deb$/i,
  "linux-deb-arm64": /_arm64\.deb$/i,
  "linux-rpm-x64": /x86_64\.rpm$/i,
  "linux-rpm-arm64": /\.arm64\.rpm$/i,
} as const;

type Platform = keyof typeof PLATFORM_MATCHERS;

function isPlatform(value: string | null): value is Platform {
  return value !== null && value in PLATFORM_MATCHERS;
}

function detectPlatform(request: NextRequest): Platform {
  const { os, cpu } = userAgent(request);
  const name = os.name?.toLowerCase() ?? "";
  const arch = cpu.architecture?.toLowerCase() ?? "";
  const isIntel = arch.includes("x86") || arch.includes("amd64") || arch.includes("ia32");
  const isArm = arch.includes("arm") || arch.includes("aarch64");

  if (name.includes("mac")) {
    return isIntel ? "mac-x64" : "mac-arm64";
  }
  if (name.includes("windows")) {
    return "windows-x64";
  }
  if (name.includes("linux") || name.includes("ubuntu")) {
    return isArm ? "linux-deb-arm64" : "linux-deb-x64";
  }
  return "mac-arm64";
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  draft: boolean;
  assets: ReleaseAsset[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requested = new URL(request.url).searchParams.get("platform");
  const platform: Platform = isPlatform(requested) ? requested : detectPlatform(request);

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oppulence-www",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(RELEASES_API, { headers, next: { revalidate: 300 } });
    if (!res.ok) {
      return NextResponse.redirect(RELEASES_PAGE, 302);
    }

    const releases = (await res.json()) as Release[];
    const pattern = PLATFORM_MATCHERS[platform];

    // Newest-first: redirect to the first release that has an installer for this platform.
    for (const release of releases) {
      if (release.draft) continue;
      const asset = release.assets?.find((a) => pattern.test(a.name));
      if (asset) {
        return NextResponse.redirect(asset.browser_download_url, 302);
      }
    }

    return NextResponse.redirect(RELEASES_PAGE, 302);
  } catch {
    return NextResponse.redirect(RELEASES_PAGE, 302);
  }
}
