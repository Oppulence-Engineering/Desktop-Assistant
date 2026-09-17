import { NextResponse } from "next/server";

import { ChangelogResponseSchema, parseReleases } from "@/lib/api/changelog/changelog";
import { DESKTOP_RELEASES_REPO, fetchGitHubReleases } from "@/lib/api/github/releases";

/**
 * The latest releases, for the sidebar changelog card.
 *
 * Same source and same headers as the download resolver: GitHub releases, a
 * token only for rate-limit headroom. An upstream miss returns an empty list,
 * because a sidebar card that cannot name a real release must not appear at
 * all rather than announce something unverified.
 */
export async function GET(): Promise<NextResponse> {
  const empty = ChangelogResponseSchema.parse({ entries: [] });
  const releases = await fetchGitHubReleases(DESKTOP_RELEASES_REPO, { perPage: 10 });
  if (!releases) {
    return NextResponse.json(empty, {
      headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" },
    });
  }

  const payload = ChangelogResponseSchema.parse({ entries: parseReleases(releases) });
  return NextResponse.json(payload, {
    headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" },
  });
}
