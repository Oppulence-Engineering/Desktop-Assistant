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

import { type NextRequest, NextResponse, userAgent } from "next/server";

/**
 * Maps each supported platform key to a matcher over a release asset filename.
 * The two apps use different packagers, so their filenames differ: Desktop is
 * Electron Forge (darwin-arm64.dmg, _amd64.deb) and Voice is electron-builder
 * (arm64.dmg, linux-amd64.deb).
 */
const DESKTOP_MATCHERS = {
  "mac-arm64": /darwin-arm64.*\.dmg$/i,
  "mac-x64": /darwin-x64.*\.dmg$/i,
  "windows-x64": /win32-x64.*setup\.exe$/i,
  "linux-deb-x64": /_amd64\.deb$/i,
  "linux-deb-arm64": /_arm64\.deb$/i,
  "linux-rpm-x64": /x86_64\.rpm$/i,
  "linux-rpm-arm64": /\.arm64\.rpm$/i,
} as const;

const VOICE_MATCHERS = {
  "mac-arm64": /-arm64\.dmg$/i,
  // electron-builder names the Intel build with no arch suffix
  // (OpenWhispr-1.9.0.dmg), so require a full version right before .dmg.
  "mac-x64": /\d+\.\d+\.\d+\.dmg$/i,
  "windows-x64": /\.exe$/i,
  "linux-deb-x64": /linux-amd64\.deb$/i,
  "linux-deb-arm64": /linux-arm64\.deb$/i,
  "linux-rpm-x64": /x86_64\.rpm$/i,
  "linux-rpm-arm64": /aarch64\.rpm$/i,
} as const;

type Platform = keyof typeof DESKTOP_MATCHERS;

const APPS = {
  desktop: {
    repo: process.env.DESKTOP_RELEASES_REPO ?? "Oppulence-Engineering/Desktop-Assistant",
    matchers: DESKTOP_MATCHERS,
  },
  voice: {
    repo: process.env.VOICE_RELEASES_REPO ?? "PlaybookMediaLLC/openwhispr",
    matchers: VOICE_MATCHERS,
  },
} as const;

type AppKey = keyof typeof APPS;

function isApp(value: string | null): value is AppKey {
  return value !== null && value in APPS;
}

function isPlatform(value: string | null): value is Platform {
  return value !== null && value in DESKTOP_MATCHERS;
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
  const params = new URL(request.url).searchParams;
  const requested = params.get("platform");
  const requestedApp = params.get("app");
  const app = APPS[isApp(requestedApp) ? requestedApp : "desktop"];
  const platform: Platform = isPlatform(requested) ? requested : detectPlatform(request);
  const releasesPage = `https://github.com/${app.repo}/releases/latest`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oppulence-www",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(`https://api.github.com/repos/${app.repo}/releases?per_page=20`, {
      headers,
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.redirect(releasesPage, 302);
    }

    const releases = (await res.json()) as Release[];
    const pattern = app.matchers[platform];

    // Newest-first: redirect to the first release that has an installer for this platform.
    for (const release of releases) {
      if (release.draft) continue;
      const asset = release.assets?.find((a) => pattern.test(a.name));
      if (asset) {
        return NextResponse.redirect(asset.browser_download_url, 302);
      }
    }

    return NextResponse.redirect(releasesPage, 302);
  } catch {
    return NextResponse.redirect(releasesPage, 302);
  }
}
