import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  resolveFsImageInput,
  fetchFsImageBytes,
} from "../../src/utils/fs-image-fetch.js";
import { getValidToken } from "../../src/auth/refresh.js";

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

function mockHtmlResponse() {
  // What FamilySearch returns for an out-of-range i= on a single-image ARK:
  // a 200, but an HTML page instead of image bytes.
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "text/html" : null,
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
}

function mockErrorResponse(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
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

describe("resolveFsImageInput — ark URL query-param forwarding", () => {
  // Some 3:1:/3:2: ARKs are waypoints into a multi-image film/register — the
  // bare ARK can resolve to the wrong image within that group. FamilySearch's
  // own browser URL disambiguates with i=/cc=/groupId= query params, which
  // must be forwarded onto the resolved URL image_read/image_transcribe
  // actually fetch. A fallback (the same ARK without those params) is offered
  // whenever params were forwarded, so fetchFsImageBytes can recover if
  // forwarding them turns out to be wrong for this particular ARK.
  it("forwards i/cc/groupId from a full page URL, and offers a fallback without them", () => {
    const url =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en&i=112&cc=1858355&groupId=1858355";

    const result = resolveFsImageInput({ ark: url }, "test");

    expect(result.url).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=112&cc=1858355&groupId=1858355"
    );
    expect(result.fallbackUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X"
    );
  });

  it("drops irrelevant query params, keeping only i/cc/groupId", () => {
    const url =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en&i=112";

    const result = resolveFsImageInput({ ark: url }, "test");

    expect(result.url).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=112"
    );
  });

  it("adds no query string and no fallback when a full URL carries no image-context params", () => {
    const url = "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en";

    const result = resolveFsImageInput({ ark: url }, "test");

    expect(result.url).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X"
    );
    expect(result.fallbackUrl).toBeUndefined();
  });

  it("adds no query string and no fallback for a bare ARK (no URL to carry context)", () => {
    const result = resolveFsImageInput(
      { ark: "ark:/61903/3:1:9392-9ZVZ-X" },
      "test"
    );

    expect(result.url).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X"
    );
    expect(result.fallbackUrl).toBeUndefined();
  });
});

describe("fetchFsImageBytes — fallback retry", () => {
  // Regression coverage for the review finding on #1203: forwarding i=/cc=/
  // groupId= unconditionally broke single-image documents where i= is out of
  // range — FamilySearch returns HTML (200, wrong content-type), not an
  // error, so the only way to recover is to retry without the params.
  it("retries the fallback URL when the primary URL returns a non-image response", async () => {
    mockHtmlResponse(); // primary: i= out of range -> HTML
    mockImageResponse(); // fallback: bare ARK -> real image

    const primary =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=999";
    const fallback = "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X";

    const result = await fetchFsImageBytes(primary, fallback);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(primary);
    expect(mockFetch.mock.calls[1][0]).toBe(fallback);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("throws when both the primary and fallback URLs fail", async () => {
    mockHtmlResponse();
    mockErrorResponse(404, "Not Found");

    await expect(
      fetchFsImageBytes(
        "https://www.familysearch.org/ark:/61903/3:1:BAD?i=999",
        "https://www.familysearch.org/ark:/61903/3:1:BAD"
      )
    ).rejects.toThrow(/FamilySearch image fetch failed/);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when no fallback URL is given", async () => {
    mockHtmlResponse();

    await expect(
      fetchFsImageBytes("https://www.familysearch.org/ark:/61903/3:1:X?i=999")
    ).rejects.toThrow(/Expected an image response/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not use the fallback when the primary URL already returns an image", async () => {
    mockImageResponse();

    const result = await fetchFsImageBytes(
      "https://www.familysearch.org/ark:/61903/3:1:X?i=1",
      "https://www.familysearch.org/ark:/61903/3:1:X"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.contentType).toBe("image/jpeg");
  });
});
