import { describe, it, expect, vi, beforeEach } from "vitest";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

const mockedChmod = vi.mocked(chmod);
const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);
const mockedRename = vi.mocked(rename);
const mockedRm = vi.mocked(rm);
const mockedWriteFile = vi.mocked(writeFile);

beforeEach(() => {
  mockedChmod.mockReset();
  mockedMkdir.mockReset();
  mockedReadFile.mockReset();
  mockedRename.mockReset();
  mockedRm.mockReset();
  mockedWriteFile.mockReset();
});

const sampleTokens: TokenStore = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiresAt: Date.now() + 60 * 60 * 1000,
};

describe("saveTokens", () => {
  it("creates the storage dir, writes JSON to a new 0o600 temp file beside tokens.json and renames it over", async () => {
    mockedMkdir.mockResolvedValueOnce(undefined as unknown as string);
    mockedWriteFile.mockResolvedValueOnce(undefined);
    mockedRename.mockResolvedValueOnce(undefined);

    await saveTokens(sampleTokens);

    expect(mockedMkdir).toHaveBeenCalledWith(STORAGE_DIR, { recursive: true, mode: 0o700 });
    // The dir only: the temp file is created 0o600 and never chmodded.
    expect(mockedChmod.mock.calls).toEqual([[STORAGE_DIR, 0o700]]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBody, writtenOpts] =
      mockedWriteFile.mock.calls[0];
    expect(writtenPath).not.toBe(TOKEN_STORAGE_PATH);
    expect(dirname(writtenPath as string)).toBe(dirname(TOKEN_STORAGE_PATH));
    expect(JSON.parse(writtenBody as string)).toEqual(sampleTokens);
    expect(writtenOpts).toEqual({ mode: 0o600, flag: "wx" });
    expect(mockedRename.mock.calls).toEqual([[writtenPath, TOKEN_STORAGE_PATH]]);
    expect(mockedRm).not.toHaveBeenCalled();
  });

  it("never lets a loadTokens during the write see a partial tokens.json", async () => {
    // An in-memory disk whose writeFile truncates before it writes, as the real one does.
    const disk = new Map<string, string>([[TOKEN_STORAGE_PATH, JSON.stringify(sampleTokens)]]);
    mockedReadFile.mockImplementation(async (path) => {
      const text = disk.get(path as string);
      if (text === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return text;
    });
    const readMidWrite: Array<TokenStore | null> = [];
    mockedWriteFile.mockImplementation(async (path, body) => {
      disk.set(path as string, "");
      readMidWrite.push(await loadTokens());
      disk.set(path as string, body as string);
    });
    mockedRename.mockImplementation(async (from, to) => {
      disk.set(to as string, disk.get(from as string) as string);
      disk.delete(from as string);
    });
    const next: TokenStore = { ...sampleTokens, accessToken: "access-789" };

    await saveTokens(next);

    expect(readMidWrite).toEqual([sampleTokens]);
    expect(await loadTokens()).toEqual(next);
    expect([...disk.keys()]).toEqual([TOKEN_STORAGE_PATH]);
  });

  it.each([
    { step: "write", rmFails: false },
    { step: "rename", rmFails: true },
  ])("when the $step fails, removes the temp file and rejects with that error", async ({ step, rmFails }) => {
    const failure = new Error(`${step} failed`);
    if (step === "write") mockedWriteFile.mockRejectedValueOnce(failure);
    else mockedRename.mockRejectedValueOnce(failure);
    if (rmFails) mockedRm.mockRejectedValueOnce(new Error("rm failed"));
    else mockedRm.mockResolvedValueOnce(undefined);

    await expect(saveTokens(sampleTokens)).rejects.toBe(failure);

    const tmpPath = mockedWriteFile.mock.calls[0][0];
    expect(mockedRm.mock.calls).toEqual([[tmpPath, { force: true }]]);
    expect(mockedRename).toHaveBeenCalledTimes(step === "write" ? 0 : 1);
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

