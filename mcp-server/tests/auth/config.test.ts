import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  loadConfig,
  saveConfig,
  getClientId,
  CONFIG_STORAGE_PATH,
  STORAGE_DIR,
  CLIENT_ID_MISSING_MESSAGE,
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
  it("returns the clientId stored in config", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ clientId: "fs-internal-dev-key-000262" })
    );

    const clientId = await getClientId();

    expect(clientId).toBe("fs-internal-dev-key-000262");
  });

  it("throws an LLM-instruction error when config is missing or clientId is empty", async () => {
    mockedReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_MISSING_MESSAGE);

    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ clientId: "   " }));
    await expect(getClientId()).rejects.toThrow(CLIENT_ID_MISSING_MESSAGE);
  });
});

describe("saveConfig", () => {
  it("merges the patch into existing config, preserves other keys, and writes JSON with mode 0o600", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ clientId: "old-key", futureKey: "keep-me" })
    );
    mockedMkdir.mockResolvedValueOnce(undefined as unknown as string);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await saveConfig({ clientId: "new-key" });

    expect(mockedMkdir).toHaveBeenCalledWith(STORAGE_DIR, { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBody, writtenOpts] =
      mockedWriteFile.mock.calls[0];
    expect(writtenPath).toBe(CONFIG_STORAGE_PATH);
    expect(JSON.parse(writtenBody as string)).toEqual({
      clientId: "new-key",
      futureKey: "keep-me",
    });
    expect(writtenOpts).toEqual({ mode: 0o600 });
  });
});
