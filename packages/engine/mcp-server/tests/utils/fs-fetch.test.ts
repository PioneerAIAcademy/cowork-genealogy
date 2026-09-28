import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal } from "../../src/auth/principal.js";
import { LOCAL } from "../../src/auth/principal.js";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

vi.mock("../../src/utils/http.js", () => ({
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { getValidToken } from "../../src/auth/refresh.js";
import { fetchWithRetry, fetchWithTimeout } from "../../src/utils/http.js";
import { fsFetch, fsFetchWithTimeout } from "../../src/utils/fs-fetch.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fsFetch — 401 re-read", () => {
  it("returns a successful response unchanged", async () => {
    vi.mocked(getValidToken).mockResolvedValue("token-A");
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await fsFetch(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(200);
    expect(getValidToken).toHaveBeenCalledTimes(1);

    const calledInit = vi.mocked(fetchWithRetry).mock.calls[0][1] as RequestInit;
    expect(new Headers(calledInit.headers).get("Authorization")).toBe("Bearer token-A");
  });

  it("retries once on 401 when token changed (LOCAL principal)", async () => {
    vi.mocked(getValidToken)
      .mockResolvedValueOnce("token-A")
      .mockResolvedValueOnce("token-B");
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fsFetch(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(200);
    expect(getValidToken).toHaveBeenCalledTimes(2);
    expect(fetchWithRetry).toHaveBeenCalledTimes(2);

    // Second call uses the fresh token.
    const retryInit = vi.mocked(fetchWithRetry).mock.calls[1][1] as RequestInit;
    expect(new Headers(retryInit.headers).get("Authorization")).toBe("Bearer token-B");
  });

  it("returns 401 unchanged when token has NOT changed (LOCAL principal)", async () => {
    vi.mocked(getValidToken).mockResolvedValue("token-A");
    vi.mocked(fetchWithRetry).mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    const res = await fsFetch(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(401);
    expect(getValidToken).toHaveBeenCalledTimes(2);
    expect(fetchWithRetry).toHaveBeenCalledTimes(1); // no retry
  });

  it("returns 401 immediately for a bearer principal (never re-reads)", async () => {
    const bearer: Principal = {
      kind: "bearer",
      accessToken: "bearer-tok",
      config: {} as never,
    };
    vi.mocked(getValidToken).mockResolvedValue("bearer-tok");
    vi.mocked(fetchWithRetry).mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    const res = await fsFetch(bearer, "https://fs.example/api");
    expect(res.status).toBe(401);
    expect(getValidToken).toHaveBeenCalledTimes(1); // no re-read
  });

  it("passes through non-401 errors unchanged", async () => {
    vi.mocked(getValidToken).mockResolvedValue("token-A");
    vi.mocked(fetchWithRetry).mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );

    const res = await fsFetch(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(403);
    expect(getValidToken).toHaveBeenCalledTimes(1); // no re-read for non-401
  });
});

describe("fsFetchWithTimeout — 401 re-read", () => {
  it("retries once on 401 when token changed (LOCAL principal)", async () => {
    vi.mocked(getValidToken)
      .mockResolvedValueOnce("token-A")
      .mockResolvedValueOnce("token-B");
    vi.mocked(fetchWithTimeout)
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fsFetchWithTimeout(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(200);
    expect(getValidToken).toHaveBeenCalledTimes(2);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  it("returns 401 unchanged when token has NOT changed", async () => {
    vi.mocked(getValidToken).mockResolvedValue("token-A");
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    const res = await fsFetchWithTimeout(LOCAL, "https://fs.example/api");
    expect(res.status).toBe(401);
    expect(getValidToken).toHaveBeenCalledTimes(2);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
