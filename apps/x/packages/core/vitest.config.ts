import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    // Most of this suite imports modules that build the DI container and the
    // agent runtime — around three seconds of module graph per file before the
    // first assertion. Vitest runs files in parallel, so on a loaded machine
    // (CI, or a laptop doing anything else) that routinely pushed past the 5s
    // default in files that are not slow themselves.
    //
    // The failures were the worst kind: a different handful each run, reported
    // as timeouts, which reads as a hang in whatever the file happens to
    // cover rather than as contention. 30s is still a real bound — a genuine
    // hang is caught, just not a busy CPU.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
