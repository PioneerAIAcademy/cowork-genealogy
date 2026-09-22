import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/tokenManager.js", () => ({
  loadTokens: vi.fn(),
  isExpired: vi.fn(),
}));

import { authStatusTool } from "../../src/tools/auth-status.js";
import { readBuildInfo } from "../../src/utils/build-info.js";
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

    const result = await authStatusTool({}, LOCAL);

    expect(result).toEqual({ loggedIn: false, buildId: readBuildInfo().version });
  });

  it("reports loggedIn: true with expiry details when tokens are valid", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresAt,
    });
    mockedIsExpired.mockReturnValueOnce(false);

    const result = await authStatusTool({}, LOCAL);

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

    const result = await authStatusTool({}, LOCAL);

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
    const withRefresh = await authStatusTool({}, LOCAL);
    expect(withRefresh.hasRefreshToken).toBe(true);

    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "a",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    mockedIsExpired.mockReturnValueOnce(false);
    const withoutRefresh = await authStatusTool({}, LOCAL);
    expect(withoutRefresh.hasRefreshToken).toBe(false);
  });
});

// #2126 — the build id rides on EVERY branch, because auth_status is the
// no-project fallback for "which build answered?": a tester with no session
// and no project still gets it.
describe("authStatusTool — buildId (#2126)", () => {
  const expected = readBuildInfo().version;

  it("is the stamped build on every return branch", async () => {
    mockedLoadTokens.mockResolvedValueOnce(null);
    expect((await authStatusTool({}, LOCAL)).buildId).toBe(expected);

    mockedLoadTokens.mockResolvedValueOnce({ accessToken: "a", expiresAt: Date.now() - 1000 });
    mockedIsExpired.mockReturnValueOnce(true);
    expect((await authStatusTool({}, LOCAL)).buildId).toBe(expected);

    mockedLoadTokens.mockResolvedValueOnce({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });
    mockedIsExpired.mockReturnValueOnce(false);
    expect((await authStatusTool({}, LOCAL)).buildId).toBe(expected);

    const bearer = await authStatusTool({}, { kind: "bearer", accessToken: "t", config: {} } as any);
    expect(bearer.buildId).toBe(expected);
    expect(mockedLoadTokens).toHaveBeenCalledTimes(3); // the bearer branch never touched the token file
  });

  it("looks like a build stamp", () => {
    expect(expected).toMatch(/^\d+\.\d+\.\d+\+(dev|\d{4}-\d{2}-\d{2}\.[0-9a-f]{7,40}(\.dirty)?)$/);
  });
});
