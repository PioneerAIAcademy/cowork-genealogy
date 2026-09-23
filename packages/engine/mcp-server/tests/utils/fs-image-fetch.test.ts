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
    ).rejects.toThrow(/FamilySearch image fetch failed.*may not be a valid/);

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

// ─── Bad-identifier ark guidance (400/404 only) ───────────────────────────

// The guidance ("that ark may not be a valid document-image identifier — get
// one from record_read's imageArk or image_search") is only true when the ark
// itself is wrong. It fires on 400 and 404 and nothing else: 401/403 is a
// rights-restricted image and 429 a rate limit, where the ark is real and
// re-fetching it from record_read hands back the same one. Memory artifacts
// carry a 3:1: ark too (person_read's artifact_url) that neither named tool
// can ever return, so they are excluded whatever the status.
//
// Every generic-message assertion below is ANCHORED. A substring matcher
// cannot fail here: the guidance message BEGINS with the generic text, so
// `.toThrow("FamilySearch image fetch failed: 400 Bad Request")` passes even
// when the guidance leaks into the case the test exists to keep it out of.
describe("fetchFsImageBytes — bad-identifier ark guidance", () => {
  const ARK_URL_31 = "https://www.familysearch.org/ark:/61903/3:1:QJRM-GV8V";
  const GENERIC_400 = /^FamilySearch image fetch failed: 400 Bad Request$/;

  it("names the ark and directs to imageArk on a 400 for a 3:1: ark URL", async () => {
    mockErrorResponse(400, "Bad Request");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(
      /3:1:QJRM-GV8V may not be a valid document-image identifier.*imageArk/
    );
  });

  it("names the ark on a 400 for a 3:2: ark URL", async () => {
    mockErrorResponse(400, "Bad Request");

    await expect(
      fetchFsImageBytes(
        "https://www.familysearch.org/ark:/61903/3:2:77TJ-PXCN",
        undefined,
        LOCAL
      )
    ).rejects.toThrow(/3:2:77TJ-PXCN may not be a valid/);
  });

  it("names the ark on a 404 for a 3:1: ark URL", async () => {
    mockErrorResponse(404, "Not Found");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(/3:1:QJRM-GV8V may not be a valid/);
  });

  it("uses the generic message on a 400 for a non-ark URL", async () => {
    mockErrorResponse(400, "Bad Request");

    await expect(
      fetchFsImageBytes(
        "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg",
        undefined,
        LOCAL
      )
    ).rejects.toThrow(GENERIC_400);
  });

  it("uses the generic message on a 5xx (not 4xx) even for an ark URL", async () => {
    mockErrorResponse(500, "Internal Server Error");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(
      /^FamilySearch image fetch failed: 500 Internal Server Error$/
    );
  });

  // Every ark failure in creszentia-haas-birth's committed runlog is a 403 on
  // a real, rights-restricted image — issue #2392 carved that cause out in the
  // same words. Telling the agent the ark may be invalid and to re-fetch it
  // from record_read sends it round the same loop.
  it("uses the generic message on a 403 for an ark URL (restricted, not invalid)", async () => {
    mockErrorResponse(403, "Forbidden");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(/^FamilySearch image fetch failed: 403 Forbidden$/);
  });

  it("uses the generic message on a 401 for an ark URL", async () => {
    mockErrorResponse(401, "Unauthorized");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(/^FamilySearch image fetch failed: 401 Unauthorized$/);
  });

  it("uses the generic message on a 429 for an ark URL", async () => {
    mockErrorResponse(429, "Too Many Requests");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(
      /^FamilySearch image fetch failed: 429 Too Many Requests$/
    );
  });

  // The live 400 this whole guidance exists for carries an EMPTY statusText:
  // eval/runlogs/e2e/pedro-chaves-spouse records it as "FamilySearch image
  // fetch failed: 400 " with nothing after the code. Interpolating it blindly
  // and then appending a sentence produced "400 . The ark ...".
  it("renders no stray separator when statusText is empty (the live 400 shape)", async () => {
    mockErrorResponse(400, "");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(/^FamilySearch image fetch failed: 400\. The ark /);
  });

  it("renders no stray separator on a generic empty-statusText failure", async () => {
    mockErrorResponse(503, "");

    await expect(
      fetchFsImageBytes("https://familysearch.org/das/v2/dgs:1_2/dist.jpg", undefined, LOCAL)
    ).rejects.toThrow(/^FamilySearch image fetch failed: 503$/);
  });

  // image_search takes an imageGroupNumber from volume_search and returns
  // image IDs — it has no way to return an ark, so an agent told to get one
  // there has nowhere to go.
  it("does not tell the agent an image ark comes from image_search", async () => {
    mockErrorResponse(400, "Bad Request");

    const err = await fetchFsImageBytes(ARK_URL_31, undefined, LOCAL).then(
      () => {
        throw new Error("expected the fetch to reject");
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toMatch(/ark comes from .*image_search/);
    expect(err.message).toMatch(/image_search returns image ids, not arks/);
    expect(err.message).toMatch(/imageGroupNumber from volume_search/);
  });

  // A waypoint ark into a multi-image film needs its i=/cc=/groupId= context;
  // without it FamilySearch may not resolve the document at all. Telling the
  // agent only to re-fetch the ark loops it through the same bare form.
  it("names the i=/cc=/groupId= remedy, not just the ark", async () => {
    mockErrorResponse(404, "Not Found");

    await expect(
      fetchFsImageBytes(ARK_URL_31, undefined, LOCAL)
    ).rejects.toThrow(/i=\/cc=\/groupId=/);
  });

  // A memory artifact reaches the fetcher with memoryShape FALSE whenever it
  // arrives through `ark` rather than `memoryArtifactUrl`: it fails
  // ARK_PATTERN, so arkToImageUrl resolves the 3:1: ark embedded in its path.
  // Keying the carve-out on the flag alone missed this arm entirely.
  it("uses the generic message for a memory artifact URL passed via ark", async () => {
    mockErrorResponse(404, "Not Found");

    await expect(
      fetchFsImageBytes(
        "https://sg30p0.familysearch.org/ark:/61903/3:1:175960782/v2/175960782/dist.jpg",
        undefined,
        LOCAL,
        false,
      )
    ).rejects.toThrow(/^FamilySearch image fetch failed: 404 Not Found$/);
  });

  // A memory artifact URL carries a 3:1: ark of its own — see
  // eval/fixtures/mcp/person-read-flynn-family.json, whose artifact_url is
  // https://sg30p0.familysearch.org/ark:/61903/3:1:175960782/v2/175960782/dist.jpg.
  // That ark comes from person_read and appears in neither record_read's
  // imageArk nor image_search, so the guidance would name two dead ends.
  it("uses the generic message for a memory artifact, ark in the URL or not", async () => {
    const artifact =
      "https://sg30p0.familysearch.org/ark:/61903/3:1:175960782/v2/175960782/dist.jpg";

    for (const [status, text, expected] of [
      [404, "Not Found", /^FamilySearch image fetch failed: 404 Not Found$/],
      [400, "Bad Request", GENERIC_400],
    ] as const) {
      mockErrorResponse(status, text);
      await expect(
        fetchFsImageBytes(artifact, undefined, LOCAL, true)
      ).rejects.toThrow(expected);
    }
  });
});
