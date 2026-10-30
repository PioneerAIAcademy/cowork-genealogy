import { describe, it, expect } from "vitest";
import { configFromEnv, PER_USER_ENV } from "../../src/hosted-config-env.js";

// The prototype's HTTP entrypoint builds its AppConfig through this, so what it does with an
// absent or empty variable decides whether a container silently loses a per-user value.

describe("configFromEnv", () => {
  it("layers every set variable over the base", () => {
    const config = configFromEnv({
      WIKI_API_URL: "http://wiki:8000",
      POP_STATS_URL: "http://pop:9000",
      OPENROUTER_API_KEY: "or-key",
      OPENROUTER_MODEL: "a/model",
      MATCHER_URL: "http://matcher:8765",
      MATCHER_API_KEY: "matcher-key",
    });
    expect(config).toEqual({
      wikiApiUrl: "http://wiki:8000",
      popStatsUrl: "http://pop:9000",
      openRouterApiKey: "or-key",
      openRouterModel: "a/model",
      matcher: "service",
      matcherUrl: "http://matcher:8765",
      matcherApiKey: "matcher-key",
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

  it.each([
    ["the URL alone", { MATCHER_URL: "http://matcher:8765" }],
    ["the key alone", { MATCHER_API_KEY: "matcher-key" }],
    ["the URL with an empty key", { MATCHER_URL: "http://matcher:8765", MATCHER_API_KEY: "" }],
  ])("names no matcher from %s", (_label, env) => {
    const config = configFromEnv(env);
    expect("matcher" in config).toBe(false);
    expect("matcherUrl" in config).toBe(false);
    expect("matcherApiKey" in config).toBe(false);
  });

  it("does not mutate the base it was given", () => {
    const base = { wikiApiUrl: "http://from-the-file:8000" };
    configFromEnv({ WIKI_API_URL: "http://from-the-env:8000" }, base);
    expect(base.wikiApiUrl).toBe("http://from-the-file:8000");
  });

  it("names every variable it reads, for the prototype's config test to bind against", () => {
    // apps/server/tests/test_proto_config.py reads this list out of the source and holds the
    // tools service's environment to it.
    expect([...PER_USER_ENV]).toEqual([
      "WIKI_API_URL",
      "POP_STATS_URL",
      "OPENROUTER_API_KEY",
      "OPENROUTER_MODEL",
      "MATCHER_URL",
      "MATCHER_API_KEY",
    ]);
    const keys = Object.keys(
      configFromEnv(Object.fromEntries(PER_USER_ENV.map((name) => [name, "set"]))),
    );
    expect(keys.sort()).toEqual([
      "matcher",
      "matcherApiKey",
      "matcherUrl",
      "openRouterApiKey",
      "openRouterModel",
      "popStatsUrl",
      "wikiApiUrl",
    ]);
  });
});
