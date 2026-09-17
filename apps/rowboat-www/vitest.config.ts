import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // The monorepo can contain independently-installed workspace packages.
    // Pin React to this app's installation so tests never load two dispatchers.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": root,
      "client-only": path.join(root, "quality/test-support/client-only.ts"),
      react: path.join(root, "node_modules/react"),
      "react-dom": path.join(root, "node_modules/react-dom"),
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
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
    },
  },
});
