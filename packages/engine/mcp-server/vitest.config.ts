import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Raised from vitest's 5000ms default. A handful of heavyweight tests —
    // schema-mirror drift guards, disk round-trips, repo-wide file scans — pass
    // in well under a second alone but land at 5.1-7.2s under full-suite
    // parallel load, so they tipped over the default at random and failed
    // roughly one run in three. That reads as a real regression to whoever sees
    // it, which is worse than the seconds it costs to be sure. Diagnosed from
    // four such failures, all between 5154ms and 7194ms.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
