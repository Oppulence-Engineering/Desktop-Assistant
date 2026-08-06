import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A dev build on macOS must not claim the deep-link schemes.
 *
 * `setAsDefaultProtocolClient`'s `path` and `args` are Windows-only. macOS
 * ignores them and registers whichever app bundle is running — in dev, the bare
 * Electron.app inside node_modules. That claim is written to LaunchServices,
 * outlives the dev process, and takes the scheme from the user's installed app.
 *
 * What that looks like in practice: an OAuth reconnect deep-links back to
 * `rowboat://oauth/google/done`, macOS routes it to Electron.app, and the user
 * gets Electron's welcome window instead of a completed connection — on a
 * machine where someone ran `npm run dev` once, possibly weeks earlier, with
 * nothing on screen connecting the two.
 *
 * Asserted against the source because the alternative is launching Electron and
 * mutating the developer's real LaunchServices database — the exact side effect
 * this guards against.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, "../apps/main/src/main.ts"), "utf8");

test("guards protocol registration against unpackaged macOS builds", () => {
  assert.match(
    mainSource,
    /process\.defaultApp\s*&&\s*process\.platform === "darwin"/,
    "main.ts must detect a dev build on macOS before registering schemes",
  );
});

test("every setAsDefaultProtocolClient call sits inside that guard", () => {
  const guardStart = mainSource.indexOf('const devOnMac = process.defaultApp');
  assert.ok(guardStart > -1, "the devOnMac guard should exist");

  // The guarded block runs from the guard to the else that logs the skip.
  const elseBranch = mainSource.indexOf('"[Main] Dev build on macOS', guardStart);
  assert.ok(elseBranch > guardStart, "the skip branch should follow the guard");

  const calls = [...mainSource.matchAll(/setAsDefaultProtocolClient\(/g)].map((m) => m.index ?? -1);
  assert.ok(calls.length > 0, "there should be registration calls to guard");
  for (const at of calls) {
    assert.ok(
      at > guardStart && at < elseBranch,
      `setAsDefaultProtocolClient at ${at} must be inside the devOnMac guard`,
    );
  }
});

test("keeps dev registration on Windows and Linux, where path and args work", () => {
  // The guard is macOS-specific on purpose: elsewhere the OS honours execPath
  // and argv, so a dev build re-invokes itself correctly instead of hijacking.
  assert.match(mainSource, /app\.setAsDefaultProtocolClient\(scheme, process\.execPath/);
});
