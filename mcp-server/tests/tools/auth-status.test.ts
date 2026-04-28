import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/tokenManager.js", () => ({
  loadTokens: vi.fn(),
  isExpired: vi.fn(),
}));

import { authStatusTool } from "../../src/tools/auth-status.js";
import { loadTokens, isExpired } from "../../src/auth/tokenManager.js";

const mockedLoadTokens = vi.mocked(loadTokens);
const mockedIsExpired = vi.mocked(isExpired);

beforeEach(() => {
  mockedLoadTokens.mockReset();
  mockedIsExpired.mockReset();
});

describe("authStatusTool", () => {
  it("reports loggedIn: false when no tokens are stored", async () => {
    mockedLoadTokens.mockResolvedValueOnce(null);

    const result = await authStatusTool();

    expect(result).toEqual({ loggedIn: false });
  });

  it("reports loggedIn: true with expiry details when tokens are valid", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresAt,
    });
    mockedIsExpired.mockReturnValueOnce(false);

    const result = await authStatusTool();

    expect(result.loggedIn).toBe(true);
    expect(result.expiresAt).toBe(new Date(expiresAt).toISOString());
    expect(result.expiresInMinutes).toBeGreaterThan(0);
  });

  it("reports loggedIn: false when tokens exist but are expired", async () => {
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      expiresAt: Date.now() - 1000,
    });
    mockedIsExpired.mockReturnValueOnce(true);

    const result = await authStatusTool();

    expect(result.loggedIn).toBe(false);
    expect(result.expiresAt).toBeDefined();
  });

  it("reports hasRefreshToken accurately for both present and absent refresh tokens", async () => {
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    mockedIsExpired.mockReturnValueOnce(false);
    const withRefresh = await authStatusTool();
    expect(withRefresh.hasRefreshToken).toBe(true);

    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    mockedIsExpired.mockReturnValueOnce(false);
    const withoutRefresh = await authStatusTool();
    expect(withoutRefresh.hasRefreshToken).toBe(false);
  });
});
