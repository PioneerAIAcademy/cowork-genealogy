import { LOCAL, bearerPrincipal } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  loadConfig,
  getClientId,
  getMatcherSettings,
  CONFIG_STORAGE_PATH,
  STORAGE_DIR,
  BUNDLED_CLIENT_CONFIG_PATH,
  CLIENT_ID_PACKAGING_ERROR,
} from "../../src/auth/config.js";

vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedChmod = vi.mocked(chmod);

beforeEach(() => {
  mockedReadFile.mockReset();
  mockedWriteFile.mockReset();
  mockedMkdir.mockReset();
  mockedChmod.mockReset();
});

describe("loadConfig", () => {
  it("returns empty object when the config file does not exist", async () => {
    mockedReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const config = await loadConfig(LOCAL);

    expect(config).toEqual({});
    expect(mockedReadFile).toHaveBeenCalledWith(CONFIG_STORAGE_PATH, "utf8");
  });
});

describe("getClientId", () => {
  it("reads clientId from the bundled config file shipped with the server", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ clientId: "  bundled-key-123  " })
    );

    const clientId = await getClientId();

    expect(clientId).toBe("bundled-key-123");
    expect(mockedReadFile).toHaveBeenCalledWith(
      BUNDLED_CLIENT_CONFIG_PATH,
      "utf8"
    );
  });

  it("throws a packaging error (not an LLM-actionable one) when the bundled file is missing or malformed", async () => {
    // Missing file
    mockedReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_PACKAGING_ERROR);

    // Invalid JSON
    mockedReadFile.mockResolvedValueOnce("{ not json");
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_PACKAGING_ERROR);

    // Wrong shape
    mockedReadFile.mockResolvedValueOnce(JSON.stringify([]));
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_PACKAGING_ERROR);

    // Empty / whitespace clientId
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ clientId: "   " }));
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_PACKAGING_ERROR);

    // Missing clientId field
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ other: "x" }));
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_PACKAGING_ERROR);
  });

  it("packaging error frames the failure as an installation problem, not a user-action prompt", async () => {
    // Regression guard: the error must read as "the MCP server is broken,
    // reinstall it" — not as "ask the user for a dev key / client ID" or
    // "pass clientId to the login tool". Naming `client ID` is fine; inviting
    // the LLM to solicit one is not.
    expect(CLIENT_ID_PACKAGING_ERROR).toMatch(/install/i);
    expect(CLIENT_ID_PACKAGING_ERROR).not.toMatch(
      /\b(pass|provide|supply|enter|configure|set|create)\b/i
    );
    expect(CLIENT_ID_PACKAGING_ERROR).not.toMatch(/dev(?:eloper)?\s*key/i);
    expect(CLIENT_ID_PACKAGING_ERROR).not.toMatch(/call\s+the\s+login\s+tool/i);
  });
});

describe("getMatcherSettings", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  const withConfig = (config: unknown) =>
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(config));

  it("is FamilySearch's matcher when config.json names none", async () => {
    withConfig({ wikiApiUrl: "http://localhost:8000" });
    await expect(getMatcherSettings(LOCAL)).resolves.toEqual({ backend: "familysearch" });
  });

  it("is FamilySearch's matcher when config.json says so", async () => {
    withConfig({ matcher: "familysearch", matcherUrl: "http://x", matcherApiKey: KEY });
    await expect(getMatcherSettings(LOCAL)).resolves.toEqual({ backend: "familysearch" });
  });

  it("is the service with its url, trailing slash stripped, and its key trimmed", async () => {
    withConfig({ matcher: "service", matcherUrl: " http://127.0.0.1:8765/ ", matcherApiKey: ` ${KEY}\n` });
    await expect(getMatcherSettings(LOCAL)).resolves.toEqual({
      backend: "service",
      url: "http://127.0.0.1:8765",
      apiKey: KEY,
    });
  });

  it.each([
    ["no matcherUrl", { matcher: "service", matcherApiKey: KEY }, "matcherUrl"],
    ["a blank matcherUrl", { matcher: "service", matcherUrl: "  ", matcherApiKey: KEY }, "matcherUrl"],
    ["a matcherUrl that is not a string", { matcher: "service", matcherUrl: 8765, matcherApiKey: KEY }, "matcherUrl"],
    ["no matcherApiKey", { matcher: "service", matcherUrl: "http://x" }, "matcherApiKey"],
    ["a blank matcherApiKey", { matcher: "service", matcherUrl: "http://x", matcherApiKey: " " }, "matcherApiKey"],
  ])("throws, naming the key, on the service with %s", async (_label, config, key) => {
    withConfig(config);
    const err = await getMatcherSettings(LOCAL).then(() => null, (e: Error) => e);
    expect(err?.message).toContain(`"${key}"`);
    expect(err?.message).toContain("~/.familysearch-mcp/config.json");
    expect(err?.message).toMatch(/Do not ask the user to paste a key into the chat\.$/);
    expect(err?.message).not.toContain(KEY);
  });

  it.each([["Service"], [1], [null], [""]])("throws on matcher %j, naming the two allowed values", async (value) => {
    withConfig({ matcher: value, matcherUrl: "http://x", matcherApiKey: KEY });
    const err = await getMatcherSettings(LOCAL).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('"familysearch"');
    expect(err?.message).toContain('"service"');
    expect(err?.message).toMatch(/Do not ask the user to paste a key into the chat\.$/);
  });

  it("reads a bearer principal's own config, never config.json", async () => {
    const principal = bearerPrincipal("token", {
      matcher: "service",
      matcherUrl: "https://matcher.example",
      matcherApiKey: KEY,
    });
    await expect(getMatcherSettings(principal)).resolves.toEqual({
      backend: "service",
      url: "https://matcher.example",
      apiKey: KEY,
    });
    expect(mockedReadFile).not.toHaveBeenCalled();
  });
});

