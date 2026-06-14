// Electron Forge config file
// NOTE: Must be .cjs (CommonJS) because package.json has "type": "module"
// Forge loads configs with require(), which fails on ESM files

const path = require("path");
const pkg = require("./package.json");

const PRODUCT_NAME = "Solomon AI";
const PRODUCT_SLUG = "solomon-ai";
const PRODUCT_ARTIFACT_NAME = "Solomon-AI";
const LEGACY_DEEP_LINK_SCHEME = "rowboat";
const appleSigningConfigured = Boolean(
  process.env.APPLE_ID?.trim() &&
  process.env.APPLE_PASSWORD?.trim() &&
  process.env.APPLE_TEAM_ID?.trim() &&
  process.env.APPLE_CERTIFICATE?.trim(),
);

const packagerConfig = {
  name: PRODUCT_NAME,
  executableName: PRODUCT_SLUG,
  icon: "./icons/icon", // .icns extension added automatically
  appBundleId: "co.solomon-ai.desktop",
  appCategoryType: "public.app-category.productivity",
  protocols: [{ name: PRODUCT_NAME, schemes: [PRODUCT_SLUG, LEGACY_DEEP_LINK_SCHEME] }],
  extendInfo: {
    NSMicrophoneUsageDescription: `${PRODUCT_NAME} needs microphone access to transcribe voice input and meeting audio.`,
    NSAudioCaptureUsageDescription: `${PRODUCT_NAME} needs access to system audio to transcribe meetings from other apps (Zoom, Meet, etc.)`,
  },
  // RFC 009: ship the signed per-arch whisper-cli outside the asar (executables
  // can't run from inside it). generateAssets always creates .package/whisper/
  // (staging the matching arch when present), so this path is always valid.
  extraResource: [path.join(__dirname, ".package", "whisper")],
  // Since we bundle everything with esbuild, we don't need node_modules at all.
  // These settings prevent Forge's dependency walker (flora-colossus) from trying
  // to analyze/copy node_modules, which fails with pnpm's symlinked workspaces.
  prune: false,
  ignore: [/src\//, /node_modules\//, /.gitignore/, /bundle\.mjs/, /tsconfig.json/],
};

if (appleSigningConfigured) {
  packagerConfig.osxSign = {
    batchCodesignCalls: true,
    optionsForFile: () => ({
      entitlements: path.join(__dirname, "entitlements.plist"),
      "entitlements-inherit": path.join(__dirname, "entitlements.plist"),
    }),
  };
  packagerConfig.osxNotarize = {
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  };
}

module.exports = {
  packagerConfig,
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: (arch) => ({
        format: "ULFO",
        title: PRODUCT_NAME,
        name: `${PRODUCT_ARTIFACT_NAME}-darwin-${arch}-${pkg.version}`, // Architecture-specific name to avoid conflicts
        volumeName: "Solomon AI", // short (<27 chars) — long names break the macOS DMG build
      }),
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: (arch) => ({
        authors: "Solomon AI",
        description: "AI coworker with memory",
        name: `${PRODUCT_ARTIFACT_NAME}-win32-${arch}`,
        setupExe: `${PRODUCT_ARTIFACT_NAME}-win32-${arch}-${pkg.version}-setup.exe`,
        setupIcon: path.join(__dirname, "icons/icon.ico"),
      }),
    },
    {
      name: "@electron-forge/maker-deb",
      config: (arch) => ({
        options: {
          name: `${PRODUCT_ARTIFACT_NAME}-linux`,
          bin: PRODUCT_SLUG,
          description: "AI coworker with memory",
          maintainer: "Solomon AI",
          homepage: "https://solomon-ai.co",
          icon: path.join(__dirname, "icons/icon.png"),
          mimeType: [
            `x-scheme-handler/${PRODUCT_SLUG}`,
            `x-scheme-handler/${LEGACY_DEEP_LINK_SCHEME}`,
          ],
        },
      }),
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: `${PRODUCT_ARTIFACT_NAME}-linux`,
          bin: PRODUCT_SLUG,
          description: "AI coworker with memory",
          homepage: "https://solomon-ai.co",
          icon: path.join(__dirname, "icons/icon.png"),
          mimeType: [
            `x-scheme-handler/${PRODUCT_SLUG}`,
            `x-scheme-handler/${LEGACY_DEEP_LINK_SCHEME}`,
          ],
        },
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platform: ["darwin", "win32", "linux"],
    },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "Oppulence-Engineering",
          name: "Desktop-Assistant",
        },
        // GitHub releases are published as stable (not pre-release).
        // This matches what release-please publishes; flipping back to `true`
        // would cause release churn and hide installers from the Latest tag.
        prerelease: false,
      },
    },
  ],
  hooks: {
    // Hook signature: (forgeConfig, platform, arch)
    // Note: Console output only shows if DEBUG or CI env vars are set
    generateAssets: async (forgeConfig, platform, arch) => {
      const { execSync } = require("child_process");
      const fs = require("fs");

      const packageDir = path.join(__dirname, ".package");
      const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      const copyDirectory = (src, dest) => {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true, force: true });
      };
      const waitForRendererBuild = (dir) => {
        const indexPath = path.join(dir, "index.html");
        const assetsPath = path.join(dir, "assets");
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (fs.existsSync(indexPath) && fs.existsSync(assetsPath)) {
            return;
          }
          sleepSync(100);
        }
        throw new Error(`renderer build output is incomplete at ${dir}`);
      };

      // Clean staging directory (ensures fresh build every time)
      console.log("Cleaning staging directory...");
      if (fs.existsSync(packageDir)) {
        fs.rmSync(packageDir, { recursive: true });
      }
      fs.mkdirSync(packageDir, { recursive: true });

      // Build order matters! Dependencies must be built before dependents:
      // shared → core → (renderer, preload, main)

      // Build shared (TypeScript compilation) - no dependencies
      console.log("Building shared...");
      execSync("pnpm run build", {
        cwd: path.join(__dirname, "../../packages/shared"),
        stdio: "inherit",
      });

      // Build core (TypeScript compilation) - depends on shared
      console.log("Building core...");
      execSync("pnpm run build", {
        cwd: path.join(__dirname, "../../packages/core"),
        stdio: "inherit",
      });

      // Build renderer (Vite build) - depends on shared
      console.log("Building renderer...");
      execSync("pnpm run build", {
        cwd: path.join(__dirname, "../renderer"),
        stdio: "inherit",
      });

      // Build preload (TypeScript compilation) - depends on shared
      console.log("Building preload...");
      execSync("pnpm run build", {
        cwd: path.join(__dirname, "../preload"),
        stdio: "inherit",
      });

      // Build main (TypeScript compilation) - depends on core, shared
      console.log("Building main (tsc)...");
      execSync("pnpm run build", {
        cwd: __dirname,
        stdio: "inherit",
      });

      // Bundle main process with esbuild (inlines all dependencies)
      console.log("Bundling main process...");
      execSync("node bundle.mjs", {
        cwd: __dirname,
        stdio: "inherit",
      });

      // Copy preload dist into staging directory
      console.log("Copying preload...");
      const preloadSrc = path.join(__dirname, "../preload/dist");
      const preloadDest = path.join(packageDir, "preload/dist");
      copyDirectory(preloadSrc, preloadDest);

      // Copy renderer dist into staging directory
      console.log("Copying renderer...");
      const rendererSrc = path.join(__dirname, "../renderer/dist");
      const rendererDest = path.join(packageDir, "renderer/dist");
      waitForRendererBuild(rendererSrc);
      copyDirectory(rendererSrc, rendererDest);
      waitForRendererBuild(rendererDest);

      // RFC 009: stage the per-arch whisper-cli (+ helper files) for extraResource.
      // The vendor binary is produced by the whisper-build CI workflow; when it's
      // absent (dev / non-built arch) we still create the dir so extraResource is
      // valid — the app then falls back to cloud transcription (bin.ts throws).
      const whisperSrc = path.join(
        __dirname,
        "..",
        "..",
        "vendor",
        "whisper",
        `${platform}-${arch}`,
      );
      const whisperDest = path.join(packageDir, "whisper");
      fs.mkdirSync(whisperDest, { recursive: true });
      if (fs.existsSync(whisperSrc)) {
        copyDirectory(whisperSrc, whisperDest);
        if (platform !== "win32") {
          const exe = path.join(whisperDest, "whisper-cli");
          if (fs.existsSync(exe)) fs.chmodSync(exe, 0o755);
        }
        console.log(`✅ Staged whisper-cli for ${platform}-${arch}`);
      } else {
        console.warn(
          `[whisper] no binary for ${platform}-${arch} at ${whisperSrc} — shipping without local transcription`,
        );
      }

      console.log("✅ All assets staged in .package/");
    },
  },
};
