import { describe, expect, it, vi, afterEach } from "vitest";

import { GET } from "@/app/api/download/route";
import { findInstallerURL } from "@/lib/api/download/resolver";

/**
 * The two desktop apps ship from different repositories with different
 * packagers, so the resolver has to keep them apart. Sending a Voice visitor
 * the Desktop installer (or the reverse) is the failure that matters here.
 */

type Asset = { name: string; browser_download_url: string };

const DESKTOP_ASSETS: Asset[] = [
  {
    name: "Oppulence-darwin-arm64-0.1.31.dmg",
    browser_download_url:
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-arm64-0.1.31.dmg",
  },
  {
    name: "Oppulence-darwin-x64-0.1.31.dmg",
    browser_download_url:
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-x64-0.1.31.dmg",
  },
  {
    name: "oppulence_0.1.31_amd64.deb",
    browser_download_url:
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/oppulence_0.1.31_amd64.deb",
  },
];

// electron-builder names the Intel mac build with no arch suffix, which is the
// case most likely to be mismatched against the arm64 build.
const VOICE_ASSETS: Asset[] = [
  {
    name: "OpenWhispr-1.9.0-arm64.dmg",
    browser_download_url:
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0-arm64.dmg",
  },
  {
    name: "OpenWhispr-1.9.0.dmg",
    browser_download_url:
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0.dmg",
  },
  {
    name: "OpenWhispr-1.9.0-linux-amd64.deb",
    browser_download_url:
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0-linux-amd64.deb",
  },
];

function mockReleases() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const assets = url.includes("openwhispr") ? VOICE_ASSETS : DESKTOP_ASSETS;
      return Promise.resolve(
        new Response(JSON.stringify([{ draft: false, prerelease: false, assets }]), {
          status: 200,
        }),
      );
    }),
  );
}

async function resolve(query: string): Promise<string | null> {
  const request = new Request(`https://oppulence.io/api/download${query}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  });
  // The route only reads the URL and headers, so a plain Request is enough.
  const response = await GET(request as never);
  return response.headers.get("location");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("download resolver", () => {
  it("sends Voice visitors to the Voice build, not the desktop app", async () => {
    mockReleases();

    expect(await resolve("?app=voice&platform=mac-arm64")).toBe(
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0-arm64.dmg",
    );
    expect(await resolve("?app=voice&platform=linux-deb-x64")).toBe(
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0-linux-amd64.deb",
    );
  });

  it("tells the two mac builds apart despite the missing arch suffix", async () => {
    mockReleases();

    expect(await resolve("?app=voice&platform=mac-x64")).toBe(
      "https://github.com/PlaybookMediaLLC/openwhispr/releases/download/v1.9.0/OpenWhispr-1.9.0.dmg",
    );
  });

  it("still defaults to the desktop app when no app is named", async () => {
    mockReleases();

    expect(await resolve("?platform=mac-arm64")).toBe(
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-arm64-0.1.31.dmg",
    );
    expect(await resolve("?app=desktop&platform=mac-x64")).toBe(
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-x64-0.1.31.dmg",
    );
  });

  it("falls back to that app's releases page rather than erroring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );

    expect(await resolve("?app=voice&platform=mac-arm64")).toContain(
      "PlaybookMediaLLC/openwhispr/releases",
    );
    expect(await resolve("?platform=mac-arm64")).toContain(
      "Oppulence-Engineering/Desktop-Assistant/releases",
    );
  });

  it("falls back when the release has no asset for that platform", async () => {
    // Voice publishes no Windows build today; the visitor should still land on
    // the releases page instead of being handed a mac DMG.
    mockReleases();

    expect(await resolve("?app=voice&platform=windows-x64")).toContain(
      "PlaybookMediaLLC/openwhispr/releases",
    );
  });

  it("skips prerelease builds and untrusted download hosts", () => {
    const app = {
      repo: "Oppulence-Engineering/Desktop-Assistant",
      matchers: {
        "mac-arm64": /darwin-arm64.*\.dmg$/i,
        "mac-x64": /darwin-x64.*\.dmg$/i,
        "windows-x64": /win32-x64.*setup\.exe$/i,
        "linux-deb-x64": /_amd64\.deb$/i,
        "linux-deb-arm64": /_arm64\.deb$/i,
        "linux-rpm-x64": /x86_64\.rpm$/i,
        "linux-rpm-arm64": /\.arm64\.rpm$/i,
      },
    } as const;

    expect(
      findInstallerURL(
        [
          {
            draft: false,
            prerelease: true,
            assets: [
              {
                name: "Oppulence-darwin-arm64-0.2.0.dmg",
                browser_download_url: "https://github.com/evil.example/pwn.dmg",
              },
            ],
          },
          {
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "Oppulence-darwin-arm64-0.1.31.dmg",
                browser_download_url:
                  "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-arm64-0.1.31.dmg",
              },
            ],
          },
        ],
        "mac-arm64",
        app,
      ),
    ).toBe(
      "https://github.com/Oppulence-Engineering/Desktop-Assistant/releases/download/v0.1.31/Oppulence-darwin-arm64-0.1.31.dmg",
    );
  });
});
