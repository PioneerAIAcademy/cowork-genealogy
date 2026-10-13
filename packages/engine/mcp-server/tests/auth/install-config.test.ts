import { describe, it, expect, vi } from "vitest";

// config.json, as the file layer returns it. The install dialog's answer goes on top.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () =>
    JSON.stringify({ openRouterApiKey: "sk-or-file", wikiApiUrl: "http://from-the-file" }),
  ),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}));

import {
  getOpenRouterApiKey,
  getWikiApiUrl,
  installConfigFromEnv,
  INSTALL_OPENROUTER_KEY_ENV,
} from "../../src/auth/config.js";
import { LOCAL, localPrincipal } from "../../src/auth/principal.js";

describe("installConfigFromEnv", () => {
  it("takes the key the install dialog passed", () => {
    expect(installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: " sk-or-dialog " })).toEqual({
      openRouterApiKey: "sk-or-dialog",
    });
  });

  it("treats a field left blank as not set: absent, empty, or the unsubstituted placeholder", () => {
    expect(installConfigFromEnv({})).toEqual({});
    expect(installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: "" })).toEqual({});
    expect(installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: "  " })).toEqual({});
    expect(
      installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: "${user_config.openrouter_api_key}" }),
    ).toEqual({});
  });

  it("reads no other variable, so a key exported in a developer's shell is ignored", () => {
    expect(installConfigFromEnv({ OPENROUTER_API_KEY: "sk-or-shell" })).toEqual({});
  });
});

describe("local principal with the install dialog's key", () => {
  it("uses the dialog's key over config.json's", async () => {
    const principal = localPrincipal(installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: "sk-or-dialog" }));
    expect(await getOpenRouterApiKey(principal)).toBe("sk-or-dialog");
    expect(await getWikiApiUrl(principal)).toBe("http://from-the-file");
  });

  it("leaves config.json in force when the dialog was left blank", async () => {
    const principal = localPrincipal(installConfigFromEnv({ [INSTALL_OPENROUTER_KEY_ENV]: "" }));
    expect(await getOpenRouterApiKey(principal)).toBe("sk-or-file");
    expect(await getOpenRouterApiKey(LOCAL)).toBe("sk-or-file");
  });
});
