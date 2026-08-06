import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { fetchWithTimeout } from "../../src/utils/http.js";

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
});
