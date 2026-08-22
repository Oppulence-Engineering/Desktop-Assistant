import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appDir = path.join(repoRoot, "apps/x/apps/main");
const requireFromApp = createRequire(path.join(appDir, "package.json"));

const packager = requireFromApp("@electron/packager");
const forgeConfig = requireFromApp("./forge.config.cjs");
const fusePolicy = requireFromApp("./fuse-policy.cjs");
const { flipFuses } = requireFromApp("@electron/fuses");

const platform = process.env.SMOKE_PACKAGE_PLATFORM ?? "linux";
const arch = process.env.SMOKE_PACKAGE_ARCH ?? "x64";
const packagerConfig = forgeConfig.packagerConfig ?? {};
const executableName = packagerConfig.executableName ?? "solomon-ai";
const appName = packagerConfig.name ?? "Solomon AI";

process.chdir(appDir);

if (forgeConfig.hooks?.generateAssets) {
  await forgeConfig.hooks.generateAssets(forgeConfig, platform, arch);
}

// Spread the real packagerConfig rather than re-listing the fields we think
// matter. The hand-picked list silently omitted `extraResource`, so every app
// packaged by this script shipped without whisper-cli, the audiocap helper and
// the embedding model — the three things staged immediately above it. The
// whisper spec had been failing on all three platforms for weeks with
// "staging failed", while staging was in fact succeeding and this was dropping
// the result; the audiocap spec skipped for the same reason.
//
// Signing is the one thing deliberately not inherited: this script exists to
// produce an unsigned build for e2e, and the runner has no APPLE_* secrets.
const { osxSign: _osxSign, osxNotarize: _osxNotarize, ...sharedPackagerConfig } = packagerConfig;

const outputPaths = await packager({
  ...sharedPackagerConfig,
  dir: appDir,
  name: appName,
  platform,
  arch,
  out: path.join(appDir, "out"),
  overwrite: true,
  executableName,
});

for (const outputPath of outputPaths) {
  console.log(`Packaged app: ${path.relative(repoRoot, outputPath)}`);
}

if (outputPaths.length === 0) {
  throw new Error("Packager did not return any output paths");
}

const binaryPath =
  platform === "darwin"
    ? path.join(outputPaths[0], `${appName}.app`, "Contents", "MacOS", executableName)
    : path.join(outputPaths[0], platform === "win32" ? `${executableName}.exe` : executableName);

await access(binaryPath);
await flipFuses(binaryPath, fusePolicy);
console.log(`Packaged smoke binary: ${path.relative(repoRoot, binaryPath)}`);
