import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/postcss";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, "package.json"));

export default defineConfig({
  // Vite cannot resolve PostCSS plugins named as strings. Next can, and
  // importing the plugin from postcss.config.mjs makes Turbopack evaluate
  // lightningcss through its HMR runtime (`Cannot find module 'unknown'`).
  css: {
    postcss: {
      plugins: [tailwindcss],
    },
  },
  plugins: [
    {
      name: "resolve-ui-workspace-deps",
      resolveId(id, importer) {
        if (!importer?.includes(`${path.sep}packages${path.sep}ui${path.sep}`)) {
          return undefined;
        }
        if (id.startsWith(".") || id.startsWith("#") || path.isAbsolute(id)) {
          return undefined;
        }
        try {
          return require.resolve(id);
        } catch {
          return undefined;
        }
      },
    },
  ],
  resolve: {
    // The monorepo can contain independently-installed workspace packages.
    // Pin React to this app's installation so tests never load two dispatchers.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": root,
      "client-only": path.join(root, "quality/test-support/client-only.ts"),
      "next/navigation": path.join(root, "quality/test-support/next-navigation.ts"),
      react: path.join(root, "node_modules/react"),
      "react/jsx-runtime": path.join(root, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(root, "node_modules/react/jsx-dev-runtime.js"),
      "react-dom": path.join(root, "node_modules/react-dom"),
      "radix-ui": path.join(root, "node_modules/radix-ui"),
      "class-variance-authority": path.join(root, "node_modules/class-variance-authority"),
      "react-day-picker": path.join(root, "node_modules/react-day-picker"),
      "date-fns": path.join(root, "node_modules/date-fns"),
      sonner: path.join(root, "node_modules/sonner"),
      "next-themes": path.join(root, "node_modules/next-themes"),
      "@phosphor-icons/react": path.join(root, "node_modules/@phosphor-icons/react"),
      clsx: path.join(root, "node_modules/clsx"),
      "tailwind-merge": path.join(root, "node_modules/tailwind-merge"),
      "server-only": path.join(root, "quality/test-support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        // Workspace packages may have their own install tree locally. Inline
        // dependencies so every component test resolves this app's React.
        inline: true,
      },
    },
    setupFiles: [path.join(root, "quality/test-support/vitest.setup.ts")],
    include: [
      "quality/**/*.test.{ts,tsx}",
      "components/features/**/*.test.tsx",
      "app/**/_components/**/*.test.tsx",
      "hooks/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
    },
  },
});
