import { LOCAL } from "../../src/auth/principal.js";
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

    const result = await fetchFsImageBytes(primary, fallback, LOCAL);

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
        "https://www.familysearch.org/ark:/61903/3:1:BAD",
        LOCAL
      )
    ).rejects.toThrow(/FamilySearch image fetch failed/);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when no fallback URL is given", async () => {
    mockHtmlResponse();

    await expect(
      fetchFsImageBytes("https://www.familysearch.org/ark:/61903/3:1:X?i=999", undefined, LOCAL)
    ).rejects.toThrow(/Expected an image response/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not use the fallback when the primary URL already returns an image", async () => {
    mockImageResponse();

    const result = await fetchFsImageBytes(
      "https://www.familysearch.org/ark:/61903/3:1:X?i=1",
      "https://www.familysearch.org/ark:/61903/3:1:X",
      LOCAL
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.contentType).toBe("image/jpeg");
  });
});

/**
 * Memory-artifact shape — issue #1689.
 *
 * Measured 2026-09-15 over the 221-memory probe corpus: every `about` URL is on
 * sg30p0.familysearch.org ending /dist.<ext>, the bytes serve with no auth at
 * all, and 29 of the 221 are application/pdf — which the OCR model reads
 * directly, so the fetcher must carry them rather than reject on content-type.
 */
describe("fs-image-fetch — memory artifacts", () => {
  const ARTIFACT =
    "https://sg30p0.familysearch.org/ark:/61903/3:1:ABCD/v2/12345/dist.jpg?ctx=x";

  function mockTypedResponse(contentType: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? contentType : null,
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  }

  it("resolves a memory artifact URL as-is and flags the shape", () => {
    const out = resolveFsImageInput({ memoryArtifactUrl: ARTIFACT }, "t");
    expect(out.url).toBe(ARTIFACT);
    expect(out.memoryShape).toBe(true);
    expect(out.fallbackUrl).toBeUndefined();
  });

  it("refuses an artifact URL on any other host", () => {
    for (const bad of [
      "https://evil.example.com/a/v2/1/dist.jpg",
      "https://sg30p0.familysearch.org.evil.com/v2/1/dist.jpg",
      "http://sg30p0.familysearch.org/v2/1/dist.jpg",
      "https://sg30p0.familysearch.org/v2/1/notdist.exe",
    ]) {
      expect(() =>
        resolveFsImageInput({ memoryArtifactUrl: bad }, "t"),
      ).toThrow(/Unrecognized memoryArtifactUrl/);
    }
  });

  it("sends NO Authorization header for a memory artifact", async () => {
    mockTypedResponse("image/jpeg");
    await fetchFsImageBytes(ARTIFACT, undefined, LOCAL, true);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    // and it never even asks for a token, so an unauthenticated caller works
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });

  it("still sends Authorization for a page scan", async () => {
    mockedGetValidToken.mockResolvedValue("tok");
    mockTypedResponse("image/jpeg");
    await fetchFsImageBytes("https://example.org/x", undefined, LOCAL);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("accepts application/pdf for a memory artifact", async () => {
    mockTypedResponse("application/pdf");
    const out = await fetchFsImageBytes(ARTIFACT, undefined, LOCAL, true);
    expect(out.contentType).toBe("application/pdf");
  });

  it("still rejects application/pdf for a page scan", async () => {
    mockedGetValidToken.mockResolvedValue("tok");
    mockTypedResponse("application/pdf");
    await expect(
      fetchFsImageBytes("https://example.org/x", undefined, LOCAL),
    ).rejects.toThrow(/Expected an image response/);
  });

  it("rejects an audio artifact even in the memory shape", async () => {
    mockTypedResponse("audio/mpeg");
    await expect(
      fetchFsImageBytes(ARTIFACT, undefined, LOCAL, true),
    ).rejects.toThrow(/Expected an image or PDF response/);
  });

  it("refuses more than one input shape", () => {
    expect(() =>
      resolveFsImageInput(
        { imageId: "1_2", memoryArtifactUrl: ARTIFACT },
        "t",
      ),
    ).toThrow(/exactly one of/);
  });
});

