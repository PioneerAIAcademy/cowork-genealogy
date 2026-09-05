import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Mock the config getters (key + model) and the shared FS-image fetch. The
// real resolveFsImageInput is kept (partial mock) so input validation and
// ark/imageId resolution are exercised for real.
const getOpenRouterApiKeyMock = vi.hoisted(() => vi.fn());
const getOpenRouterModelMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getOpenRouterApiKey: getOpenRouterApiKeyMock,
  getOpenRouterModel: getOpenRouterModelMock,
}));

const fetchFsImageBytesMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/fs-image-fetch.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/fs-image-fetch.js")>();
  return { ...actual, fetchFsImageBytes: fetchFsImageBytesMock };
});

import {
  imageTranscribeTool,
  __clearBrowseBudgetForTests,
} from "../../src/tools/image-transcribe.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MODEL = "google/gemini-3.7-flash";

// `finishReason` is the OpenAI-normalized top-level field; pass
// `nativeFinishReason` to also stub the provider's un-normalized field (the
// case a provider like Gemini surfaces, or a model that only sets the native
// one). Omit it to leave native_finish_reason absent.
function mockOpenRouterOk(
  content: string | null,
  finishReason: string | null = "stop",
  nativeFinishReason?: string | null
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [
        {
          message: { content },
          finish_reason: finishReason,
          ...(nativeFinishReason !== undefined
            ? { native_finish_reason: nativeFinishReason }
            : {}),
        },
      ],
    }),
    text: async () => "",
  });
}

// Stub a raw OpenRouter body (e.g. an empty `choices` array) for edge cases the
// content/finish_reason helper cannot express.
function mockOpenRouterRaw(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => "",
  });
}

function mockOpenRouterStatus(status: number, body = "") {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => ({}),
    text: async () => body,
  });
}

beforeEach(() => {
  // The browse-budget Map is module-level and survives across it() blocks; a
  // vi mock reset does not clear it, so reset it explicitly or the budget tests
  // become order-dependent.
  __clearBrowseBudgetForTests();
  mockFetch.mockReset();
  getOpenRouterApiKeyMock.mockReset();
  getOpenRouterModelMock.mockReset();
  fetchFsImageBytesMock.mockReset();
  getOpenRouterApiKeyMock.mockResolvedValue("test-key");
  getOpenRouterModelMock.mockResolvedValue(MODEL);
  fetchFsImageBytesMock.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    sizeBytes: 3,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imageTranscribeTool — request + happy path", () => {
  it("POSTs the image to OpenRouter with the OCR prompt, model, temperature 0, and data_collection deny", async () => {
    mockOpenRouterOk("Johann Schreck, b. 1801, Bayern");

    const result = await imageTranscribeTool({ imageId: "004884748_02613" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0);
    expect(body.provider).toEqual({ data_collection: "deny" });

    const parts = body.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);

    expect(result.transcription).toBe("Johann Schreck, b. 1801, Bayern");
    expect(result.metadata).toEqual({
      imageId: "004884748_02613",
      model: MODEL,
      sizeBytes: 3,
    });
    expect(result.found).toBeUndefined();
  });

  it("saves the scan under images/ and returns imageRef when projectPath is given", async () => {
    mockOpenRouterOk("Johann Schreck");
    const dir = await mkdtemp(join(tmpdir(), "imgt-"));
    try {
      const result = await imageTranscribeTool({
        imageId: "004884748_02613",
        projectPath: dir,
      });
      expect(result.imageRef).toBe("images/004884748_02613.jpg");
      const saved = await readFile(join(dir, "images", "004884748_02613.jpg"));
      expect(saved.length).toBe(3); // the 3 mocked fetch bytes
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits imageRef when projectPath is not given", async () => {
    mockOpenRouterOk("Johann Schreck");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.imageRef).toBeUndefined();
  });

  it("reports ark (not imageId) in metadata for ark input", async () => {
    mockOpenRouterOk("some text");
    const result = await imageTranscribeTool({
      ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    });
    expect(result.metadata.ark).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
    expect(result.metadata.imageId).toBeUndefined();
  });
});

describe("imageTranscribeTool — ark URL query-param forwarding", () => {
  // Wiring test: the URL-computation logic itself (forwarding i=/cc=/
  // groupId=, dropping irrelevant params, offering a fallback) is covered
  // directly against resolveFsImageInput in
  // tests/utils/fs-image-fetch.test.ts. fetchFsImageBytes is mocked here
  // (not `fetch`), so the retry-on-non-image-response logic itself isn't
  // observable at this level — this only confirms imageTranscribeTool
  // destructures fallbackUrl from resolveFsImageInput and threads it through
  // as fetchFsImageBytes's second argument, the same way image-read.ts does.
  it("passes both the resolved URL and its fallback through to fetchFsImageBytes", async () => {
    mockOpenRouterOk("some text");
    const url =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en&i=112&cc=1858355&groupId=1858355";

    await imageTranscribeTool({ ark: url });

    expect(fetchFsImageBytesMock.mock.calls[0]).toEqual([
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=112&cc=1858355&groupId=1858355",
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X",
    ]);
  });
});

