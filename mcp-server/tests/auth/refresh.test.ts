import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidToken,
} from "../../src/auth/refresh.js";
import { REDIRECT_URI, TOKEN_URL } from "../../src/auth/config.js";
import { loadTokens, saveTokens, isExpired } from "../../src/auth/tokenManager.js";

vi.mock("../../src/auth/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/config.js")>();
  return {
    ...actual,
    getClientId: vi.fn().mockResolvedValue("test-client-id"),
  };
});

vi.mock("../../src/auth/tokenManager.js", () => ({
  loadTokens: vi.fn(),
  saveTokens: vi.fn(),
  isExpired: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockedLoadTokens = vi.mocked(loadTokens);
const mockedSaveTokens = vi.mocked(saveTokens);
const mockedIsExpired = vi.mocked(isExpired);

beforeEach(() => {
  mockFetch.mockReset();
  mockedLoadTokens.mockReset();
  mockedSaveTokens.mockReset();
  mockedIsExpired.mockReset();
});

describe("exchangeCodeForTokens", () => {
  it("returns a TokenStore on a successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "acc",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "ref",
      }),
    });

    const before = Date.now();
    const result = await exchangeCodeForTokens("code123", "verifier-abc");

    expect(result.accessToken).toBe("acc");
    expect(result.refreshToken).toBe("ref");
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 1000);
  });

  it("POSTs a correct form-urlencoded body with grant_type, code, redirect_uri, client_id, and code_verifier", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "acc",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });

    await exchangeCodeForTokens("code123", "verifier-abc");

    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("code123");
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("code_verifier")).toBe("verifier-abc");
  });

  it("throws a descriptive error on a non-OK HTTP response with no error field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });

    await expect(exchangeCodeForTokens("c", "v")).rejects.toThrow(
      /FamilySearch token endpoint error: 500/
    );
  });

  it("throws when the response body contains an OAuth error field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: "invalid_grant",
        error_description: "Authorization code expired",
      }),
    });

    await expect(exchangeCodeForTokens("c", "v")).rejects.toThrow(
      /invalid_grant.*Authorization code expired/
    );
  });
});

describe("refreshAccessToken", () => {
  it("returns a TokenStore on a successful refresh", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "new-acc",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "new-ref",
      }),
    });

    const result = await refreshAccessToken("old-ref");
    expect(result.accessToken).toBe("new-acc");
    expect(result.refreshToken).toBe("new-ref");
  });

  it("keeps the old refresh token when the response does not include a new one", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "new-acc",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });

    const result = await refreshAccessToken("old-ref");
    expect(result.accessToken).toBe("new-acc");
    expect(result.refreshToken).toBe("old-ref");
  });
});

describe("getValidToken", () => {
  it("returns the stored access token when it is still valid", async () => {
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "fresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    mockedIsExpired.mockReturnValueOnce(false);

    expect(await getValidToken()).toBe("fresh");
  });

  it("refreshes and saves a new token when the current one is expired", async () => {
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() - 1000,
    });
    mockedIsExpired.mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "refreshed",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });

    expect(await getValidToken()).toBe("refreshed");
    expect(mockedSaveTokens).toHaveBeenCalledTimes(1);
    const saved = mockedSaveTokens.mock.calls[0][0];
    expect(saved.accessToken).toBe("refreshed");
    expect(saved.refreshToken).toBe("rt");
  });

  it("throws an LLM-instruction error when no tokens are stored", async () => {
    mockedLoadTokens.mockResolvedValueOnce(null);
    await expect(getValidToken()).rejects.toThrow(
      /not logged in to FamilySearch/
    );
  });

  it("throws an LLM-instruction error when the refresh request fails", async () => {
    mockedLoadTokens.mockResolvedValueOnce({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() - 1000,
    });
    mockedIsExpired.mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "invalid_grant" }),
    });

    await expect(getValidToken()).rejects.toThrow(/refresh failed/);
  });
});
