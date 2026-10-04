import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir } from "fs/promises";
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
  MAX_OCR_INPUT_BYTES,
  sniffContentType,
} from "../../src/tools/image-transcribe.js";
import {
  sourceImageCapState,
  __clearTruncatedSourceImagesForTests,
} from "../../src/utils/image-store.js";
import { __clearImageBrowseMemoryForTests } from "../../src/utils/browse-budget.js";
import { imageReadTool } from "../../src/tools/image-read.js";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import {
  runWithProjectStore,
  type ProjectStore,
} from "../../src/store/project-store.js";
import type { ImageTranscribeResult } from "../../src/types/image-transcribe.js";

/** The tool's return is `ImageTranscribeResult | NoProjectResult` (#2048); every
 *  test here expects a transcription, so the no-project arm is a failure. */
async function transcribe(
  ...args: Parameters<typeof imageTranscribeTool>
): Promise<ImageTranscribeResult> {
  const r = await imageTranscribeTool(...args);
  if ("ok" in r) throw new Error(`unexpected no-project answer: ${r.errors.join(" ")}`);
  return r;
}

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
  // The image cap's in-process count is module-level and survives across it()
  // blocks; a vi mock reset does not clear it, so reset it explicitly or the cap
  // tests become order-dependent.
  __clearImageBrowseMemoryForTests();
  __clearTruncatedSourceImagesForTests();
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

    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);

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
    expect(result.viewerUrl).toBe(
      "https://www.familysearch.org/search/film/004884748?i=2612"
    );
    expect(result.metadata).toEqual({
      imageId: "004884748_02613",
      contentType: "image/jpeg",
      model: MODEL,
      sizeBytes: 3,
    });
    expect(result.found).toBeUndefined();
  });

  it("saves the scan under images/ and returns imageRef when projectPath is given", async () => {
    mockOpenRouterOk("Johann Schreck");
    const dir = await mkdtemp(join(tmpdir(), "imgt-"));
    try {
      const result = await transcribe({
        imageId: "004884748_02613",
        projectPath: dir,
      }, LOCAL);
      expect(result.imageRef).toBe("images/004884748_02613.jpg");
      const saved = await readFile(join(dir, "images", "004884748_02613.jpg"));
      expect(saved.length).toBe(3); // the 3 mocked fetch bytes
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("transcribes a PDF memory artifact but REFUSES to retain it", async () => {
    // person_read's caller already refuses this (person-read.ts, `retain`), but
    // this tool is reachable straight from the LLM -- projectPath is on its own
    // schema and application/pdf is newly accepted for memoryShape -- and it is
    // exactly the call a budget-skipped memory's note invites. Retaining would
    // write PDF bytes to images/<key>.jpg: unreadable to the viewer, and
    // mis-swept by a GC that globs *.jpg. The TEXT is still the point, so it
    // must still come back.
    fetchFsImageBytesMock.mockResolvedValue({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
      contentType: "application/pdf",
      sizeBytes: 4,
      resolvedUrl: "https://sg30p0.familysearch.org/x/dist.pdf",
    });
    mockOpenRouterOk("Last will and testament of Almon Clegg");
    const dir = await mkdtemp(join(tmpdir(), "imgt-pdf-"));
    try {
      const result = await transcribe({
        memoryArtifactUrl: "https://sg30p0.familysearch.org/x/dist.pdf",
        projectPath: dir,
      }, LOCAL);
      expect(result.transcription).toContain("Last will and testament");
      expect(result.imageRef).toBeUndefined();
      await expect(readFile(join(dir, "images", "x.jpg"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits imageRef when projectPath is not given", async () => {
    mockOpenRouterOk("Johann Schreck");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.imageRef).toBeUndefined();
  });

  it("reports ark (not imageId) in metadata for ark input", async () => {
    mockOpenRouterOk("some text");
    const result = await transcribe({
      ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    }, LOCAL);
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

    const result = await transcribe({ ark: url }, LOCAL);

    expect(fetchFsImageBytesMock.mock.calls[0]).toEqual([
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=112&cc=1858355&groupId=1858355",
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X",
      LOCAL,
      // memoryShape — false for an ark, so the artifact content-type widening
      // and the no-token path stay off for every pre-existing caller.
      false,
    ]);
    expect(result.viewerUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=112&cc=1858355&groupId=1858355",
    );
  });

  it("fetches an unprefixed XXXX-XXXX-XXXX-X id as its 3:1: resolver URL", async () => {
    mockOpenRouterOk("some text");

    await transcribe({ ark: "3QS7-89Q6-89S6-Y" }, LOCAL);

    expect(fetchFsImageBytesMock.mock.calls[0]).toEqual([
      "https://www.familysearch.org/ark:/61903/3:1:3QS7-89Q6-89S6-Y",
      undefined,
      LOCAL,
      false,
    ]);
  });
});

describe("imageTranscribeTool — lookingFor", () => {
  it("sets found=FOUND from the marker and keeps the full transcription", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family\nFOUND");
    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    }, LOCAL);
    expect(result.found).toBe("FOUND");
    expect(result.transcription).toContain("Schreck family");
  });

  it("sets found=NOT FOUND when the marker says so", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Weber\nNOT FOUND");
    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    }, LOCAL);
    expect(result.found).toBe("NOT FOUND");
  });

  it("does not spoof found from body text — only the final-line marker counts", async () => {
    mockOpenRouterOk("Entry: infant found abandoned, no surname given.");
    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    }, LOCAL);
    expect(result.found).toBeUndefined();
  });
});

