import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";

import { parseReleases, type GitHubRelease } from "@/lib/api/changelog/changelog";
import { DESKTOP_RELEASES_REPO, fetchGitHubReleases } from "@/lib/api/github/releases";

import { MarketingBreadcrumbs } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const instant = false;

export const metadata = marketingMetadata({
  title: "Changelog",
  description:
    "Desktop release notes from GitHub Releases. Only published, non-prerelease builds are listed.",
  path: "/changelog",
});

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

export default async function ChangelogPage() {
  const releases = await fetchGitHubReleases<GitHubRelease>(DESKTOP_RELEASES_REPO, { perPage: 20 });
  const entries = releases ? parseReleases(releases, 20) : [];

  return (
    <article className="mk-capability linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Changelog" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[changelog]</p>
            <h1 className="linear-subpage-title mt-4">What shipped in the desktop app.</h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              These notes come from GitHub Releases for {DESKTOP_RELEASES_REPO}. Drafts and
              pre-releases are omitted. If the list is empty, the upstream call did not return
              published notes — we will not invent a version.
            </p>
          </div>
        </header>

        {entries.length === 0 ? (
          <p className="linear-body">
            No published releases are available to show right now. You can still{" "}
            <Link href="/download">download the latest installer</Link> when GitHub has one.
          </p>
        ) : (
          <ol className="mk-changelog">
            {entries.map((entry) => (
              <li key={entry.version}>
                <p>
                  <Badge className="rounded-none font-mono" variant="outline">
                    {entry.version}
                  </Badge>
                  {entry.date ? <time dateTime={entry.date}>{formatDate(entry.date)}</time> : null}
                </p>
                <h2>{entry.title}</h2>
                <p>{entry.body}</p>
                {entry.url ? (
                  <a href={entry.url} rel="noopener noreferrer" target="_blank">
                    Open the GitHub release
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}
