/**
 * Reads the product changelog out of GitHub releases.
 *
 * release-please generates both `apps/x/CHANGELOG.md` and the GitHub release
 * from the same conventional commits, but only the release is reachable at
 * runtime: the rowboat-www container is built from `apps/rowboat-www` and the
 * two shared packages, so the changelog file is not in the build context.
 */

import { z } from "zod";

export type GitHubRelease = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string;
};

const ChangelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
});

const ChangelogResponseSchema = z.object({
  entries: ChangelogEntrySchema.array().default([]),
});

export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

const BULLET = /^\s*[*-]\s+(.*)$/;
const HEADING = /^#{2,4}\s+(.+?)\s*$/;
// release-please ends every bullet with a commit or issue link.
const TRAILING_LINK = /\s*\(\[(?:#\d+|[0-9a-f]{6,})\]\([^)]*\)\)\s*$/i;
const SCOPE = /^\*\*(.+?):\*\*\s*/;
const TITLE_LIMIT = 72;

function cleanBullet(line: string) {
  let text = line.trim();
  // A bullet can carry both an issue link and a commit link.
  while (TRAILING_LINK.test(text)) text = text.replace(TRAILING_LINK, "");
  return text.replace(SCOPE, "").trim();
}

/** Groups the bullets of a release body under their lower-cased headings. */
function sections(body: string): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  let current = "";
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(HEADING);
    if (heading) {
      current = heading[1].toLowerCase();
      continue;
    }
    const bullet = line.match(BULLET);
    if (!bullet || !current) continue;
    const text = cleanBullet(bullet[1]);
    if (text) (groups[current] ??= []).push(text);
  }
  return groups;
}

function sentence(text: string) {
  if (!text) return "";
  const capitalized = text[0].toUpperCase() + text.slice(1);
  if (capitalized.length <= TITLE_LIMIT) return capitalized;
  const cut = capitalized.slice(0, TITLE_LIMIT);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function countLabel(features: number, fixes: number) {
  const parts: string[] = [];
  if (features) parts.push(`${String(features)} ${features === 1 ? "feature" : "features"}`);
  if (fixes) parts.push(`${String(fixes)} ${fixes === 1 ? "fix" : "fixes"}`);
  return parts.length ? `${parts.join(" and ")} in this release.` : "Read the release notes.";
}

/**
 * Turns GitHub releases into changelog cards, newest first. A draft or
 * pre-release is not shipped product, so neither is announced. A release whose
 * notes carry no bullet at all is dropped rather than shown with an empty line.
 */
export function parseReleases(releases: GitHubRelease[], limit = 3): ChangelogEntry[] {
  return releases
    .filter((release) => !release.draft && !release.prerelease && release.tag_name)
    .slice(0, limit)
    .map((release) => {
      const groups = sections(release.body ?? "");
      const features = groups["features"] ?? [];
      const fixes = groups["bug fixes"] ?? [];
      return {
        version: release.tag_name as string,
        date: release.published_at ?? "",
        title: sentence(features.length > 0 ? features[0] : fixes.length > 0 ? fixes[0] : ""),
        body: countLabel(features.length, fixes.length),
        url: release.html_url ?? "",
      };
    })
    .filter((entry) => Boolean(entry.title && entry.url));
}

/**
 * Reads the parsed releases from this app's own route. The GitHub call, its
 * token and its cache all stay on the server.
 */
export async function loadChangelog(signal?: AbortSignal): Promise<ChangelogEntry[]> {
  const response = await fetch("/api/changelog", {
    signal: signal ?? AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];
  const parsed = ChangelogResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.entries : [];
}
