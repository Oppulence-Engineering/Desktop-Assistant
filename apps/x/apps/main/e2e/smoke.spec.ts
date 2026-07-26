import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the packaged Electron binary. Prefer the explicit `ELECTRON_APP_BINARY`
 * (set by CI), otherwise probe the Forge `out/` directory for the current
 * platform/arch. Product name "Oppulence", executable slug "oppulence".
 */
function resolveBinary(): string {
  const override = process.env.ELECTRON_APP_BINARY;
  if (override && existsSync(override)) return override;

  const outDir = path.resolve(here, "..", "out");
  const candidates = [
    "Oppulence-linux-x64/oppulence",
    "Oppulence-linux-arm64/oppulence",
    "Oppulence-win32-x64/oppulence.exe",
    "Oppulence-win32-arm64/oppulence.exe",
    "Oppulence-darwin-x64/Oppulence.app/Contents/MacOS/oppulence",
    "Oppulence-darwin-arm64/Oppulence.app/Contents/MacOS/oppulence",
  ].map((rel) => path.join(outDir, rel));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Packaged binary not found. Run \`npm run package\` first, or set ELECTRON_APP_BINARY. Looked under ${outDir}`,
    );
  }
  return found;
}

let app: ElectronApplication;

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test("packaged app boots, opens a window, and mounts the renderer", async () => {
  // Isolate state so the smoke run never touches a real user workspace.
  const workdir = mkdtempSync(path.join(tmpdir(), "rowboat-e2e-"));

  app = await electron.launch({
    executablePath: resolveBinary(),
    args: ["--no-sandbox"],
    env: { ...process.env, ROWBOAT_WORKDIR: workdir, NODE_ENV: "production" },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // The window has a real title (not a blank/error window).
  expect((await window.title()).trim().length).toBeGreaterThan(0);

  // React mounted *something* into #root — the app shell, onboarding, or the
  // sign-in surface. This catches white-screen / renderer-crash regressions
  // that the old "process still alive after 5s" smoke could not.
  await expect
    .poll(() => window.evaluate(() => document.getElementById("root")?.childElementCount ?? 0), {
      timeout: 45_000,
      message: "renderer never mounted content into #root",
    })
    .toBeGreaterThan(0);

  // No uncaught renderer error surfaced to the user.
  const bodyText = await window.locator("body").innerText();
  expect(bodyText).not.toMatch(/application error|a problem occurred|white screen/i);
});
