import { describe, it, expect } from "vitest";
import { configFromEnv, PER_USER_ENV } from "../../src/hosted-config-env.js";

// The prototype's HTTP entrypoint builds its AppConfig through this, so what it does with an
// absent or empty variable decides whether a container silently loses a per-user value.

/** A value each strictly parsed variable accepts. */
const VALID: Record<string, string> = {
  WEB_PUBLIC_URL: "https://beta.example",
  UPLOADS_ENABLED: "true",
  TRANSCRIPTION_ENABLED: "true",
};

describe("configFromEnv", () => {
  it("layers every set variable over the base", () => {
    const config = configFromEnv({
      WIKI_API_URL: "http://wiki:8000",
      POP_STATS_URL: "http://pop:9000",
      OPENROUTER_API_KEY: "or-key",
      OPENROUTER_MODEL: "a/model",
      WEB_PUBLIC_URL: "https://beta.example",
      UPLOADS_ENABLED: "true",
      TRANSCRIPTION_ENABLED: "false",
      MATCHER_URL: "http://matcher:8765",
      MATCHER_API_KEY: "matcher-key",
    });
    expect(config).toEqual({
      wikiApiUrl: "http://wiki:8000",
      popStatsUrl: "http://pop:9000",
      openRouterApiKey: "or-key",
      openRouterModel: "a/model",
      webPublicUrl: "https://beta.example",
      uploadsEnabled: true,
      transcriptionEnabled: false,
      matcher: "service",
      matcherUrl: "http://matcher:8765",
      matcherApiKey: "matcher-key",
    });
  });

  it("reads a switch trimmed and in any case", () => {
    const config = configFromEnv({ UPLOADS_ENABLED: " TRUE ", TRANSCRIPTION_ENABLED: "False" });
    expect(config.uploadsEnabled).toBe(true);
    expect(config.transcriptionEnabled).toBe(false);
  });

  it("leaves a switch unset when its variable is empty, over the base's value", () => {
    const config = configFromEnv({ UPLOADS_ENABLED: "", TRANSCRIPTION_ENABLED: "  " }, { uploadsEnabled: true });
    expect(config.uploadsEnabled).toBe(true);
    expect("transcriptionEnabled" in config).toBe(false);
  });

  it("trims WEB_PUBLIC_URL, and a blank one leaves the base's value", () => {
    expect(configFromEnv({ WEB_PUBLIC_URL: " https://beta.example " }).webPublicUrl).toBe("https://beta.example");
    const base = { webPublicUrl: "https://from-the-file.example" };
    expect(configFromEnv({ WEB_PUBLIC_URL: "   " }, base).webPublicUrl).toBe("https://from-the-file.example");
  });

  it.each([
    "https://beta.example/app",
    "http://localhost:8085",
    "HTTPS://Beta.Example/",
    "http://[::1]:8085",
    "https://beta.example/a//b@c",
  ])("accepts WEB_PUBLIC_URL %j", (raw) => {
    expect(configFromEnv({ WEB_PUBLIC_URL: raw }).webPublicUrl).toBe(raw);
  });

  it.each([
    "beta.example.org",
    "ftp://beta.example",
    "https://",
    "/#/p",
    "https://beta.example/#/",
    "https://beta.example/#",
    "https://beta.example?x=1",
    "https://user:pw@beta.example",
    "https://user@beta.example",
    "https:user:pw@beta.example",
    "https:///beta.example",
    "https:\\\\user:pw@beta.example",
    "https://beta.example\\@evil.example",
    "https://beta.example/a b",
    "https://beta.example\\path",
    "http://beta.example:99999",
    "http://x:notaport",
    "https://beta.example\x01",
    "https://beta.example/app\x00",
  ])(
    "refuses WEB_PUBLIC_URL %j, which would make links nobody can open or leak credentials",
    (raw) => {
      expect(() => configFromEnv({ WEB_PUBLIC_URL: raw })).toThrow(/WEB_PUBLIC_URL must be an http\(s\) URL/);
    },
  );

  it.each(["off", "1", "yes", "on", "0"])("refuses a switch set to %j rather than guessing", (raw) => {
    expect(() => configFromEnv({ TRANSCRIPTION_ENABLED: raw })).toThrow(/TRANSCRIPTION_ENABLED must be true or false/);
    expect(() => configFromEnv({ UPLOADS_ENABLED: raw })).toThrow(/UPLOADS_ENABLED must be true or false/);
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
      "WEB_PUBLIC_URL",
      "UPLOADS_ENABLED",
      "TRANSCRIPTION_ENABLED",
      "MATCHER_URL",
      "MATCHER_API_KEY",
    ]);
    const keys = Object.keys(
      configFromEnv(Object.fromEntries(PER_USER_ENV.map((name) => [name, VALID[name] ?? "set"]))),
    );
    expect(keys.sort()).toEqual([
      "matcher",
      "matcherApiKey",
      "matcherUrl",
      "openRouterApiKey",
      "openRouterModel",
      "popStatsUrl",
      "transcriptionEnabled",
      "uploadsEnabled",
      "webPublicUrl",
      "wikiApiUrl",
    ]);
  });
});
