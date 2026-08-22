import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "client-only": path.join(root, "quality/test-support/client-only.ts"),
      "server-only": path.join(root, "quality/test-support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
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