describe("imageTranscribeTool — output-cap truncation (#1974, spec §6.2)", () => {
  it("flags a finish_reason=length read as truncated with a tool-voiced notice", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: partway down the pag", "length");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBe(true);
    expect(result.truncationNotice).toMatch(/INCOMPLETE/i);
    // The transcription stays verbatim — the notice is a sibling field, never
    // spliced into the OCR text (would re-create the #1975 prose/OCR blend).
    expect(result.transcription).toBe("Row 1: Anna\nRow 2: partway down the pag");
    expect(result.transcription).not.toMatch(/INCOMPLETE/i);
  });

  it("does not flag a finish_reason=stop read as truncated", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBeUndefined();
    expect(result.truncationNotice).toBeUndefined();
  });

  it("suppresses found on a truncated read — a half-read page is never a clean NOT FOUND", async () => {
    mockOpenRouterOk("Row 1: Weber\nRow 2: Braun\nNOT FOUND", "length");
    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    }, LOCAL);
    expect(result.truncated).toBe(true);
    expect(result.found).toBeUndefined();
  });

  it("sends an explicit max_tokens so the cap is ours and reproducible", async () => {
    mockOpenRouterOk("Row 1: Anna");
    await transcribe({ imageId: "004884748_02613" }, LOCAL);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(16000);
  });

  it("catches a cap that a provider surfaces only under native_finish_reason (MAX_TOKENS)", async () => {
    // Top-level finish_reason is "stop"; the cap shows up as the provider's
    // native "MAX_TOKENS". Detection must still flag it.
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "stop", "MAX_TOKENS");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBe(true);
    expect(result.truncationNotice).toMatch(/INCOMPLETE/i);
  });

  it("catches a native_finish_reason=length even when top-level is stop", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "stop", "length");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBe(true);
  });

  it("matches cap markers case-insensitively across both fields (lowercase max_tokens, top-level MAX_TOKENS)", async () => {
    // A model reachable via the openRouterModel override may spell the marker
    // differently or set it on the top-level field. Both must still be caught.
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut", "stop", "max_tokens");
    const lower = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(lower.truncated).toBe(true);

    mockOpenRouterOk("Row 1: Anna\nRow 2: cut", "MAX_TOKENS");
    const topCap = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(topCap.truncated).toBe(true);
  });

  it("does not flag when neither field marks a cap, even with a native stop reason present", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family", "stop", "STOP");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBeUndefined();
  });

  it("does not flag a finish_reason=null read as truncated (@yinkid28)", async () => {
    // The type allows string | null; OpenRouter can send null. null !== any
    // marker, so this must read as a complete, non-truncated success.
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family", null);
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.truncated).toBeUndefined();
    expect(result.found).toBeUndefined();
  });

  it("suppresses a would-be FOUND on a truncated read, not only NOT FOUND (@yinkid28)", async () => {
    // The NOT-FOUND suppression is the harm case, but FOUND must be suppressed
    // too: on a half-read page even a positive marker is untrustworthy.
    mockOpenRouterOk("Row 1: Schreck family\nFOUND", "length");
    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Schreck",
    }, LOCAL);
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
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/output-token limit/i);
  });

  it("still throws the plain empty error when content is empty and no cap fired", async () => {
    mockOpenRouterOk("", "stop");
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/empty transcription/i);
  });

  it("throws the empty error on an empty choices array (@yinkid28)", async () => {
    mockOpenRouterRaw({ choices: [] });
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/empty transcription/i);
  });

  it("truncationNotice pins the safety meaning: remainder UNREAD/not-blank and no absence inference (not just the keyword)", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: cut off", "length");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    const notice = result.truncationNotice ?? "";
    // Required claims.
    expect(notice).toMatch(/unread/i);
    expect(notice).toMatch(/not\s+blank/i);
    expect(notice).toMatch(/not\s+treat\s+any\s+target\s+as\s+absent/i);
    // Forbid the LICENSING construction, not a keyword (@clack391): this fails a
    // notice that appends "it is safe to record a negative finding" while still
    // passing a STRICTER one ("do not record a negative finding from it").
    expect(notice).not.toMatch(
      /\b(safe|safely|okay|fine|acceptable|permissible)\b[^.]{0,40}\b(record|treat|assume|conclude)\b/i
    );
  });

  it("does not crash on a non-string finish_reason — a complete read survives (@yinkid28 W5)", async () => {
    // finish_reason arrives via an unchecked cast; a number/object must not
    // throw in marksCap and misfile a successful read as an error.
    for (const bad of [0, true, {}, ["length"]] as unknown[]) {
      mockOpenRouterRaw({
        choices: [{ message: { content: "Row 1: Anna" }, finish_reason: bad }],
      });
      const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
      expect(result.truncated).toBeUndefined();
      expect(result.transcription).toBe("Row 1: Anna");
    }
  });
});

