import { NextResponse } from "next/server";

import { parseReleases } from "@/lib/api/changelog/changelog";

/**
 * The latest releases, for the sidebar changelog card.
 *
 * Same source and same headers as the download resolver: GitHub releases, a
 * token only for rate-limit headroom. An upstream miss returns an empty list,
 * because a sidebar card that cannot name a real release must not appear at
 * all rather than announce something unverified.
 */
const REPO = process.env.DESKTOP_RELEASES_REPO ?? "Oppulence-Engineering/Desktop-Assistant";

export async function GET(): Promise<NextResponse> {
  const empty = NextResponse.json({ entries: [] });
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oppulence-www",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers,
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return empty;

    return NextResponse.json(
      { entries: parseReleases(await response.json()) },
      { headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" } },
    );
  } catch {
    return empty;
  }
}
