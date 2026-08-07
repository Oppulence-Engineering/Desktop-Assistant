/**
 * Bundles the compiled main process into a single JavaScript file.
 *
 * Why we bundle:
 * - pnpm uses symlinks for workspace packages (@x/core, @x/shared)
 * - Electron Forge's dependency walker (flora-colossus) cannot follow these symlinks
 * - Bundling inlines all dependencies into a single file, eliminating node_modules
 *
 * This script is called by the generateAssets hook in forge.config.js before packaging.
 */

import * as esbuild from "esbuild";
import { readFile } from "node:fs/promises";

// In CommonJS, import.meta.url doesn't exist. We need to polyfill it.
// The banner defines __import_meta_url at the top of the bundle,
// and we use define to replace all import.meta.url references with it.
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const productionApiUrl = new URL("https://api.oppulence.io");

function bundleContainsUrlLiteral(bundle, expectedUrl) {
  for (const match of bundle.matchAll(/["'`](https?:\/\/[^"'`\\]+)["'`]/g)) {
    try {
      const candidate = new URL(match[1]);
      if (
        candidate.protocol === expectedUrl.protocol &&
        candidate.hostname === expectedUrl.hostname &&
        candidate.pathname === expectedUrl.pathname
      ) {
        return true;
      }
    } catch {
      // Ignore non-URL string literals matched by the broad scan.
    }
  }

  return false;
}

await esbuild.build({
  entryPoints: ["./dist/main.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "./.package/dist/main.cjs",
  // "electron" is provided by the runtime. "onnxruntime-node" is a native
  // binding (.node + a ~35MB dylib) that esbuild cannot inline at all — it is
  // staged into .package/node_modules by forge.config.cjs, where plain Node
  // resolution from .package/dist/main.cjs finds it.
  external: ["electron", "onnxruntime-node"],
  // Use CommonJS format - many dependencies use require() which doesn't work
  // well with esbuild's ESM shim. CJS handles dynamic requires natively.
  format: "cjs",
  // Inject the polyfill variable at the top
  banner: { js: cjsBanner },
  // Replace import.meta.url directly with our polyfill variable
  define: {
    "import.meta.url": "__import_meta_url",
    // Inject PostHog credentials at build time. Reuse the renderer's
    // VITE_PUBLIC_* envs so packaging only needs one set of values.
    // Empty strings disable analytics gracefully.
    "process.env.POSTHOG_KEY": JSON.stringify(process.env.VITE_PUBLIC_POSTHOG_KEY ?? ""),
    "process.env.POSTHOG_HOST": JSON.stringify(
      process.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    ),
    "process.env.ROWBOAT_APP_VERSION": JSON.stringify(pkg.version ?? ""),
  },
});

const mainBundle = await readFile("./.package/dist/main.cjs", "utf8");
if (!bundleContainsUrlLiteral(mainBundle, productionApiUrl)) {
  throw new Error("Packaged main bundle is missing the production API URL.");
}
if (
  /API_URL\s*=\s*process\.env\.API_URL\s*\|\|\s*["']https:\/\/api\.x\.solomon-ai\.co["']/.test(
    mainBundle,
  )
) {
  throw new Error("Packaged main bundle still defaults to the retired Solomon API URL.");
}

await esbuild.build({
  entryPoints: ["./dist/whisper-utility.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "./.package/dist/whisper-utility.cjs",
  format: "cjs",
  banner: { js: cjsBanner },
  define: {
    "import.meta.url": "__import_meta_url",
  },
});

console.log("✅ Main process bundled to .package/dist/main.cjs");
console.log("✅ Whisper utility bundled to .package/dist/whisper-utility.cjs");