describe("imageTranscribeTool — records the truncation cap at the call site (#2457)", () => {
  // Pins the cross-tool link the feature rests on: image_transcribe must record
  // the cap against the persisted image so research_append can derive
  // transcription_truncated. Every other test of this feature calls
  // recordImageReadCap directly; this one drives it through the tool, so deleting
  // or inverting the call at image-transcribe.ts fails here rather than nowhere.
  it("a capped read that persists an image records the cap under its imageRef", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: partway down the pag", "length");
    const dir = await mkdtemp(join(tmpdir(), "imgt-cap-"));
    try {
      const result = await transcribe({
        imageId: "004884748_02613",
        projectPath: dir,
      }, LOCAL);
      expect(result.truncated).toBe(true);
      expect(result.imageRef).toBe("images/004884748_02613.jpg");
      // The join research_append performs at the write boundary must now hit.
      expect(sourceImageCapState(dir, result.imageRef!)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an uncapped read records nothing — the image is absent from the add-only cap set (#2457 rulings, C 2026-09-21)", async () => {
    mockOpenRouterOk("Row 1: Anna\nRow 2: Schreck family");
    const dir = await mkdtemp(join(tmpdir(), "imgt-nocap-"));
    try {
      const result = await transcribe({
        imageId: "004884748_02613",
        projectPath: dir,
      }, LOCAL);
      expect(result.truncated).toBeUndefined();
      expect(result.imageRef).toBe("images/004884748_02613.jpg");
      // Add-only: a whole read adds nothing, so the image is not in the set and
      // sourceImageCapState reads false; the derivation persists no marker.
      expect(sourceImageCapState(dir, result.imageRef!)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is sticky-true through the tool: a capped read then a narrower uncapped read of the same image stays partial (#2457 B1 ruling 2026-09-19)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imgt-sticky-"));
    try {
      // Read 1: capped.
      mockOpenRouterOk("Row 1: Anna\nRow 2: partway down the pag", "length");
      const r1 = await transcribe({ imageId: "004884748_02613", projectPath: dir }, LOCAL);
      expect(r1.truncated).toBe(true);
      expect(sourceImageCapState(dir, r1.imageRef!)).toBe(true);
      // Read 2: same image, narrower lookingFor, comes back uncapped — being add-only
      // it records nothing, so it cannot clear read 1's partial.
      mockOpenRouterOk("Anna");
      const r2 = await transcribe({ imageId: "004884748_02613", lookingFor: "Anna", projectPath: dir }, LOCAL);
      expect(r2.truncated).toBeUndefined();
      expect(sourceImageCapState(dir, r2.imageRef!)).toBe(true); // sticky — still partial
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("imageTranscribeTool — key / auth errors", () => {
  it("throws the no-key error and calls neither fetch when no key", async () => {
    getOpenRouterApiKeyMock.mockRejectedValueOnce(
      new Error(
        "No OpenRouter API key is configured. Tell the user to add their key to config.json."
      )
    );
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/No OpenRouter API key/);
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps a 401 to a re-configure instruction", async () => {
    mockOpenRouterStatus(401);
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/rejected \(401\)/);
  });

  it("sends the 401 to the config file, never to the chat", async () => {
    mockOpenRouterStatus(401);
    const message = await transcribe({
      imageId: "004884748_02613",
    }, LOCAL).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e))
    );
    // The rejected key is replaced in config.json, so the instruction must
    // name that file and must not route a fresh key through a tool call.
    expect(message).toContain("~/.familysearch-mcp/config.json");
    expect(message).not.toMatch(/configure_openrouter/i);
    expect(message).not.toMatch(/\b(?:ask|paste|send|share|enter)\b/i);
  });

  it("maps a 402 to an out-of-credits message", async () => {
    mockOpenRouterStatus(402);
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/out of credits \(402\)/);
  });
});

describe("imageTranscribeTool — OpenRouter failures", () => {
  it("throws a clean error on a non-2xx response", async () => {
    mockOpenRouterStatus(500, "upstream boom");
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/OpenRouter OCR failed: 500/);
  });

  it("throws a friendly error when OpenRouter is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/Could not reach OpenRouter/);
  });

  // #1594: one bounded retry on a TRANSPORT failure. On the run that motivated
  // it, two consecutive losses led the agent to declare the OCR route
  // "network-unreachable in this environment", abandon images for the rest of
  // the run, and conclude from an indexed namesake instead.
  it("retries a transport failure once and returns the retry's transcription", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockOpenRouterOk("Anno 1762, Henckelstorp");

    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);

    expect(result.transcription).toBe("Anno 1762, Henckelstorp");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries at most once, and says so when the retry also fails", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
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
      transcribe({ imageId: "004884748_02613" }, LOCAL)
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
      transcribe({ imageId: "004884748_02613" }, LOCAL)
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
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/Could not reach OpenRouter.*ENOTFOUND/s);
  });

  it("throws rather than fabricate on empty OCR content", async () => {
    mockOpenRouterOk("   ");
    await expect(
      transcribe({ imageId: "004884748_02613" }, LOCAL)
    ).rejects.toThrow(/empty transcription/i);
  });
});

