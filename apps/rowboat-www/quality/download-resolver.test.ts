import { describe, expect, it, vi, afterEach } from "vitest";

import { GET } from "@/app/api/download/route";

/**
 * The two desktop apps ship from different repositories with different
 * packagers, so the resolver has to keep them apart. Sending a Voice visitor
 * the Desktop installer (or the reverse) is the failure that matters here.
 */

type Asset = { name: string; browser_download_url: string };

const DESKTOP_ASSETS: Asset[] = [
  {
    name: "Oppulence-darwin-arm64-0.1.31.dmg",
    browser_download_url: "https://example.test/desktop-arm64.dmg",
  },
  {
    name: "Oppulence-darwin-x64-0.1.31.dmg",
    browser_download_url: "https://example.test/desktop-x64.dmg",
  },
  { name: "oppulence_0.1.31_amd64.deb", browser_download_url: "https://example.test/desktop.deb" },
];

// electron-builder names the Intel mac build with no arch suffix, which is the
// case most likely to be mismatched against the arm64 build.
const VOICE_ASSETS: Asset[] = [
  {
    name: "OpenWhispr-1.9.0-arm64.dmg",
    browser_download_url: "https://example.test/voice-arm64.dmg",
  },
  { name: "OpenWhispr-1.9.0.dmg", browser_download_url: "https://example.test/voice-x64.dmg" },
  {
    name: "OpenWhispr-1.9.0-linux-amd64.deb",
    browser_download_url: "https://example.test/voice.deb",
  },
];

function mockReleases() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const assets = url.includes("openwhispr") ? VOICE_ASSETS : DESKTOP_ASSETS;
      return Promise.resolve(
        new Response(JSON.stringify([{ draft: false, assets }]), { status: 200 }),
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
      "https://example.test/voice-arm64.dmg",
    );
    expect(await resolve("?app=voice&platform=linux-deb-x64")).toBe(
      "https://example.test/voice.deb",
    );
  });

  it("tells the two mac builds apart despite the missing arch suffix", async () => {
    mockReleases();

    expect(await resolve("?app=voice&platform=mac-x64")).toBe("https://example.test/voice-x64.dmg");
  });

  it("still defaults to the desktop app when no app is named", async () => {
    mockReleases();

    expect(await resolve("?platform=mac-arm64")).toBe("https://example.test/desktop-arm64.dmg");
    expect(await resolve("?app=desktop&platform=mac-x64")).toBe(
      "https://example.test/desktop-x64.dmg",
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
});
