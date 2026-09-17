import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_RELEASES_REPO,
  fetchGitHubReleases,
  githubApiHeaders,
  latestReleasesPageURL,
} from "@/lib/api/github/releases";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("github releases client", () => {
  it("builds GitHub REST headers with optional auth", () => {
    expect(githubApiHeaders()).toMatchObject({
      Accept: "application/vnd.github+json",
      "User-Agent": "oppulence-www",
    });
    expect(githubApiHeaders().Authorization).toBeUndefined();

    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    expect(githubApiHeaders().Authorization).toBe("Bearer ghp_test");
  });

  it("returns null when GitHub responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );

    await expect(fetchGitHubReleases(DESKTOP_RELEASES_REPO)).resolves.toBeNull();
  });

  it("returns parsed release payloads on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ draft: false, tag_name: "v0.1.31" }]), { status: 200 }),
        ),
      ),
    );

    await expect(fetchGitHubReleases(DESKTOP_RELEASES_REPO)).resolves.toEqual([
      { draft: false, tag_name: "v0.1.31" },
    ]);
  });

  it("builds the public releases fallback URL", () => {
    expect(latestReleasesPageURL(DESKTOP_RELEASES_REPO)).toBe(
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/latest",
    );
  });
});
