import { describe, it, expect } from "vitest";
import { configFromEnv, PER_USER_ENV } from "../../src/hosted-config-env.js";

// Both prototype entrypoints build their AppConfig through this, so what it does with an
// absent or empty variable decides whether a container silently loses a per-user value.

describe("configFromEnv", () => {
  it("layers the four set variables over the base", () => {
    const config = configFromEnv({
      WIKI_API_URL: "http://wiki:8000",
      POP_STATS_URL: "http://pop:9000",
      OPENROUTER_API_KEY: "or-key",
      OPENROUTER_MODEL: "a/model",
    });
    expect(config).toEqual({
      wikiApiUrl: "http://wiki:8000",
      popStatsUrl: "http://pop:9000",
      openRouterApiKey: "or-key",
      openRouterModel: "a/model",
    });
  });

  it("leaves the base's value where a variable is absent or empty, and never adds an empty key", () => {
    // compose emits "" for an unset interpolation, so the empty case is the common one.
    const base = { hosted: true, wikiApiUrl: "http://from-the-file:8000" };
    const config = configFromEnv({ WIKI_API_URL: "", OPENROUTER_API_KEY: "or-key" }, base);
    expect(config.wikiApiUrl).toBe("http://from-the-file:8000");
    expect(config.openRouterApiKey).toBe("or-key");
    expect(config.hosted).toBe(true);
    // Absent stays absent, so each getter's own default still applies.
    expect("popStatsUrl" in config).toBe(false);
    expect("openRouterModel" in config).toBe(false);
  });

  it("does not mutate the base it was given", () => {
    const base = { wikiApiUrl: "http://from-the-file:8000" };
    configFromEnv({ WIKI_API_URL: "http://from-the-env:8000" }, base);
    expect(base.wikiApiUrl).toBe("http://from-the-file:8000");
  });

  it("names every variable it reads, for the prototype's config test to bind against", () => {
    // apps/server/tests/test_proto_config.py reads this list out of the source and holds it
    // equal to the worker's PER_USER_ENV_KEYS and the tools service's environment.
    expect([...PER_USER_ENV]).toEqual([
      "WIKI_API_URL",
      "POP_STATS_URL",
      "OPENROUTER_API_KEY",
      "OPENROUTER_MODEL",
    ]);
    const keys = Object.keys(
      configFromEnv(Object.fromEntries(PER_USER_ENV.map((name) => [name, "set"]))),
    );
    expect(keys).toHaveLength(PER_USER_ENV.length);
  });
});
