import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Principal } from "../../src/auth/principal.js";
import { LOCAL, bearerPrincipal, connectorPrincipal } from "../../src/auth/principal.js";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// The real module with its two fetchers replaced: fs-fetch.ts also reads its
// constants and `retryAfterMs`, and the 429-pause cases below put the real
// fetchers back to run the retry loop against a stubbed `fetch`.
vi.mock("../../src/utils/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/http.js")>()),
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { getValidToken } from "../../src/auth/refresh.js";
import { fetchWithRetry, fetchWithTimeout } from "../../src/utils/http.js";
import { fsFetch, fsFetchWithTimeout } from "../../src/utils/fs-fetch.js";
import { isFsBudgetExhausted } from "../../src/utils/fs-budget.js";
import {
  __resetUserLimitsForTests,
  __userLimitsStateForTests,
  recordFsPause,
} from "../../src/utils/user-limits.js";

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

// ── the per-user 429 pause (self-hosted beta E4, issue #3999) ───────────────
//
// These run the REAL fetchWithRetry / fetchWithTimeout over a stubbed global
// `fetch`, because the point is where the 429 is seen: a Retry-After longer
// than the 10 s retry budget makes fetchWithRetry THROW, so a check placed
// after it returns never sees that 429.

describe("the per-user 429 pause", () => {
  const FS_URL = "https://www.familysearch.org/platform/tree/persons/KWQ7-ABC";
  const userA = connectorPrincipal({ accessToken: "fs-A", userId: "u_A" });
  const userB = connectorPrincipal({ accessToken: "fs-B", userId: "u_B" });
  const wire = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>();
  const tooMany = (retryAfter?: string) =>
    new Response("slow down", {
      status: 429,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
  const ok = () => new Response("{}", { status: 200 });

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../../src/utils/http.js")>("../../src/utils/http.js");
    vi.mocked(fetchWithRetry).mockImplementation(actual.fetchWithRetry);
    vi.mocked(fetchWithTimeout).mockImplementation(actual.fetchWithTimeout);
    vi.mocked(getValidToken).mockImplementation(async (p) => (p.kind === "bearer" ? p.accessToken : "local-tok"));
    wire.mockReset();
    // A call the case did not plan for answers 418, so a misrouted call fails
    // on its status rather than on an undefined response.
    wire.mockImplementation(async () => new Response("unplanned fetch", { status: 418 }));
    vi.stubGlobal("fetch", wire);
  });

  afterEach(() => {
    vi.mocked(fetchWithRetry).mockReset();
    vi.mocked(fetchWithTimeout).mockReset();
    vi.unstubAllGlobals();
    __resetUserLimitsForTests();
  });

  it("a 429 with Retry-After: 60 (past the retry budget) pauses only that user", async () => {
    wire.mockResolvedValueOnce(tooMany("60"));
    await expect(fsFetch(userA, FS_URL)).rejects.toThrow(/Server requested a 60s wait/);
    expect(wire).toHaveBeenCalledTimes(1);

    // A's next call refuses before any network I/O, marked so retry loops rethrow it.
    const refused = await fsFetch(userA, FS_URL).catch((e: unknown) => e);
    expect((refused as Error).message).toBe(
      "FamilySearch asked this account to wait; try again in about 60 seconds.",
    );
    expect(isFsBudgetExhausted(refused)).toBe(true);
    await expect(fsFetchWithTimeout(userA, FS_URL)).rejects.toThrow("about 60 seconds");
    expect(wire).toHaveBeenCalledTimes(1);

    // B was never paused: its call reaches the stub.
    wire.mockResolvedValueOnce(ok());
    expect((await fsFetch(userB, FS_URL)).status).toBe(200);
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("a worker bearer carrying the same user id, and LOCAL, are never paused and never pause anyone", async () => {
    const worker = {
      kind: "bearer" as const,
      accessToken: "worker-tok",
      config: {},
      surface: "worker" as const,
      userId: "u_A",
    };
    // A paused u_A does not hold the worker or LOCAL back.
    recordFsPause("u_A", 60_000);
    wire.mockResolvedValue(ok());
    expect((await fsFetch(worker, FS_URL)).status).toBe(200);
    expect((await fsFetchWithTimeout(worker, FS_URL)).status).toBe(200);
    expect((await fsFetch(LOCAL, FS_URL)).status).toBe(200);
    expect(wire).toHaveBeenCalledTimes(3);

    // And their own 429s pause nobody.
    __resetUserLimitsForTests();
    wire.mockResolvedValue(tooMany("60"));
    await expect(fsFetch(worker, FS_URL)).rejects.toThrow(/Server requested a 60s wait/);
    expect((await fsFetchWithTimeout(worker, FS_URL)).status).toBe(429);
    await expect(fsFetch(LOCAL, FS_URL)).rejects.toThrow(/Server requested a 60s wait/);
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
    wire.mockResolvedValue(ok());
    expect((await fsFetch(userA, FS_URL)).status).toBe(200);
  });

  it("a 429 with no Retry-After pauses for 30 s, so the call's own retry refuses instead of calling FamilySearch again", async () => {
    wire.mockResolvedValue(tooMany());
    const refused = await fsFetch(userA, FS_URL).catch((e: unknown) => e);
    expect((refused as Error).message).toBe(
      "FamilySearch asked this account to wait; try again in about 30 seconds.",
    );
    expect(isFsBudgetExhausted(refused)).toBe(true);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("a throttled call that ends in a throw still hands its 429 to the door's log line; a call refused before the wire hands nothing", async () => {
    const seen: number[] = [];
    const logged = connectorPrincipal({
      accessToken: "fs-A",
      userId: "u_A",
      recordFamilySearchStatus: (status) => seen.push(status),
    });
    // A header-less 429: the retry is refused by the pause the 429 set.
    wire.mockResolvedValue(tooMany());
    await expect(fsFetch(logged, FS_URL)).rejects.toThrow("about 30 seconds");
    expect(seen).toEqual([429]);
    // Already paused: nothing reached FamilySearch, so no status.
    await expect(fsFetch(logged, FS_URL)).rejects.toThrow("FamilySearch asked this account to wait");
    expect(seen).toEqual([429]);

    // A Retry-After past the budget makes the loop throw before any pause gate.
    __resetUserLimitsForTests();
    const seenB: number[] = [];
    const loggedB = connectorPrincipal({
      accessToken: "fs-B",
      userId: "u_B",
      recordFamilySearchStatus: (status) => seenB.push(status),
    });
    wire.mockResolvedValue(tooMany("60"));
    await expect(fsFetch(loggedB, FS_URL)).rejects.toThrow(/Server requested a 60s wait/);
    expect(seenB).toEqual([429]);
  });

  it("a 5xx pauses nobody", async () => {
    wire.mockResolvedValueOnce(new Response("down", { status: 503, headers: { "Retry-After": "60" } }));
    await expect(fsFetch(userA, FS_URL)).rejects.toThrow(/Server requested a 60s wait/);
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
    wire.mockResolvedValueOnce(ok());
    expect((await fsFetch(userA, FS_URL)).status).toBe(200);
  });

  it("a pause that ends inside the retry budget is waited out, then the call goes", async () => {
    recordFsPause("u_A", 300);
    wire.mockResolvedValue(ok());
    const started = performance.now();
    expect((await fsFetch(userA, FS_URL)).status).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
  });

  it("fsFetchWithTimeout takes a pause wait out of its own timeout, and refuses a pause longer than that timeout", async () => {
    // A connection that stalls until its timeout fires.
    wire.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation timed out.");
            err.name = "TimeoutError";
            reject(err);
          });
        }),
    );
    recordFsPause("u_A", 300);
    const started = performance.now();
    const err = (await fsFetchWithTimeout(userA, FS_URL, {}, 1000).catch((e: unknown) => e)) as Error;
    // The wait came out of the 1 s: about 1 s in all, not 1.3 s.
    expect(performance.now() - started).toBeLessThan(1_200);
    expect(Number(/timed out after (\d+)ms/.exec(err.message)?.[1])).toBeLessThanOrEqual(705);
    expect(wire).toHaveBeenCalledTimes(1);

    // A pause that outlasts the caller's timeout is refused at once, even
    // though it would fit the 10 s retry budget: volume_bisect sized its
    // download leg to its timeout.
    recordFsPause("u_A", 5_000);
    const t0 = performance.now();
    await expect(fsFetchWithTimeout(userA, FS_URL, {}, 2_000)).rejects.toThrow("about 5 seconds");
    expect(performance.now() - t0).toBeLessThan(100);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("fsFetchWithTimeout records a pause from its own 429 and then refuses without a fetch", async () => {
    wire.mockResolvedValueOnce(tooMany("60"));
    // No retry loop here, so the 429 comes back to the caller as before.
    expect((await fsFetchWithTimeout(userA, FS_URL)).status).toBe(429);
    await expect(fsFetchWithTimeout(userA, FS_URL)).rejects.toThrow(
      "FamilySearch asked this account to wait; try again in about 60 seconds.",
    );
    await expect(fsFetch(userA, FS_URL)).rejects.toThrow("about 60 seconds");
    expect(wire).toHaveBeenCalledTimes(1);
  });
});
