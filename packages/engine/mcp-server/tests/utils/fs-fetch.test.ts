import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal } from "../../src/auth/principal.js";
import { LOCAL, bearerPrincipal, connectorPrincipal } from "../../src/auth/principal.js";

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
      surface: "worker",
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

describe("fs-fetch — structural guarantees", () => {
  it("never imports refreshAccessToken", async () => {
    // fs-fetch.ts must never refresh on a 401 — a refresh revokes every other
    // holder's token (measured in PR #2859). The guarantee is structural: the
    // module imports only getValidToken from refresh.ts, not refreshAccessToken.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const code = readFileSync(
      resolve(__dirname, "../../src/utils/fs-fetch.ts"),
      "utf-8",
    );
    // Strip comments (single-line and multi-line) so the JSDoc mention doesn't match.
    const codeWithoutComments = code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
    expect(codeWithoutComments).not.toContain("refreshAccessToken");
  });
});


// ── the door's FamilySearch-status recorder (E1, issue #3984) ───────────────
//
// The door logs one line per call carrying the FamilySearch status, and the
// only place that status exists is where the response is read. A recorder that
// is never wired and one that works produce the SAME door output -- an absent
// field -- so these pin the wiring rather than the logging.

describe("recordFamilySearchStatus", () => {
  it("hands the final status to a connector principal's recorder", async () => {
    const seen: number[] = [];
    const p = connectorPrincipal({
      accessToken: "fs-tok",
      userId: "u_1",
      recordFamilySearchStatus: (s) => seen.push(s),
    });
    vi.mocked(getValidToken).mockResolvedValue("fs-tok");
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response("{}", { status: 403 }));

    await fsFetch(p, "https://api.familysearch.org/x");
    expect(seen).toEqual([403]);
  });

  it("records the status AFTER a 401 re-read, not the first one", async () => {
    // A bearer never re-reads (handle401 returns at once for a non-local
    // principal), so the recorded status is that 401 -- which is the status the
    // call actually got, and the one E3's session-end rule keys on.
    const seen: number[] = [];
    const p = connectorPrincipal({
      accessToken: "fs-tok",
      userId: "u_1",
      recordFamilySearchStatus: (s) => seen.push(s),
    });
    vi.mocked(getValidToken).mockResolvedValue("fs-tok");
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response("nope", { status: 401 }));

    const res = await fsFetch(p, "https://api.familysearch.org/x");
    expect(res.status).toBe(401);
    expect(seen).toEqual([401]);
  });

  it("a principal with no recorder is unaffected", async () => {
    vi.mocked(getValidToken).mockResolvedValue("tok");
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await fsFetch(bearerPrincipal("tok"), "https://api.familysearch.org/x");
    expect(res.status).toBe(200);
  });

  it("a recorder that throws never fails the call", async () => {
    // It is a logging detail. A tool call the caller was entitled to make must
    // not fail because the door's logger did.
    const p = connectorPrincipal({
      accessToken: "fs-tok",
      userId: "u_1",
      recordFamilySearchStatus: () => {
        throw new Error("logger exploded");
      },
    });
    vi.mocked(getValidToken).mockResolvedValue("fs-tok");
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response("{}", { status: 200 }));

    const res = await fsFetch(p, "https://api.familysearch.org/x");
    expect(res.status).toBe(200);
  });
});
