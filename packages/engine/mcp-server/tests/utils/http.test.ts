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
