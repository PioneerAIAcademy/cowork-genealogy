import { defineConfig } from "vitest/config";

// `PROTO_STORE=pg` (U15, `make engine-test-pg`): the same suite with every
// tool's project I/O on PgS3ProjectStore, and a skipped test is a failure.
const PG = process.env.PROTO_STORE === "pg";

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
    ...(PG
      ? {
          setupFiles: ["tests/setup/proto-store.ts"],
          globalSetup: ["tests/setup/proto-store-global.ts"],
          reporters: ["default", "./tests/setup/proto-store-reporter.ts"],
        }
      : {}),
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // The stdio entrypoint connects a transport at import; no test loads it.
      // tests/http/http-entrypoint.test.ts loads http.ts with its listener mocked,
      // for the process store it installs and nothing else, so it stays excluded too.
      exclude: ["src/index.ts", "src/http.ts"],
    },
  },
});
