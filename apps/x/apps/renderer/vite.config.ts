import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

type ViteAlias = { find: string | RegExp; replacement: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const uiSrc = path.join(repoRoot, "packages/ui/src");
const workspaceModules = path.resolve(__dirname, "../../node_modules");

/**
 * @oppulence/ui uses package.json "imports" (#lib, #components, #hooks). Vite does not
 * apply that map when bundling from the pnpm store symlink, so pin internal paths here.
 * Runtime deps (sonner, radix-ui, …) stay on pnpm's nested node_modules for the package.
 */
function uiInternalImportAliases(): ViteAlias[] {
  return [
    { find: /^#lib\/icons$/, replacement: path.join(uiSrc, "lib/icons.tsx") },
    { find: /^#lib\/(.*)$/, replacement: path.join(uiSrc, "lib/$1") },
    { find: /^#components\/(.*)$/, replacement: path.join(uiSrc, "components/$1.tsx") },
    { find: /^#hooks\/(.*)$/, replacement: path.join(uiSrc, "hooks/$1.ts") },
  ];
}

// https://vite.dev/config/
export default defineConfig({
  base: "./", // Use relative paths for assets (required for Electron custom protocol)
  plugins: [react(), tailwindcss()],
  resolve: {
    // packages/ui is compiled from source. Pin React to the desktop workspace
    // copy so peer imports resolve in CI, where the UI package has no nested React.
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: /^react$/, replacement: path.join(workspaceModules, "react") },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.join(workspaceModules, "react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.join(workspaceModules, "react/jsx-dev-runtime.js"),
      },
      { find: /^react-dom$/, replacement: path.join(workspaceModules, "react-dom") },
      ...uiInternalImportAliases(),
    ],
  },
  server: {
    fs: {
      // Electron imports the authenticated web console's canonical product
      // theme directly so both surfaces remain visually locked together.
      allow: [path.resolve(__dirname, "../../../..")],
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      // A second entry for the always-on-top recording indicator. It is a separate
      // document rather than a route because it loads in its own BrowserWindow, and
      // pulling the 4 MB app bundle into a 264-pixel pill would be absurd.
      input: {
        main: path.resolve(__dirname, "index.html"),
        indicator: path.resolve(__dirname, "indicator.html"),
        dictation: path.resolve(__dirname, "dictation.html"),
      },
    },
  },
});
