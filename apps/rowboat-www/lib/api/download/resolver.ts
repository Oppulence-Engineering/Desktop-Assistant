import type { NextRequest } from "next/server";
import { userAgent } from "next/server";

import {
  DESKTOP_RELEASES_REPO,
  fetchGitHubReleases,
  isTrustedGitHubDownloadURL,
  latestReleasesPageURL,
  type GitHubReleaseListItem,
  VOICE_RELEASES_REPO,
} from "@/lib/api/github/releases";

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
  "windows-x64": /\d+\.\d+\.\d+.*\.exe$/i,
  "linux-deb-x64": /linux-amd64\.deb$/i,
  "linux-deb-arm64": /linux-arm64\.deb$/i,
  "linux-rpm-x64": /x86_64\.rpm$/i,
  "linux-rpm-arm64": /aarch64\.rpm$/i,
} as const;

export type Platform = keyof typeof DESKTOP_MATCHERS;

const APPS = {
  desktop: {
    repo: DESKTOP_RELEASES_REPO,
    matchers: DESKTOP_MATCHERS,
  },
  voice: {
    repo: VOICE_RELEASES_REPO,
    matchers: VOICE_MATCHERS,
  },
} as const;

export type AppKey = keyof typeof APPS;

export function isApp(value: string | null): value is AppKey {
  return value !== null && value in APPS;
}

export function isPlatform(value: string | null): value is Platform {
  return value !== null && value in DESKTOP_MATCHERS;
}

export function detectPlatform(request: NextRequest): Platform {
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

export function resolveApp(requestedApp: string | null): (typeof APPS)[AppKey] {
  return APPS[isApp(requestedApp) ? requestedApp : "desktop"];
}

export function resolvePlatform(request: NextRequest, requested: string | null): Platform {
  return isPlatform(requested) ? requested : detectPlatform(request);
}

export function releasesPageForApp(app: (typeof APPS)[AppKey]): string {
  return latestReleasesPageURL(app.repo);
}

/**
 * Walks recent releases newest-first and returns the first installer URL that
 * matches the requested platform. Draft and prerelease builds are skipped.
 */
export function findInstallerURL(
  releases: GitHubReleaseListItem[],
  platform: Platform,
  app: (typeof APPS)[AppKey],
): string | null {
  const pattern = app.matchers[platform];
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const asset = release.assets?.find((candidate) => pattern.test(candidate.name));
    if (asset && isTrustedGitHubDownloadURL(asset.browser_download_url)) {
      return asset.browser_download_url;
    }
  }
  return null;
}

export async function resolveDownloadTarget(
  app: (typeof APPS)[AppKey],
  platform: Platform,
): Promise<{ kind: "installer"; url: string } | { kind: "fallback"; url: string }> {
  const fallback = releasesPageForApp(app);
  const releases = await fetchGitHubReleases(app.repo, {
    perPage: 20,
    timeoutMs: 8_000,
  });
  if (!releases) return { kind: "fallback", url: fallback };

  const installer = findInstallerURL(releases, platform, app);
  return installer ? { kind: "installer", url: installer } : { kind: "fallback", url: fallback };
}
