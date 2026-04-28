import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  saveTokens,
  loadTokens,
  isExpired,
} from "../../src/auth/tokenManager.js";
import {
  STORAGE_DIR,
  TOKEN_STORAGE_PATH,
  EXPIRY_BUFFER_MS,
} from "../../src/auth/config.js";
import type { TokenStore } from "../../src/types/auth.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);

beforeEach(() => {
  mockedMkdir.mockReset();
  mockedReadFile.mockReset();
  mockedWriteFile.mockReset();
});

const sampleTokens: TokenStore = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiresAt: Date.now() + 60 * 60 * 1000,
};

describe("saveTokens", () => {
  it("creates the storage dir and writes JSON with mode 0o600", async () => {
    mockedMkdir.mockResolvedValueOnce(undefined as unknown as string);
    mockedWriteFile.mockResolvedValueOnce(undefined);

    await saveTokens(sampleTokens);

    expect(mockedMkdir).toHaveBeenCalledWith(STORAGE_DIR, { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBody, writtenOpts] =
      mockedWriteFile.mock.calls[0];
    expect(writtenPath).toBe(TOKEN_STORAGE_PATH);
    expect(JSON.parse(writtenBody as string)).toEqual(sampleTokens);
    expect(writtenOpts).toEqual({ mode: 0o600 });
  });
});

describe("loadTokens", () => {
  it("returns parsed tokens when the file is valid", async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(sampleTokens));
    const result = await loadTokens();
    expect(result).toEqual(sampleTokens);
    expect(mockedReadFile).toHaveBeenCalledWith(TOKEN_STORAGE_PATH, "utf8");
  });

  it("returns null when the file is missing", async () => {
    mockedReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );
    expect(await loadTokens()).toBeNull();
  });

  it("returns null when the file contains corrupt JSON", async () => {
    mockedReadFile.mockResolvedValueOnce("{not valid json");
    expect(await loadTokens()).toBeNull();
  });

  it("returns null when the file shape is wrong", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ foo: "bar", expiresAt: "not-a-number" })
    );
    expect(await loadTokens()).toBeNull();
  });
});

describe("isExpired", () => {
  it("returns false for tokens that expire comfortably in the future", () => {
    const now = 1_000_000;
    const tokens: TokenStore = {
      accessToken: "x",
      expiresAt: now + EXPIRY_BUFFER_MS + 60 * 1000,
    };
    expect(isExpired(tokens, now)).toBe(false);
  });

  it("returns true for tokens whose expiresAt has already passed", () => {
    const now = 1_000_000;
    const tokens: TokenStore = {
      accessToken: "x",
      expiresAt: now - 1,
    };
    expect(isExpired(tokens, now)).toBe(true);
  });

  it("returns true for tokens that expire inside the buffer window", () => {
    const now = 1_000_000;
    const tokens: TokenStore = {
      accessToken: "x",
      expiresAt: now + EXPIRY_BUFFER_MS - 1,
    };
    expect(isExpired(tokens, now)).toBe(true);
  });
});

