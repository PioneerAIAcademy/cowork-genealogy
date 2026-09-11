import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  fetchWithTimeout,
  fetchWithRetry,
  retryAfterMs,
  RETRYABLE_STATUS,
  DEFAULT_RETRY_BUDGET_MS,
} from "../../src/utils/http.js";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchWithTimeout", () => {
  it("resolves normally when fetch responds before the timeout", async () => {
    const response = { ok: true, status: 200 };
    mockFetch.mockResolvedValue(response);

    const result = await fetchWithTimeout("https://example.com", {}, 1000);

    expect(result).toBe(response);
  });

  it("throws a clear timeout error when the upstream connection stalls", async () => {
    // Simulate a connection that stalls forever (Imperva/network hang) —
    // never resolves on its own — but honors the AbortSignal like a real
    // fetch implementation would, rejecting with a TimeoutError once
    // AbortSignal.timeout() fires. This is the exact failure mode that hung
    // volume_search for 236 minutes before fetchWithTimeout existed.
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation timed out.");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    });

    await expect(
      fetchWithTimeout("https://example.com/stalls", {}, 20)
    ).rejects.toThrow(/timed out after 20ms/);
  });

  it("propagates a genuine network error unchanged, not as a timeout", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed: ECONNRESET"));

    await expect(fetchWithTimeout("https://example.com", {}, 1000)).rejects.toThrow(
      "fetch failed: ECONNRESET"
    );
  });

  // The timeout is absolute from creation, so it can fire after the headers
  // have arrived while the body is still streaming. That rejection surfaces at
  // the call site's `.json()` / `.text()` / `.arrayBuffer()`, outside the
  // try/catch above — 40 such reads across 24 files, none of which handle it.
  describe("a timeout that fires mid-body", () => {
    function stalledBody(): Error {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      return err;
    }

    it("translates an aborted json() read into the readable message", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(stalledBody()),
      });

      const response = await fetchWithTimeout("https://example.com/big", {}, 1000);

      await expect(response.json()).rejects.toThrow(
        "Request to https://example.com/big timed out after 1000ms while reading the response body."
      );
    });

    it("translates text() and arrayBuffer() the same way", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(stalledBody()),
        arrayBuffer: () => Promise.reject(stalledBody()),
      });

      const response = await fetchWithTimeout("https://example.com/big", {}, 1000);

      await expect(response.text()).rejects.toThrow(/while reading the response body/);
      await expect(response.arrayBuffer()).rejects.toThrow(
        /while reading the response body/
      );
    });

    it("leaves a successful body read and a non-timeout failure alone", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ hits: 3 }),
        text: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      });

      const response = await fetchWithTimeout("https://example.com", {}, 1000);

      await expect(response.json()).resolves.toEqual({ hits: 3 });
      await expect(response.text()).rejects.toThrow("Unexpected end of JSON input");
    });

    it("returns the same response object, not a stand-in", async () => {
      const response = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      };
      mockFetch.mockResolvedValue(response);

      expect(await fetchWithTimeout("https://example.com", {}, 1000)).toBe(response);
    });
  });
});

// ─── retryAfterMs ──────────────────────────────────────────────────────────────

describe("retryAfterMs", () => {
  function res(headerValue: string | null): Response {
    return {
      headers: {
        get: (name: string) => (name.toLowerCase() === "retry-after" ? headerValue : null),
      },
    } as unknown as Response;
  }

  it("returns null when the header is absent", () => {
    expect(retryAfterMs(res(null))).toBeNull();
  });

  it("returns milliseconds for a numeric delay-seconds value", () => {
    expect(retryAfterMs(res("5"))).toBe(5000);
  });

  it("returns 0 for a zero-second delay", () => {
    expect(retryAfterMs(res("0"))).toBe(0);
  });

  it("returns null for an HTTP-date form", () => {
    expect(retryAfterMs(res("Thu, 01 Dec 1994 16:00:00 GMT"))).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(retryAfterMs(res(""))).toBeNull();
  });

  it("trims whitespace around the numeric value", () => {
    expect(retryAfterMs(res("  10  "))).toBe(10_000);
  });
});

// ─── RETRYABLE_STATUS ──────────────────────────────────────────────────────────

describe("RETRYABLE_STATUS", () => {
  it("contains exactly the expected set", () => {
    expect([...RETRYABLE_STATUS].sort()).toEqual([429, 500, 502, 503, 504]);
  });
});

// ─── fetchWithRetry ────────────────────────────────────────────────────────────

function mockResponse(
  status: number,
  opts?: { retryAfter?: string },
): Record<string, unknown> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : status === 200 ? "OK" : `Status ${status}`,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" ? (opts?.retryAfter ?? null) : null,
      forEach: () => {},
    },
    json: async () => ({}),
    text: async () => "",
  };
}

describe("fetchWithRetry", () => {
  // Use small budgets so tests finish fast.
  const fastOpts = { budgetMs: 5000, baseMs: 1 };

  it("returns 200 immediately without retry", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 then returns 200 on success", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 then returns 200 on success", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a thrown timeout error then returns 200", async () => {
    const err = new Error("timed out");
    (err as unknown as Record<symbol, unknown>)[Symbol.for("cowork-genealogy.fetchWithTimeout.timedOut")] = true;
    mockFetch
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a thrown network error then returns 200", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns 404 immediately (no retry)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(404));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 401 immediately (no retry)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 400 immediately (no retry)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400));

    const res = await fetchWithRetry("https://example.com", {}, 1000, fastOpts);

    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the last retryable Response when all attempts are exhausted", async () => {
    mockFetch.mockResolvedValue(mockResponse(429));

    const res = await fetchWithRetry("https://example.com", {}, 1000, {
      ...fastOpts,
      attempts: 3,
    });

    expect(res.status).toBe(429);
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("re-throws the last error when all attempts are exhausted with thrown errors", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchWithRetry("https://example.com", {}, 1000, {
        ...fastOpts,
        attempts: 3,
      }),
    ).rejects.toThrow("fetch failed");

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not start new attempts after budget is exhausted", async () => {
    // Mock a slow-enough 429 that consuming the budget on the first retry
    // prevents a third attempt.  With attempts=3 and a tiny budget, the
    // budget — not the attempt cap — is what stops the loop.
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(mockResponse(429)), 50),
        ),
    );

    const res = await fetchWithRetry("https://example.com", {}, 1000, {
      budgetMs: 80,
      attempts: 3,
      baseMs: 1,
    });

    expect(res.status).toBe(429);
    // Budget expires before the third attempt can start.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws when Retry-After exceeds remaining budget", async () => {
    mockFetch.mockResolvedValue(mockResponse(429, { retryAfter: "60" }));

    await expect(
      fetchWithRetry("https://example.com", {}, 1000, {
        budgetMs: 5000,
        attempts: 3,
        baseMs: 1,
      }),
    ).rejects.toThrow(/Server requested a 60s wait/);
  });

  it("honours Retry-After within budget", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429, { retryAfter: "1" }))
      .mockResolvedValueOnce(mockResponse(200));

    const start = Date.now();
    const res = await fetchWithRetry("https://example.com", {}, 1000, {
      budgetMs: 5000,
      attempts: 3,
      baseMs: 1,
    });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // Should have waited ~1000ms for the Retry-After
    expect(elapsed).toBeGreaterThanOrEqual(800);
  });

  it("uses the 10s default budget when the caller passes no retryOpts", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResponse(429)), 6000)),
      );
      const p = fetchWithRetry("https://example.com", {}, 30_000);
      await vi.advanceTimersByTimeAsync(120_000);
      const res = await p;
      expect(res.status).toBe(429);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