describe("imageTranscribeTool — input validation", () => {
  it("rejects when neither imageId nor ark is given (before any fetch)", async () => {
    await expect(transcribe({}, LOCAL)).rejects.toThrow(
      /image_transcribe requires one of imageId, ark, memoryArtifactUrl, or file/
    );
    expect(getOpenRouterApiKeyMock).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects when both imageId and ark are given", async () => {
    await expect(
      transcribe({
        imageId: "004884748_02613",
        ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
      }, LOCAL)
    ).rejects.toThrow(/exactly one of imageId, ark, memoryArtifactUrl, or file — not imageId and ark/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("imageTranscribeTool — hard image cap (#3010, spec §5.8)", () => {
  const GROUP = "004261111";
  const img = (seq: number) => `${GROUP}_${String(seq).padStart(5, "0")}`;
  let project: string;

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

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "imgt-cap-"));
    await writeFile(join(project, "research.json"), "{}");
    mockOcrAlwaysOk();
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  async function readTwenty(projectPath: string) {
    for (let i = 1; i <= 20; i++) await transcribe({ imageId: img(i), projectPath }, LOCAL);
  }

  it("refuses the 21st distinct image before fetching it, naming the group, the link and the actions", async () => {
    await readTwenty(project);
    fetchFsImageBytesMock.mockClear();
    mockFetch.mockClear();

    const err = await imageTranscribeTool({ imageId: img(21), projectPath: project }, LOCAL).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(GROUP);
    expect(msg).toContain("20 distinct images");
    expect(msg).toContain(`https://www.familysearch.org/search/film/${GROUP}?i=20`);
    expect(msg).toContain("partial");
    expect(msg).toContain("research_log_append");
    expect(msg).toContain("final summary");
    expect(msg).toContain("run volume_bisect first, then read the narrowed range");
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shares one count with image_read: 10 reads + 11 transcriptions, the 21st refuses", async () => {
    for (let i = 1; i <= 20; i++) {
      if (i % 2 === 0) await imageReadTool({ imageId: img(i), projectPath: project }, LOCAL);
      else await transcribe({ imageId: img(i), projectPath: project }, LOCAL);
    }
    fetchFsImageBytesMock.mockClear();
    await expect(imageTranscribeTool({ imageId: img(21), projectPath: project }, LOCAL)).rejects.toThrow(
      /Image cap reached/,
    );
    await expect(imageReadTool({ imageId: img(22), projectPath: project }, LOCAL)).rejects.toThrow(/Image cap reached/);
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
  });

  it("re-reading one of the first 20 still works, and an image read by both tools counts once", async () => {
    await imageReadTool({ imageId: img(1), projectPath: project }, LOCAL);
    await readTwenty(project);
    const again = await transcribe({ imageId: img(7), projectPath: project }, LOCAL);
    expect(again.transcription).toBe("page text");
  });

  it("still refuses after a restart: the count is read back from the project's log", async () => {
    await readTwenty(project);
    __clearImageBrowseMemoryForTests();
    await expect(imageTranscribeTool({ imageId: img(21), projectPath: project }, LOCAL)).rejects.toThrow(
      /Image cap reached/,
    );
    const log = await readFile(join(project, "results", "image-browse.jsonl"), "utf-8");
    const lines = log.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toMatchObject({ image_group: GROUP, image_id: img(1), tool: "image_transcribe" });
  });

  it("a re-read writes no second log line", async () => {
    await readTwenty(project);
    await transcribe({ imageId: img(3), projectPath: project }, LOCAL);
    const log = await readFile(join(project, "results", "image-browse.jsonl"), "utf-8");
    expect(log.trim().split("\n")).toHaveLength(20);
  });

  it("a failed log write never fails the read, and the in-process count still refuses", async () => {
    const real = new FsProjectStore();
    const failingAppend = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      appendText: async () => {
        throw new Error("S3 down");
      },
    }) as ProjectStore;
    await runWithProjectStore(failingAppend, async () => {
      await readTwenty(project);
      await expect(imageTranscribeTool({ imageId: img(21), projectPath: project }, LOCAL)).rejects.toThrow(
        /Image cap reached/,
      );
    });
    await expect(readFile(join(project, "results", "image-browse.jsonl"), "utf-8")).rejects.toThrow();
  });

  it("a failed fetch does not advance the count", async () => {
    for (let i = 1; i <= 19; i++) await transcribe({ imageId: img(i), projectPath: project }, LOCAL);
    fetchFsImageBytesMock.mockRejectedValueOnce(new Error("FamilySearch image fetch failed: 503"));
    await expect(imageTranscribeTool({ imageId: img(20), projectPath: project }, LOCAL)).rejects.toThrow(/503/);
    const r = await transcribe({ imageId: img(21), projectPath: project }, LOCAL);
    expect(r.transcription).toBe("page text");
  });

  it("the same group under a different projectPath starts fresh", async () => {
    await readTwenty(project);
    const other = await mkdtemp(join(tmpdir(), "imgt-cap-other-"));
    try {
      await writeFile(join(other, "research.json"), "{}");
      const r = await transcribe({ imageId: img(21), projectPath: other }, LOCAL);
      expect(r.transcription).toBe("page text");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("does not carry the count to a different image group", async () => {
    await readTwenty(project);
    const r = await transcribe({ imageId: "999999999_00001", projectPath: project }, LOCAL);
    expect(r.transcription).toBe("page text");
  });

  it("an unreadable log line is skipped, and a non-project folder counts in memory without writing the log", async () => {
    await mkdir(join(project, "results"), { recursive: true });
    await writeFile(join(project, "results", "image-browse.jsonl"), "{not json\n");
    await readTwenty(project);
    await expect(imageTranscribeTool({ imageId: img(21), projectPath: project }, LOCAL)).rejects.toThrow(
      /Image cap reached/,
    );

    const notProject = await mkdtemp(join(tmpdir(), "imgt-cap-noproj-"));
    try {
      await readTwenty(notProject);
      await expect(imageTranscribeTool({ imageId: img(21), projectPath: notProject }, LOCAL)).rejects.toThrow(
        /Image cap reached/,
      );
      // results/.staging may exist (image_transcribe stages its text); the cap's log must not.
      expect(await readdir(join(notProject, "results")).catch(() => [])).not.toContain("image-browse.jsonl");
    } finally {
      await rm(notProject, { recursive: true, force: true });
    }
  });

  it("with no projectPath on the file backend, counts in memory and still refuses within the process", async () => {
    for (let i = 1; i <= 20; i++) await transcribe({ imageId: img(i) }, LOCAL);
    await expect(imageTranscribeTool({ imageId: img(21) }, LOCAL)).rejects.toThrow(/Image cap reached/);
  });

  it("a read without projectPath does not get a second 20 on the file backend, in either order", async () => {
    await readTwenty(project);
    await expect(imageTranscribeTool({ imageId: img(21) }, LOCAL)).rejects.toThrow(/Image cap reached/);

    __clearImageBrowseMemoryForTests();
    const fresh = await mkdtemp(join(tmpdir(), "imgt-cap-fresh-"));
    try {
      await writeFile(join(fresh, "research.json"), "{}");
      for (let i = 1; i <= 20; i++) await transcribe({ imageId: img(i) }, LOCAL);
      await expect(imageTranscribeTool({ imageId: img(21), projectPath: fresh }, LOCAL)).rejects.toThrow(
        /Image cap reached/,
      );
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("counts a DGS distribution URL passed as ark, which embeds its imageId", async () => {
    await readTwenty(project);
    const dgs = `https://familysearch.org/das/v2/dgs:${img(21)}/dist.jpg`;
    await expect(imageTranscribeTool({ ark: dgs, projectPath: project }, LOCAL)).rejects.toThrow(/Image cap reached/);
    const again = await transcribe({ ark: `https://familysearch.org/das/v2/dgs:${img(5)}/dist.jpg`, projectPath: project }, LOCAL);
    expect(again.transcription).toBe("page text");
  });

  it("does not count ark-only reads", async () => {
    await readTwenty(project);
    const r = await transcribe({ ark: "https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/3:1:3QS7-L9S9-ABCD/$dist", projectPath: project }, LOCAL);
    expect(r.transcription).toBe("page text");
  });

  it("isolates patrons under a shared-process store binding — same anchor path, different projectId (#2771)", async () => {
    // Under http.ts every request presents the SAME anchor projectPath (`/project`);
    // the bound store's projectId is the real identity. This method-less store
    // cannot classify, so the cap counts in memory keyed by projectId.
    const store = (projectId: string) => ({ projectId }) as unknown as ProjectStore;

    await runWithProjectStore(store("proj-A"), async () => {
      for (let i = 1; i <= 20; i++) await transcribe({ imageId: img(i), projectPath: "/project" }, LOCAL);
      await expect(imageTranscribeTool({ imageId: img(21), projectPath: "/project" }, LOCAL)).rejects.toThrow(
        /Image cap reached/,
      );
    });

    await runWithProjectStore(store("proj-B"), async () => {
      const rB = await transcribe({ imageId: img(21), projectPath: "/project" }, LOCAL);
      expect(rB.transcription).toBe("page text");
      // A bare call (no projectPath) under B must not see A's reads either: the
      // no-path union is for the file backend only, never across bound projects.
      const bare = await transcribe({ imageId: img(23) }, LOCAL);
      expect(bare.transcription).toBe("page text");
    });

    await runWithProjectStore(store("proj-A"), async () => {
      await expect(imageTranscribeTool({ imageId: img(22), projectPath: "/project" }, LOCAL)).rejects.toThrow(
        /Image cap reached/,
      );
    });

    // A header-less request binds a store with no projectId. Its bare call pools
    // the unbound counts, but never a bound patron's — A's 20 stay A's.
    const unbound = {} as unknown as ProjectStore;
    await runWithProjectStore(unbound, async () => {
      const r = await transcribe({ imageId: img(24) }, LOCAL);
      expect(r.transcription).toBe("page text");
    });
  });
});

describe("imageTranscribeTool — given-name expansion in lookingFor (issue #607)", () => {
  it("expands a recognized given name in the OCR prompt", async () => {
    mockOpenRouterOk("Betty Martin, christened 1 November 1812\nFOUND");

    await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Elizabeth Martin",
    }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt: string = body.messages[0].content[0].text;
    // The prompt should include variant forms
    expect(prompt).toContain("also known as");
    expect(prompt).toContain("Betty");
    expect(prompt).toContain("Bess");
  });

  it("does not expand when lookingFor has no recognized given name", async () => {
    mockOpenRouterOk("Patrick Flynn, witness\nFOUND");

    await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Patrick Flynn",
    }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt: string = body.messages[0].content[0].text;
    // No expansion — bare name only
    expect(prompt).not.toContain("also known as");
    expect(prompt).toContain('"Patrick Flynn"');
  });

  it("FOUND/NOT FOUND parsing still works with expanded prompt", async () => {
    mockOpenRouterOk("Betty Martin, christened 1812\nFOUND");

    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Elizabeth Martin",
    }, LOCAL);

    expect(result.found).toBe("FOUND");
  });

  it("leaves the prompt unchanged when lookingFor is absent", async () => {
    mockOpenRouterOk("Johann Schreck, b. 1801, Bayern");

    await transcribe({ imageId: "004884748_02613" }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt: string = body.messages[0].content[0].text;
    expect(prompt).not.toContain("also known as");
    expect(prompt).not.toContain("FOUND or NOT FOUND");
  });

  it("includes nameExpansion in response when expansion fires", async () => {
    mockOpenRouterOk("Betty Martin, christened 1 November 1812\nFOUND");

    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Elizabeth Martin",
    }, LOCAL);

    expect(result.nameExpansion).toBeDefined();
    expect(result.nameExpansion!.original).toBe("Elizabeth Martin");
    expect(result.nameExpansion!.expanded).toContain("also known as");
    expect(result.nameExpansion!.expansions).toHaveProperty("Elizabeth");
  });

  it("omits nameExpansion when no recognized given name", async () => {
    mockOpenRouterOk("Patrick Flynn, witness\nFOUND");

    const result = await transcribe({
      imageId: "004884748_02613",
      lookingFor: "Patrick Flynn",
    }, LOCAL);

    expect(result.nameExpansion).toBeUndefined();
  });

  it("omits nameExpansion when lookingFor is absent", async () => {
    mockOpenRouterOk("Johann Schreck, b. 1801, Bayern");

    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);

    expect(result.nameExpansion).toBeUndefined();
  });
});

/**
 * Memory artifacts — issue #1689 acceptance 12.
 *
 * The retry route for a memory the person_read budget skipped, the filter
 * missed, or the OCR failed on.
 */
describe("imageTranscribeTool — memory artifacts", () => {
  const ARTIFACT =
    "https://sg30p0.familysearch.org/ark:/61903/3:1:ABCD/v2/12345/dist.jpg?ctx=x";

  it("accepts a memory artifact URL and returns its text", async () => {
    mockOpenRouterOk("Last Will and Testament of Almon G. Clegg");
    const result = await transcribe({ memoryArtifactUrl: ARTIFACT }, LOCAL);
    expect(result.transcription).toBe("Last Will and Testament of Almon G. Clegg");
    // passed through untouched, and flagged as the memory shape so the fetcher
    // skips the token and accepts a PDF
    expect(fetchFsImageBytesMock.mock.calls[0]).toEqual([
      ARTIFACT,
      undefined,
      LOCAL,
      true,
    ]);
  });

  it("transcribes a memory PDF", async () => {
    fetchFsImageBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      sizeBytes: 3,
      resolvedUrl: ARTIFACT,
    });
    mockOpenRouterOk("Things I learned From My Father");
    const result = await transcribe(
      { memoryArtifactUrl: ARTIFACT.replace("dist.jpg", "dist.pdf") },
      LOCAL,
    );
    expect(result.transcription).toBe("Things I learned From My Father");
    // the data URL must carry the PDF media type, not a hardcoded image one
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content[1].image_url.url).toMatch(
      /^data:application\/pdf;base64,/,
    );
  });

  it("refuses an artifact URL on another host before any fetch", async () => {
    await expect(
      imageTranscribeTool(
        { memoryArtifactUrl: "https://evil.example.com/v2/1/dist.jpg" },
        LOCAL,
      ),
    ).rejects.toThrow(/Unrecognized memoryArtifactUrl/);
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
  });
});