describe("imageTranscribeTool — lookingFor", () => {
  it("sets found=FOUND from the marker and keeps the full transcription", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family\nFOUND");
    const result = await imageTranscribeTool({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    });
    expect(result.found).toBe("FOUND");
    expect(result.transcription).toContain("Schreck family");
  });

  it("sets found=NOT FOUND when the marker says so", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Weber\nNOT FOUND");
    const result = await imageTranscribeTool({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    });
    expect(result.found).toBe("NOT FOUND");
  });

  it("does not spoof found from body text — only the final-line marker counts", async () => {
    mockOpenRouterOk("Entry: infant found abandoned, no surname given.");
    const result = await imageTranscribeTool({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    });
    expect(result.found).toBeUndefined();
  });
});

describe("imageTranscribeTool — output-cap truncation (#1974, spec §6.2)", () => {
  it("flags a finish_reason=length read as truncated with a tool-voiced notice", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: partway down the pag", "length");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBe(true);
    expect(result.truncationNotice).toMatch(/INCOMPLETE/i);
    // The transcription stays verbatim — the notice is a sibling field, never
    // spliced into the OCR text (would re-create the #1975 prose/OCR blend).
    expect(result.transcription).toBe("Row 1: Anna\nRow 2: partway down the pag");
    expect(result.transcription).not.toMatch(/INCOMPLETE/i);
  });

  it("does not flag a finish_reason=stop read as truncated", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBeUndefined();
    expect(result.truncationNotice).toBeUndefined();
  });

  it("suppresses found on a truncated read — a half-read page is never a clean NOT FOUND", async () => {
    mockOpenRouterOk("Row 1: Weber\nRow 2: Braun\nNOT FOUND", "length");
    const result = await imageTranscribeTool({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    });
    expect(result.truncated).toBe(true);
    expect(result.found).toBeUndefined();
  });

  it("sends an explicit max_tokens so the cap is ours and reproducible", async () => {
    mockOpenRouterOk("Row 1: Anna");
    await imageTranscribeTool({ imageId: "004884748_02613" });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(16000);
  });

  it("catches a cap that a provider surfaces only under native_finish_reason (MAX_TOKENS)", async () => {
    // Top-level finish_reason is "stop"; the cap shows up as the provider's
    // native "MAX_TOKENS". Detection must still flag it.
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "stop", "MAX_TOKENS");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBe(true);
    expect(result.truncationNotice).toMatch(/INCOMPLETE/i);
  });

  it("catches a native_finish_reason=length even when top-level is stop", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "stop", "length");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBe(true);
  });

  it("matches cap markers case-insensitively across both fields (lowercase max_tokens, top-level MAX_TOKENS)", async () => {
    // A model reachable via the openRouterModel override may spell the marker
    // differently or set it on the top-level field. Both must still be caught.
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut", "stop", "max_tokens");
    const lower = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(lower.truncated).toBe(true);

    mockOpenRouterOk("Row 1: Anna\nRow 2: cut", "MAX_TOKENS");
    const topCap = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(topCap.truncated).toBe(true);
  });

  it("does not flag when neither field marks a cap, even with a native stop reason present", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family", "stop", "STOP");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBeUndefined();
  });

  it("does not flag a finish_reason=null read as truncated (@yinkid28)", async () => {
    // The type allows string | null; OpenRouter can send null. null !== any
    // marker, so this must read as a complete, non-truncated success.
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family", null);
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    expect(result.truncated).toBeUndefined();
    expect(result.found).toBeUndefined();
  });

  it("suppresses a would-be FOUND on a truncated read, not only NOT FOUND (@yinkid28)", async () => {
    // The NOT-FOUND suppression is the harm case, but FOUND must be suppressed
    // too: on a half-read page even a positive marker is untrustworthy.
    mockOpenRouterOk("Row 1: Schreck family\nFOUND", "length");
    const result = await imageTranscribeTool({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    });
    expect(result.truncated).toBe(true);
    expect(result.found).toBeUndefined();
  });

  it("throws an empty-cap-aware error when a cap binds with no content, never shipping truncated beside empty text (spec §5.6/§6.2)", async () => {
    // A reasoning-capable model can spend the whole budget before emitting
    // content: finish_reason "length" with empty content. This must throw (a
    // zero-content read has nothing to return) but name the cap so the caller
    // learns a budget bound, not an unreadable scan.
    mockOpenRouterOk("", "length", "MAX_TOKENS");
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/output-token limit/i);
  });

  it("still throws the plain empty error when content is empty and no cap fired", async () => {
    mockOpenRouterOk("", "stop");
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/empty transcription/i);
  });

  it("throws the empty error on an empty choices array (@yinkid28)", async () => {
    mockOpenRouterRaw({ choices: [] });
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/empty transcription/i);
  });

  it("truncationNotice pins the safety meaning: remainder UNREAD/not-blank and no absence inference (not just the keyword)", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "length");
    const result = await imageTranscribeTool({ imageId: "004884748_02613" });
    const notice = result.truncationNotice ?? "";
    // Guard the load-bearing claims, so replacing the notice with a same-keyword
    // sentence that licenses an absence inference fails this test.
    expect(notice).toMatch(/unread/i);
    expect(notice).toMatch(/not\s+blank/i);
    expect(notice).toMatch(/not\s+treat\s+any\s+target\s+as\s+absent/i);
  });
});

