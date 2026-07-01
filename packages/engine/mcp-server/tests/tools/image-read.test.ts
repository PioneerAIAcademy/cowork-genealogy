import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { imageReadTool } from "../../src/tools/image-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockImageResponse(bytes?: Uint8Array) {
  const pixel = bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "image/jpeg" : null,
    },
    arrayBuffer: async () => pixel.buffer,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imageReadTool — imageId input", () => {
  it("builds the DGS URL from imageId and fetches it", async () => {
    mockImageResponse();

    const result = await imageReadTool({ imageId: "004884748_02613" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg"
    );
    expect(result.metadata.url).toBe(
      "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg"
    );
    expect(result.metadata.mimeType).toBe("image/jpeg");
  });

  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockImageResponse();

    await imageReadTool({ imageId: "004884748_02613" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });

  it("rejects an image that exceeds the inline size cap", async () => {
    // 700 KB is the cap; 800 KB would base64-inflate past the ~1 MiB MCP
    // transport buffer and crash the session, so the tool must refuse it.
    mockImageResponse(new Uint8Array(800_000));

    await expect(imageReadTool({ imageId: "004884748_02613" })).rejects.toThrow(
      /too large to return inline/i
    );
  });

  it("returns an image sitting just under the size cap", async () => {
    mockImageResponse(new Uint8Array(699_999));

    const result = await imageReadTool({ imageId: "004884748_02613" });

    expect(result.metadata.sizeBytes).toBe(699_999);
    expect(result.imageData.length).toBeGreaterThan(0);
  });

  it.each([
    ["abc", "non-numeric"],
    ["123", "missing underscore"],
    ["123_", "missing second number"],
    ["_456", "missing first number"],
    ["123_456_789", "extra segment"],
    [
      "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg",
      "a full URL",
    ],
    [
      "https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/abc/$dist",
      "an ARK URL",
    ],
  ])("rejects %j (%s) without fetching", async (imageId) => {
    await expect(imageReadTool({ imageId })).rejects.toThrow(
      /Unrecognized.*imageId/i
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
