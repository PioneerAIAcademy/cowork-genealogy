import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { imageTranscribeTool } from "../../src/tools/image-transcribe.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

function mockOpenRouterOk(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message: { content } }] }),
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

  it("reports ark (not imageId) in metadata for ark input", async () => {
    mockOpenRouterOk("some text");
    const result = await imageTranscribeTool({
      ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    });
    expect(result.metadata.ark).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
    expect(result.metadata.imageId).toBeUndefined();
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
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      imageTranscribeTool({ imageId: "004884748_02613" })
    ).rejects.toThrow(/Could not reach OpenRouter/);
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