describe("imageTranscribeTool — key / auth errors", () => {
  it("throws the configure_openrouter instruction and calls neither fetch when no key", async () => {
    getOpenRouterApiKeyMock.mockRejectedValueOnce(
      new Error(
        "No OpenRouter API key is configured. Ask the user ... call configure_openrouter"
      )
    );
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/configure_openrouter/);
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps a 401 to a re-configure instruction", async () => {
    mockOpenRouterStatus(401);
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/rejected \(401\)/);
  });

  it("maps a 402 to an out-of-credits message", async () => {
    mockOpenRouterStatus(402);
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/out of credits \(402\)/);
  });
});

describe("imageTranscribeTool — OpenRouter failures", () => {
  it("throws a clean error on a non-2xx response", async () => {
    mockOpenRouterStatus(500, "upstream boom");
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/OpenRouter OCR failed: 500/);
  });

  it("throws a friendly error when OpenRouter is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/Could not reach OpenRouter/);
  });

  // #1594: one bounded retry on a TRANSPORT failure. On the run that motivated
  // it, two consecutive losses led the agent to declare the OCR route
  // "network-unreachable in this environment", abandon images for the rest of
  // the run, and conclude from an indexed namesake instead.
  it("retries a transport failure once and returns the retry's transcription", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockOpenRouterOk("Anno 1762, Henckelstorp");

    const result = await imageTranscribeTool({ imageId: "004884748_02613" });

    expect(result.transcription).toBe("Anno 1762, Henckelstorp");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries at most once, and says so when the retry also fails", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/Could not reach OpenRouter \(2 attempts\)/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // The budget objection that kept a retry out until now: a timeout has already
  // spent OCR_TIMEOUT_MS, so re-attempting doubles the worst case. A transport
  // failure never reached OpenRouter and costs nothing. Only the latter retries.
  it("does NOT retry a timeout — that would double the worst-case budget", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    mockFetch.mockRejectedValue(timeout);

    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/timed out after 180000ms/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // #1594: Node's `fetch failed` hides the socket code on `error.cause`; the
  // bare `.message` classifies nothing. The thrown message must carry the code.
  it("surfaces the socket-level cause code hidden on error.cause (#1594)", async () => {
    const cause = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause });
    // Both attempts: the code must survive the retry into the final message, or
    // the classification this carries is lost exactly when it is needed.
    mockFetch.mockRejectedValue(fetchFailed);
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/Could not reach OpenRouter.*ECONNRESET/s);
  });

  // A DNS failure arrives as an AggregateError whose member carries the code.
  it("flattens an AggregateError cause to surface ENOTFOUND (#1594)", async () => {
    const member = Object.assign(new Error("getaddrinfo ENOTFOUND openrouter.ai"), {
      code: "ENOTFOUND",
    });
    const cause = new AggregateError([member], "");
    const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause });
    mockFetch.mockRejectedValue(fetchFailed);
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/Could not reach OpenRouter.*ENOTFOUND/s);
  });

  it("throws rather than fabricate on empty OCR content", async () => {
    mockOpenRouterOk("   ");
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/empty transcription/i);
  });
});

