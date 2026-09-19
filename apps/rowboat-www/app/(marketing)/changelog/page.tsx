import { cacheLife } from "next/cache";

import { parseReleases, type GitHubRelease } from "@/lib/api/changelog/changelog";
import { DESKTOP_RELEASES_REPO, fetchGitHubReleases } from "@/lib/api/github/releases";

import { SimChangelogPage } from "../sim-landing/subpages/sim-changelog-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Changelog",
  description:
    "Desktop release notes from GitHub Releases. Only published, non-prerelease builds are listed.",
  path: "/changelog",
});

async function loadPublishedReleases() {
  "use cache";
  cacheLife("hours");
  const releases = await fetchGitHubReleases<GitHubRelease>(DESKTOP_RELEASES_REPO, { perPage: 20 });
  return releases ? parseReleases(releases, 20) : [];
}

export default async function ChangelogPage() {
  const entries = await loadPublishedReleases();

  return (
    <SimChangelogPage
      entries={entries.map((entry) => ({
        version: entry.version,
        date: entry.date,
        title: entry.title,
        body: entry.body,
        url: entry.url,
      }))}
      repoLabel={DESKTOP_RELEASES_REPO}
    />
  );
}
