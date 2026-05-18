import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  loadConfig,
  saveConfig,
  getClientId,
  CONFIG_STORAGE_PATH,
  STORAGE_DIR,
  BUNDLED_CLIENT_CONFIG_PATH,
  CLIENT_ID_PACKAGING_ERROR,
} from "../../src/auth/config.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

beforeEach(() => {
  mockedReadFile.mockReset();
  mockedWriteFile.mockReset();
  mockedMkdir.mockReset();
});

describe("loadConfig", () => {
  it("returns empty object when the config file does not exist", async () => {
    mockedReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const config = await loadConfig();

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

describe("saveConfig", () => {
  it("merges the patch into existing config, preserves other keys, and writes JSON with mode 0o600", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ wikiApiUrl: "http://localhost:8000", futureKey: "keep-me" })
    );
    mockedMkdir.mockResolvedValueOnce(undefined as unknown as string);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await saveConfig({ wikiApiUrl: "http://localhost:9000" });

    expect(mockedMkdir).toHaveBeenCalledWith(STORAGE_DIR, { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBody, writtenOpts] =
      mockedWriteFile.mock.calls[0];
    expect(writtenPath).toBe(CONFIG_STORAGE_PATH);
    expect(JSON.parse(writtenBody as string)).toEqual({
      wikiApiUrl: "http://localhost:9000",
      futureKey: "keep-me",
    });
    expect(writtenOpts).toEqual({ mode: 0o600 });
  });
});