describe("imageTranscribeTool — input validation", () => {
  it("rejects when neither imageId nor ark is given (before any fetch)", async () => {
    await expect(imageTranscribeTool({})).rejects.toThrow(
      /image_transcribe requires either imageId or ark/
    );
    expect(getOpenRouterApiKeyMock).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects when both imageId and ark are given", async () => {
    await expect(
      imageTranscribeTool({
        imageId: "004884748_02613",
        ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
      })
    ).rejects.toThrow(/either imageId or ark, not both/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("imageTranscribeTool — browse budget (#1081, spec §5.8)", () => {
  const GROUP = "004261111";
  const img = (seq: number) => `${GROUP}_${String(seq).padStart(5, "0")}`;

  // A persistent OK OCR response: each transcribe consumes one fetch, and these
  // tests make many calls where the exact text does not matter.
  function mockOcrAlwaysOk(content = "page text") {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => "",
    });
  }

  it("does not attach browseBudget for the first 20 distinct images in one group/project", async () => {
    mockOcrAlwaysOk();
    for (let i = 1; i <= 20; i++) {
      const result = await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
      expect(result.browseBudget).toBeUndefined();
    }
  });

  it("attaches browseBudget on the 21st distinct image, naming the count, group, and pivot actions", async () => {
    mockOcrAlwaysOk();
    for (let i = 1; i <= 20; i++) {
      await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
    }
    const result = await imageTranscribeTool({ imageId: img(21), projectPath: "/p" });

    expect(result.browseBudget).toBeDefined();
    expect(result.browseBudget?.imageGroup).toBe(GROUP);
    expect(result.browseBudget?.distinctImagesRead).toBe(21);
    const notice = result.browseBudget?.notice ?? "";
    expect(notice).toContain("21");
    expect(notice).toContain(GROUP);
    // The concrete pivot actions must survive verbatim — a paraphrase fails here.
    expect(notice).toContain("research_log_append");
    expect(notice).toContain("record_search");
    expect(notice).toContain("record_read");
    expect(notice).toContain("fulltext_search");
  });

  it("leaves transcription / found / imageRef / metadata untouched on the noticing call", async () => {
    mockOcrAlwaysOk("Wilkins register page 93");
    const dir = await mkdtemp(join(tmpdir(), "imgt-budget-"));
    try {
      for (let i = 1; i <= 20; i++) {
        await imageTranscribeTool({ imageId: img(i), projectPath: dir });
      }
      const result = await imageTranscribeTool({ imageId: img(21), projectPath: dir });

      expect(result.browseBudget?.distinctImagesRead).toBe(21);
      // Everything else is exactly the un-noticed path's output.
      expect(result.transcription).toBe("Wilkins register page 93");
      expect(result.found).toBeUndefined();
      expect(result.imageRef).toBe(`images/${img(21)}.jpg`);
      expect(result.metadata).toEqual({
        imageId: img(21),
        model: MODEL,
        sizeBytes: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("truncation and browseBudget co-occur independently on one read (@yinkid28)", async () => {
    // browseBudget (:359) and truncated (:317) are computed independently; a
    // future refactor must not make them mutually exclusive. Queue 20 complete
    // reads, then a 21st that BOTH trips the budget AND is truncated (FIFO
    // mockResolvedValueOnce, so the length response lands on call 21).
    for (let i = 1; i <= 20; i++) mockOpenRouterOk("page text", "stop");
    mockOpenRouterOk("page 21, cut off", "length");
    for (let i = 1; i <= 20; i++) {
      await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
    }
    const result = await imageTranscribeTool({ imageId: img(21), projectPath: "/p" });
    expect(result.truncated).toBe(true);
    expect(result.truncationNotice).toMatch(/INCOMPLETE/i);
    expect(result.browseBudget?.distinctImagesRead).toBe(21);
    expect(result.browseBudget?.imageGroup).toBe(GROUP);
  });

  it("does not carry the budget to a different image group in the same process", async () => {
    mockOcrAlwaysOk();
    for (let i = 1; i <= 21; i++) {
      await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
    }
    const other = await imageTranscribeTool({ imageId: "999999999_00001", projectPath: "/p" });
    expect(other.browseBudget).toBeUndefined();
  });

  it("keys by project: the same group under a different projectPath starts fresh", async () => {
    mockOcrAlwaysOk();
    for (let i = 1; i <= 21; i++) {
      await imageTranscribeTool({ imageId: img(i), projectPath: "/p1" });
    }
    const p2 = await imageTranscribeTool({ imageId: img(1), projectPath: "/p2" });
    expect(p2.browseBudget).toBeUndefined();
  });

  it("does not advance the count when an already-read image is re-read", async () => {
    mockOcrAlwaysOk();
    for (let i = 1; i <= 20; i++) {
      await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
    }
    // Re-read all 20 — the set does not grow, so still no notice.
    for (let i = 1; i <= 20; i++) {
      const r = await imageTranscribeTool({ imageId: img(i), projectPath: "/p" });
      expect(r.browseBudget).toBeUndefined();
    }
    // The 21st DISTINCT image trips it at exactly 21, proving re-reads did not inflate.
    const r21 = await imageTranscribeTool({ imageId: img(21), projectPath: "/p" });
    expect(r21.browseBudget?.distinctImagesRead).toBe(21);
  });
});
