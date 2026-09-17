import "server-only";

import { z } from "zod";

/** Default repo for Oppulence Desktop installers and changelog cards. */
export const DESKTOP_RELEASES_REPO =
  process.env.DESKTOP_RELEASES_REPO ?? "Oppulence-Engineering/Desktop-Assistant";

/** Default repo for Oppulence Voice (OpenWhispr) installers. */
export const VOICE_RELEASES_REPO = process.env.VOICE_RELEASES_REPO ?? "PlaybookMediaLLC/openwhispr";

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type GitHubReleaseListItem = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
};

export const GitHubReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string().url(),
});

export const GitHubReleaseListItemSchema = z
  .object({
    tag_name: z.string().optional(),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    published_at: z.string().nullable().optional(),
    html_url: z.string().optional(),
    assets: z.array(GitHubReleaseAssetSchema).optional(),
  })
  .passthrough();

export const GitHubReleaseListSchema = z.array(GitHubReleaseListItemSchema);

const TRUSTED_GITHUB_DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);

export function isTrustedGitHubDownloadURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_GITHUB_DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function githubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "oppulence-www",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type FetchGitHubReleasesOptions = {
  perPage?: number;
  revalidate?: number;
  timeoutMs?: number;
};

/**
 * Loads recent releases from the GitHub REST API. Returns null on any upstream
 * miss so callers can fail closed or redirect without throwing.
 */
export async function fetchGitHubReleases<T extends GitHubReleaseListItem = GitHubReleaseListItem>(
  repo: string,
  options: FetchGitHubReleasesOptions = {},
): Promise<T[] | null> {
  const { perPage = 10, revalidate = 900, timeoutMs = 8_000 } = options;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`,
      {
        headers: githubApiHeaders(),
        next: { revalidate },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) return null;

    const parsed = GitHubReleaseListSchema.safeParse(await response.json());
    return parsed.success ? (parsed.data as T[]) : null;
  } catch {
    return null;
  }
}

export function latestReleasesPageURL(repo: string): string {
  return `https://github.com/${repo}/releases/latest`;
}
