import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  runOcr,
  runFoundCheck,
  FOUND_CHECK_MAX_TOKENS,
  type OcrRequest,
} from "../../src/utils/ocr.js";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

function reply(status: number, opts: { retryAfter?: string; body?: string; content?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: STATUS_TEXT[status] ?? "",
    headers: {
      get: (name: string) => (name.toLowerCase() === "retry-after" ? (opts.retryAfter ?? null) : null),
    },
    json: async () => ({ choices: [{ message: { content: opts.content ?? "" }, finish_reason: "stop" }] }),
    text: async () => opts.body ?? "",
  };
}

const read = (content: string) => reply(200, { content });

const REQ: OcrRequest = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "image/jpeg",
  sizeBytes: 3,
  prompt: "Transcribe this page.",
  apiKey: "test-key",
  model: "test-model",
};

/** Let the fake clock run while `p` settles, so a rejection is observed, never left unhandled. */
async function settle<T>(p: Promise<T>, ms = 60_000): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([p]).then(([r]) => r);
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

function failure(r: PromiseSettledResult<unknown>): string {
  if (r.status !== "rejected") throw new Error("expected runOcr to reject");
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runOcr — 429 and 503 backoff", () => {
  it("retries a 429 and returns the next attempt's read", async () => {
    mockFetch.mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(read("Anno 1762"));
    const r = await settle(runOcr(REQ));
    expect(r).toMatchObject({ status: "fulfilled", value: { text: "Anno 1762" } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 the same way", async () => {
    mockFetch.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(read("Anno 1762"));
    const r = await settle(runOcr(REQ));
    expect(r).toMatchObject({ status: "fulfilled", value: { text: "Anno 1762" } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries with today's retryable error", async () => {
    mockFetch.mockResolvedValue(reply(429, { body: "Rate limit exceeded" }));
    const r = await settle(runOcr(REQ));
    expect(failure(r)).toBe("OpenRouter OCR failed: 429 Too Many Requests — Rate limit exceeded");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("waits exactly the Retry-After the response names", async () => {
    mockFetch.mockResolvedValueOnce(reply(429, { retryAfter: "7" })).mockResolvedValueOnce(read("ok"));
    const p = runOcr(REQ);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toMatchObject({ text: "ok" });
  });

  it("never waits more than 20s in all", async () => {
    mockFetch
      .mockResolvedValueOnce(reply(429, { retryAfter: "15" }))
      .mockResolvedValueOnce(reply(429, { retryAfter: "10" }))
      .mockResolvedValueOnce(read("too late"));
    const r = await settle(runOcr(REQ));
    expect(failure(r)).toMatch(/^OpenRouter OCR failed: 429/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not wait past the caller's budget", async () => {
    mockFetch.mockResolvedValueOnce(reply(429, { retryAfter: "6" })).mockResolvedValueOnce(read("too late"));
    const r = await settle(runOcr({ ...REQ, timeoutMs: 5_000 }));
    expect(failure(r)).toMatch(/^OpenRouter OCR failed: 429/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("runs the retry on what is left of the budget", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    mockFetch.mockResolvedValueOnce(reply(429, { retryAfter: "10" })).mockRejectedValueOnce(timeout);
    const r = await settle(runOcr({ ...REQ, timeoutMs: 30_000 }));
    expect(failure(r)).toMatch(/timed out after 20000ms/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("skips the transport retry when the budget has no room for it", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(read("too late"));
    const r = await settle(runOcr({ ...REQ, timeoutMs: 1_000 }));
    expect(failure(r)).toMatch(/^Could not reach OpenRouter\. /);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries no other failure status", async () => {
    mockFetch.mockResolvedValue(reply(500, { body: "upstream boom" }));
    const r = await settle(runOcr(REQ));
    expect(failure(r)).toBe("OpenRouter OCR failed: 500 Internal Server Error — upstream boom");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("runFoundCheck — the text-only found check (issue #3718)", () => {
  const CHECK = {
    transcription: "Row 7: Almada, Claudia, 8",
    lookingFor: "Claudia Almada",
    apiKey: "test-key",
    model: "test-model",
  };

  it("sends a text-only request (no image part) carrying the transcription and the key, and parses the marker", async () => {
    mockFetch.mockResolvedValueOnce(read("FOUND"));
    const r = await settle(runFoundCheck(CHECK));
    expect(r).toMatchObject({ status: "fulfilled", value: "FOUND" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const parts = body.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain('"Claudia Almada"');
    expect(parts[0].text).toContain("Row 7: Almada, Claudia, 8");
    expect(body.max_tokens).toBe(FOUND_CHECK_MAX_TOKENS);
    expect(body.temperature).toBe(0);
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("returns undefined on a reply with no parseable marker", async () => {
    mockFetch.mockResolvedValueOnce(read("The page clearly mentions her."));
    const r = await settle(runFoundCheck(CHECK));
    expect(r).toMatchObject({ status: "fulfilled", value: undefined });
  });

  it("retries a 429 like the OCR read (shared transport)", async () => {
    mockFetch.mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(read("NOT FOUND"));
    const r = await settle(runFoundCheck(CHECK));
    expect(r).toMatchObject({ status: "fulfilled", value: "NOT FOUND" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not wait past the remainder budget the tool hands it", async () => {
    mockFetch.mockResolvedValueOnce(reply(429, { retryAfter: "6" })).mockResolvedValueOnce(read("too late"));
    const r = await settle(runFoundCheck({ ...CHECK, timeoutMs: 5_000 }));
    expect(failure(r)).toMatch(/^OpenRouter OCR failed: 429/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-retryable status — the tool catches and omits found", async () => {
    mockFetch.mockResolvedValue(reply(500, { body: "boom" }));
    const r = await settle(runFoundCheck(CHECK));
    expect(failure(r)).toBe("OpenRouter OCR failed: 500 Internal Server Error — boom");
  });
});