// ─── issue #2048: uploaded files, the payload cap, and the staging channel ───

/** A directory that classifies as a project (both files), with `uploads/`. */
async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "imgt-file-"));
  await writeFile(join(dir, "research.json"), "{}");
  await writeFile(join(dir, "tree.gedcomx.json"), "{}");
  await mkdir(join(dir, "uploads"));
  return dir;
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function sentDataUrl(): string {
  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  return body.messages[0].content.find((p: any) => p.type === "image_url").image_url.url;
}

describe("imageTranscribeTool — `file` input (#2048)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeProject();
    getOpenRouterApiKeyMock.mockResolvedValue("sk-test");
    getOpenRouterModelMock.mockResolvedValue(MODEL);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("transcribes an uploaded JPEG by project-relative `file` with no FamilySearch fetch and no token", async () => {
    await writeFile(join(dir, "uploads", "ancestry-scan.jpg"), JPEG);
    mockOpenRouterOk("Mays, David Albert — father: William");
    const result = await transcribe({ file: "uploads/ancestry-scan.jpg", projectPath: dir }, LOCAL);

    expect(result.transcription).toBe("Mays, David Albert — father: William");
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled(); // the FS leg (and its getValidToken) never runs
    expect(sentDataUrl()).toBe(`data:image/jpeg;base64,${JPEG.toString("base64")}`);
    expect(result.metadata).toEqual({
      file: "uploads/ancestry-scan.jpg",
      contentType: "image/jpeg",
      model: MODEL,
      sizeBytes: JPEG.length,
    });
    // Already retained at its own path — no copy under images/, no imageRef.
    expect(result.imageRef).toBeUndefined();
    // No FamilySearch viewer URL for uploaded files (issue #2854).
    expect(result.viewerUrl).toBeUndefined();
    await expect(readdir(join(dir, "images"))).rejects.toThrow();
  });

  it("sends an uploaded PDF as application/pdf — the type is the file's bytes, not its name", async () => {
    await writeFile(join(dir, "uploads", "record.jpg"), PDF); // misnamed on purpose
    mockOpenRouterOk("Last will and testament of John Mays");
    const result = await transcribe({ file: "uploads/record.jpg", projectPath: dir }, LOCAL);
    expect(sentDataUrl().startsWith("data:application/pdf;base64,")).toBe(true);
    expect(result.metadata.contentType).toBe("application/pdf");
  });

  it("reads PNG too, and refuses a file that is neither an image nor a PDF without calling OpenRouter", async () => {
    await writeFile(join(dir, "uploads", "chart.png"), PNG);
    mockOpenRouterOk("a chart");
    expect((await transcribe({ file: "uploads/chart.png", projectPath: dir }, LOCAL)).metadata.contentType).toBe("image/png");

    mockFetch.mockReset();
    await writeFile(join(dir, "uploads", "notes.txt"), "just some notes");
    await expect(transcribe({ file: "uploads/notes.txt", projectPath: dir }, LOCAL)).rejects.toThrow(
      /not an image or a PDF \(by its content, not its name\).*sidecar_read/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("names a missing file, and rejects a directory", async () => {
    await expect(transcribe({ file: "uploads/nope.jpg", projectPath: dir }, LOCAL)).rejects.toThrow(
      /'uploads\/nope.jpg' was not found under the project folder/,
    );
    await expect(transcribe({ file: "uploads", projectPath: dir }, LOCAL)).rejects.toThrow(/is a directory/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/etc/passwd", /absolute path/],
    ["C:/scans/x.jpg", /absolute path/],
    ["uploads\\x.jpg", /backslash/],
    ["uploads/../research.json", /'\.' or '\.\.' segment/],
    ["uploads//x.jpg", /segment/],
    ["", /requires one of imageId, ark, memoryArtifactUrl, or file/], // empty = not provided
  ])("rejects the ref shape %s before any I/O", async (file, pattern) => {
    await expect(transcribe({ file, projectPath: dir }, LOCAL)).rejects.toThrow(pattern);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a ref that escapes the project through a symlink (the store's containment guard)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "imgt-outside-"));
    try {
      await writeFile(join(outside, "secret.jpg"), JPEG);
      const { symlink } = await import("fs/promises");
      // A directory junction, not a file symlink: Windows creates one without Developer Mode.
      await symlink(outside, join(dir, "uploads", "link"), "junction");
      await expect(transcribe({ file: "uploads/link/secret.jpg", projectPath: dir }, LOCAL)).rejects.toThrow(
        /escapes the project directory/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("requires projectPath with `file`, using the shared loud messages", async () => {
    await expect(transcribe({ file: "uploads/x.jpg" }, LOCAL)).rejects.toThrow(/projectPath is required/);
    await expect(
      transcribe({ file: "uploads/x.jpg", projectPath: join(dir, "no-such-folder") }, LOCAL),
    ).rejects.toThrow(/projectPath does not exist/);
  });

  it("answers no_project (not an error) for a folder holding neither project file", async () => {
    const plain = await mkdtemp(join(tmpdir(), "imgt-plain-"));
    try {
      const r = await imageTranscribeTool({ file: "uploads/x.jpg", projectPath: plain }, LOCAL);
      expect(r).toMatchObject({ ok: false, reason: "no_project" });
      expect(getOpenRouterApiKeyMock).not.toHaveBeenCalled();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("rejects two input forms, `file` included", async () => {
    await expect(
      transcribe({ file: "uploads/x.jpg", imageId: "004884748_02613", projectPath: dir }, LOCAL),
    ).rejects.toThrow(/exactly one of imageId, ark, memoryArtifactUrl, or file — not imageId and file/);
  });
});

describe("imageTranscribeTool — payload cap (#2048, spec §7)", () => {
  beforeEach(() => {
    getOpenRouterApiKeyMock.mockResolvedValue("sk-test");
    getOpenRouterModelMock.mockResolvedValue(MODEL);
  });

  it("refuses an uploaded file over MAX_OCR_INPUT_BYTES before calling OpenRouter, naming the remedy", async () => {
    const dir = await makeProject();
    try {
      const big = Buffer.alloc(MAX_OCR_INPUT_BYTES + 1, 0x00);
      JPEG.copy(big, 0);
      await writeFile(join(dir, "uploads", "huge.jpg"), big);
      await expect(transcribe({ file: "uploads/huge.jpg", projectPath: dir }, LOCAL)).rejects.toThrow(
        /14\.0 MiB, over the 14 MiB.*not sent.*lower quality/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies the same cap to a FamilySearch scan (wiring — nothing in the corpus is that large)", async () => {
    fetchFsImageBytesMock.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      sizeBytes: 15 * 1024 * 1024,
    });
    await expect(transcribe({ imageId: "004884748_02613" }, LOCAL)).rejects.toThrow(/over the 14 MiB/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("MAX_OCR_INPUT_BYTES base64-encodes under the documented 20 MB request limit", () => {
    expect(Math.ceil((MAX_OCR_INPUT_BYTES / 3) * 4)).toBeLessThan(20_000_000);
    expect(MAX_OCR_INPUT_BYTES).toBe(14 * 1024 * 1024);
  });
});

describe("sniffContentType", () => {
  it.each([
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [Buffer.from("GIF89a......"), "image/gif"],
    [Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]), "image/webp"],
    [PDF, "application/pdf"],
    [Buffer.from("plain text"), null],
    [Buffer.alloc(0), null],
  ])("classifies %o as %s", (bytes, expected) => {
    expect(sniffContentType(new Uint8Array(bytes))).toBe(expected);
  });
});

describe("imageTranscribeTool — staging producer (#2489 via #2048)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeProject();
    getOpenRouterApiKeyMock.mockResolvedValue("sk-test");
    getOpenRouterModelMock.mockResolvedValue(MODEL);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stages the transcription and returns a non-null staged.resultsRef with a one-element results[]", async () => {
    await writeFile(join(dir, "uploads", "obit.jpg"), JPEG);
    mockOpenRouterOk("Obituary text\nFOUND");
    const result = await transcribe(
      { file: "uploads/obit.jpg", projectPath: dir, lookingFor: "Mays" },
      LOCAL,
    );

    expect(result.staged).not.toBeNull();
    expect(result.staged!.resultsRef).toMatch(/^results\/\.staging\/[0-9a-f-]+\.json$/);
    expect(result.staged!.returnedCount).toBe(1);
    expect(result.stagingError).toBeUndefined();

    const envelope = JSON.parse(await readFile(join(dir, result.staged!.resultsRef), "utf8"));
    expect(envelope.tool).toBe("image_transcribe");
    expect(envelope.returned_count).toBe(1);
    expect(envelope.payload.query).toEqual({ file: "uploads/obit.jpg", lookingFor: "Mays" });
    expect(envelope.payload.results).toHaveLength(1);
    expect(envelope.payload.results[0]).toMatchObject({
      id: "capture:obit",
      source: { file: "uploads/obit.jpg" },
      content_type: "image/jpeg",
      size_bytes: JPEG.length,
      model: MODEL,
      transcription: "Obituary text\nFOUND",
      found: "FOUND",
    });

    expect(result.digest).toEqual({
      id: "capture:obit",
      chars: "Obituary text\nFOUND".length,
      excerpt: "Obituary text\nFOUND",
      found: "FOUND",
    });
  });

  it("stages a FamilySearch read too, keyed by its imageId, alongside the retained scan", async () => {
    mockOpenRouterOk("Johann Schreck");
    const result = await transcribe({ imageId: "004884748_02613", projectPath: dir }, LOCAL);
    expect(result.staged).not.toBeNull();
    expect(result.imageRef).toBe("images/004884748_02613.jpg");
    const envelope = JSON.parse(await readFile(join(dir, result.staged!.resultsRef), "utf8"));
    expect(envelope.payload.results[0]).toMatchObject({
      id: "004884748_02613",
      source: { imageId: "004884748_02613" },
    });
    expect(result.digest?.id).toBe("004884748_02613");
  });

  it("bounds the digest excerpt and carries the truncation marker", async () => {
    await writeFile(join(dir, "uploads", "long.jpg"), JPEG);
    const long = "x".repeat(1_000);
    mockOpenRouterOk(long, "length");
    const result = await transcribe({ file: "uploads/long.jpg", projectPath: dir }, LOCAL);
    expect(result.digest).toEqual({ id: "capture:long", chars: 1_000, excerpt: "x".repeat(300), truncated: true });
    const envelope = JSON.parse(await readFile(join(dir, result.staged!.resultsRef), "utf8"));
    expect(envelope.payload.results[0].truncated).toBe(true);
  });

  it("does not stage or digest without projectPath", async () => {
    mockOpenRouterOk("Johann Schreck");
    const result = await transcribe({ imageId: "004884748_02613" }, LOCAL);
    expect(result.staged).toBeUndefined();
    expect(result.digest).toBeUndefined();
  });

  it("a staging failure is non-fatal: the text still returns, with staged: null and the reason", async () => {
    await writeFile(join(dir, "uploads", "scan.jpg"), JPEG);
    await writeFile(join(dir, "results"), "not a directory"); // results/.staging cannot be created
    mockOpenRouterOk("still read");
    const result = await transcribe({ file: "uploads/scan.jpg", projectPath: dir }, LOCAL);
    expect(result.transcription).toBe("still read");
    expect(result.staged).toBeNull();
    expect(result.stagingError).toMatch(/ENOTDIR|not a directory|EEXIST/i);
    expect(result.digest?.id).toBe("capture:scan");
  });
});


describe("imageTranscribeTool — a Memories PAGE url (#2987)", () => {
  const PAGE = "https://www.familysearch.org/photos/artifacts/117201348";
  const ABOUT =
    "https://sg30p0.familysearch.org/service/records/storage/dascloud/patron/v2/TH-7768-103723-9979-62/dist.jpg?ctx=ArtCtxPublic";

  /** The Memories lookup is a plain `fetch`, so it lands on the same global
   *  stub as the OpenRouter call — first call is the lookup, second the OCR. */
  function mockLookupThenOcr(text: string): void {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sourceDescriptions: [{ about: ABOUT }] }), { status: 200 }),
    );
    mockOpenRouterOk(text);
  }

  it("7. resolves the page url, fetches the RESOLVED url, and records both", async () => {
    mockLookupThenOcr("1468 Anthony Amend with Mary Hales");

    const result = await transcribe({ memoryArtifactUrl: PAGE }, LOCAL);

    // Fetched the resolved artifact url, with memoryShape preserved.
    const [url, , , memoryShape] = fetchFsImageBytesMock.mock.calls[0];
    expect(url).toBe(ABOUT);
    expect(memoryShape, "memoryShape must survive so the PDF path still works").toBe(true);
    expect(result.transcription).toContain("1468");
  });

  it("7b. a page-url read and a direct-url read key the same scan", async () => {
    // `label` is deliberately the RESOLVED url: it feeds imageKey, so reading
    // one artifact by page url and by direct url must not retain the scan
    // twice. Asserted through the arguments, since imageRef needs a project.
    mockLookupThenOcr("text");
    await transcribe({ memoryArtifactUrl: PAGE }, LOCAL);
    const viaPage = fetchFsImageBytesMock.mock.calls[0][0];

    fetchFsImageBytesMock.mockClear();
    mockFetch.mockReset();
    mockOpenRouterOk("text");
    await transcribe({ memoryArtifactUrl: ABOUT }, LOCAL);
    const viaDirect = fetchFsImageBytesMock.mock.calls[0][0];

    expect(viaPage).toBe(viaDirect);
  });

  it("8. refuses a url that merely contains a FamilySearch page url, before any fetch", async () => {
    mockFetch.mockReset();
    await expect(
      imageTranscribeTool({ memoryArtifactUrl: `https://evil.example.com/r?u=${PAGE}` }, LOCAL),
      // The ONE message this path produces. An alternation over both candidate
      // messages passed whichever fired, which is exactly what hid the fact
      // that the other one is unreachable from here.
    ).rejects.toThrow(/Unrecognized memoryArtifactUrl/);
    expect(mockFetch, "a rejected host must never be looked up").not.toHaveBeenCalled();
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
  });

  it("9. surfaces the resolver's own actionable error, not the generic one", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(imageTranscribeTool({ memoryArtifactUrl: PAGE }, LOCAL)).rejects.toThrow(
      /Memories lookup failed \(404\)/,
    );
    expect(fetchFsImageBytesMock).not.toHaveBeenCalled();
  });

  it("7c. stages the PAGE url as the source, keyed by the RESOLVED url", async () => {
    // The two §3 value choices, asserted on the persisted staging envelope —
    // the only place they are observable. `source` records what the agent
    // passed, so research_log_append cites the url the researcher will
    // recognise; `id` is the resolved artifact url, so a page-url read and a
    // direct-url read of one artifact dedupe to the same retained scan.
    const dir = await makeProject();
    try {
      mockLookupThenOcr("1468 Anthony Amend with Mary Hales");
      const result = await transcribe({ memoryArtifactUrl: PAGE, projectPath: dir }, LOCAL);

      expect(result.staged).not.toBeNull();
      const envelope = JSON.parse(
        await readFile(join(dir, result.staged!.resultsRef), "utf8"),
      );
      const staged = envelope.payload.results[0];
      expect(staged.source.memoryArtifactUrl, "staging records what the agent passed").toBe(PAGE);
      expect(staged.id, "the scan is keyed by the resolved artifact url").toBe(ABOUT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the resolved artifact url so a second read skips the lookup", async () => {
    // person_read's spec tells readers artifact_url "saves the lookup". Without
    // this the one caller that just performed the lookup is the only one who
    // cannot benefit from it, and a re-read repeats the round trip.
    mockLookupThenOcr("text");
    const result = await transcribe({ memoryArtifactUrl: PAGE }, LOCAL);
    expect(result.metadata.memoryArtifactUrl).toBe(ABOUT);
  });

  it("does not invent a memoryArtifactUrl for a direct artifact url", async () => {
    mockFetch.mockReset();
    mockOpenRouterOk("direct");
    const result = await transcribe({ memoryArtifactUrl: ABOUT }, LOCAL);
    expect(result.metadata.memoryArtifactUrl).toBeUndefined();
  });

  it("leaves a DIRECT artifact url alone — no lookup at all", async () => {
    mockFetch.mockReset();
    mockOpenRouterOk("direct");
    await transcribe({ memoryArtifactUrl: ABOUT }, LOCAL);
    expect(fetchFsImageBytesMock.mock.calls[0][0]).toBe(ABOUT);
    // Only the OCR call; the resolver was never entered.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
