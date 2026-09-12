import { describe, it, expect, vi, beforeEach } from "vitest";

// A bearer principal must never touch ~/.familysearch-mcp: every read below
// runs with the file layer rigged to explode, so a code path that still reaches
// disk fails here rather than silently reading whichever user last logged in.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => {
    throw new Error("bearer principal reached the filesystem");
  }),
  writeFile: vi.fn(async () => {
    throw new Error("bearer principal reached the filesystem");
  }),
  rm: vi.fn(async () => {
    throw new Error("bearer principal reached the filesystem");
  }),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}));

import { getValidToken } from "../../src/auth/refresh.js";
import {
  loadConfig,
  saveConfig,
  isHostedMode,
  getWikiApiUrl,
  getOpenRouterApiKey,
  getOpenRouterModel,
  HOSTED_REAUTH_INSTRUCTION,
  HOSTED_CONFIG_READ_ONLY_MESSAGE,
  HOSTED_SESSION_MANAGED_MESSAGE,
  DEFAULT_WIKI_API_URL,
  OPENROUTER_API_KEY_MISSING_MESSAGE,
} from "../../src/auth/config.js";
import { bearerPrincipal, LOCAL } from "../../src/auth/principal.js";
import { logoutTool } from "../../src/tools/logout.js";
import { authStatusTool } from "../../src/tools/auth-status.js";
import { loginTool } from "../../src/tools/login.js";

const bearer = bearerPrincipal("tok-123", {
  wikiApiUrl: "https://wiki.example/",
  openRouterApiKey: "or-key",
  openRouterModel: "some/model",
});

describe("bearer principal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getValidToken returns the carried token and never refreshes or reads a file", async () => {
    expect(await getValidToken(bearer)).toBe("tok-123");
  });

  it("getValidToken with an empty bearer token sends the user to the web app's reconnect", async () => {
    await expect(getValidToken(bearerPrincipal(""))).rejects.toThrow(HOSTED_REAUTH_INSTRUCTION);
  });

  it("loadConfig is the carried config, with hosted implied", async () => {
    const config = await loadConfig(bearer);
    expect(config.hosted).toBe(true);
    expect(config.wikiApiUrl).toBe("https://wiki.example/");
    expect(await isHostedMode(bearer)).toBe(true);
  });

  it("the config getters read the carried config", async () => {
    expect(await getWikiApiUrl(bearer)).toBe("https://wiki.example");
    expect(await getOpenRouterApiKey(bearer)).toBe("or-key");
    expect(await getOpenRouterModel(bearer)).toBe("some/model");
    expect(await getWikiApiUrl(bearerPrincipal("t"))).toBe(DEFAULT_WIKI_API_URL);
    await expect(getOpenRouterApiKey(bearerPrincipal("t"))).rejects.toThrow(
      OPENROUTER_API_KEY_MISSING_MESSAGE,
    );
  });

  it("saveConfig refuses: per-user settings live in the web app", async () => {
    await expect(saveConfig({ openRouterModel: "x" }, bearer)).rejects.toThrow(
      HOSTED_CONFIG_READ_ONLY_MESSAGE,
    );
  });

  it("the desktop session tools answer without a token file", async () => {
    expect(await loginTool({}, bearer)).toEqual({
      success: false,
      message: HOSTED_REAUTH_INSTRUCTION,
    });
    expect(await logoutTool({}, bearer)).toEqual({
      success: false,
      message: HOSTED_SESSION_MANAGED_MESSAGE,
    });
    expect(await authStatusTool({}, bearer)).toEqual({ loggedIn: true });
    expect(await authStatusTool({}, bearerPrincipal(""))).toEqual({ loggedIn: false });
  });
});

describe("local principal", () => {
  it("still reads the per-user files (rigged here to fail, so the read is observable)", async () => {
    // loadTokens swallows the read failure into "not logged in"; the point is
    // that the local principal DID go to disk where the bearer never does.
    await expect(getValidToken(LOCAL)).rejects.toThrow(/not logged in/);
    expect(await loadConfig(LOCAL)).toEqual({});
  });
});
