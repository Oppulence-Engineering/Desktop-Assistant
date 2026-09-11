import { describe, expect, it } from "vitest";

import { parseReleases, type GitHubRelease } from "@/lib/api/changelog/changelog";

// A verbatim release-please body: a compare-link heading, scoped bullets, and
// both issue and commit links on the same line.
const BODY = `## [0.1.32](https://github.com/o/r/compare/v0.1.31...v0.1.32) (2026-09-09)


### Features

* **www:** rebuild the public site, auth, and legal pages ([#254](https://github.com/o/r/issues/254)) ([a5e5314](https://github.com/o/r/commit/a5e5314))
* harden platform and add Oppulence Voice cloud service ([cbcb60c](https://github.com/o/r/commit/cbcb60c))

### Bug Fixes

* **api:** quote the sentence, not the link ([0a8b9f7](https://github.com/o/r/commit/0a8b9f7))

---
This PR was generated with Release Please.
`;

const release = (over: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: "v0.1.32",
  body: BODY,
  draft: false,
  prerelease: false,
  published_at: "2026-09-09T12:50:46Z",
  html_url: "https://github.com/o/r/releases/tag/v0.1.32",
  ...over,
});

describe("changelog entries", () => {
  it("headlines the first feature with its scope and links stripped", () => {
    expect(parseReleases([release()])[0]).toEqual({
      version: "v0.1.32",
      date: "2026-09-09T12:50:46Z",
      title: "Rebuild the public site, auth, and legal pages",
      body: "2 features and 1 fix in this release.",
      url: "https://github.com/o/r/releases/tag/v0.1.32",
    });
  });

  it("never announces a draft or a pre-release", () => {
    expect(parseReleases([release({ draft: true }), release({ prerelease: true })])).toEqual([]);
  });

  it("drops a release whose notes carry no bullet", () => {
    expect(parseReleases([release({ body: "Nothing to see here." })])).toEqual([]);
  });

  it("falls back to a fix when the release shipped no feature", () => {
    const fixesOnly = release({ body: "### Bug Fixes\n\n* stop dropping the bounce signal\n" });
    expect(parseReleases([fixesOnly])[0]).toMatchObject({
      title: "Stop dropping the bounce signal",
      body: "1 fix in this release.",
    });
  });

  it("returns at most three, newest first", () => {
    const many = ["v3", "v2", "v1", "v0"].map((tag) => release({ tag_name: tag }));
    expect(parseReleases(many).map((entry) => entry.version)).toEqual(["v3", "v2", "v1"]);
  });
});
