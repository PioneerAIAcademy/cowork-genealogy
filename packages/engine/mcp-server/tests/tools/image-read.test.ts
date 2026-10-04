import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { imageReadTool } from "../../src/tools/image-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import {
  recordImageReadCap,
  sourceImageCapState,
  __clearTruncatedSourceImagesForTests,
} from "../../src/utils/image-store.js";
import { __clearImageBrowseMemoryForTests } from "../../src/utils/browse-budget.js";

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
  __clearImageBrowseMemoryForTests();
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

    const result = await imageReadTool({ imageId: "004884748_02613" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg"
    );
    expect(result.metadata.url).toBe(
      "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg"
    );
    expect(result.metadata.viewerUrl).toBe(
      "https://www.familysearch.org/search/film/004884748?i=2612"
    );
    expect(result.metadata.mimeType).toBe("image/jpeg");
  });

  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockImageResponse();

    await imageReadTool({ imageId: "004884748_02613" }, LOCAL);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
  });

  it("rejects an image that exceeds the inline size cap", async () => {
    // 700 KB is the cap; 800 KB would base64-inflate past the ~1 MiB MCP
    // transport buffer and crash the session, so the tool must refuse it.
    mockImageResponse(new Uint8Array(800_000));

    await expect(imageReadTool({ imageId: "004884748_02613" }, LOCAL)).rejects.toThrow(
      /too large to return inline/i
    );
  });

  it("returns an image sitting just under the size cap", async () => {
    mockImageResponse(new Uint8Array(699_999));

    const result = await imageReadTool({ imageId: "004884748_02613" }, LOCAL);

    expect(result.metadata.sizeBytes).toBe(699_999);
    expect(result.imageData.length).toBeGreaterThan(0);
  });

  it("saves the scan under images/ and returns imageRef when projectPath is given", async () => {
    mockImageResponse(new Uint8Array([1, 2, 3]));
    const dir = await mkdtemp(join(tmpdir(), "imgr-"));
    try {
      const result = await imageReadTool({
        imageId: "004884748_02613",
        projectPath: dir,
      }, LOCAL);
      expect(result.metadata.imageRef).toBe("images/004884748_02613.jpg");
      const saved = await readFile(join(dir, "images", "004884748_02613.jpg"));
      expect(saved.length).toBe(3); // the 3 mocked fetch bytes
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits imageRef when projectPath is not given", async () => {
    mockImageResponse();
    const result = await imageReadTool({ imageId: "004884748_02613" }, LOCAL);
    expect(result.metadata.imageRef).toBeUndefined();
  });

  it("does NOT touch the truncation cap — image_read returns bytes, not a transcription, so clearing a prior image_transcribe cap would drop a real truncation marker (#2457 review, blocker 3)", async () => {
    // The earlier design cleared the cap here; that fires only on the main thread
    // (no agent declares image_read) and turns a capped transcribe-then-read into
    // a complete-looking persisted transcription — a false negative worse than
    // the guesswork it replaced. image_read must leave the cap untouched.
    const dir = await mkdtemp(join(tmpdir(), "imgr-cap-"));
    try {
      recordImageReadCap(dir, "images/004884748_02613.jpg", true);
      mockImageResponse(new Uint8Array([1, 2, 3]));
      const result = await imageReadTool({
        imageId: "004884748_02613",
        projectPath: dir,
      }, LOCAL);
      expect(result.metadata.imageRef).toBe("images/004884748_02613.jpg");
      // The cap the prior image_transcribe recorded still stands.
      expect(sourceImageCapState(dir, "images/004884748_02613.jpg")).toBe(true);
    } finally {
      __clearTruncatedSourceImagesForTests();
      await rm(dir, { recursive: true, force: true });
    }
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
    await expect(imageReadTool({ imageId }, LOCAL)).rejects.toThrow(
      /Unrecognized.*imageId/i
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("imageReadTool — ark input", () => {
  it("fetches an ARK URL (ending in /$dist) directly", async () => {
    mockImageResponse();
    const ark =
      "https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/3:1:3Q9M-CSNL-S98H-M/$dist";

    const result = await imageReadTool({ ark }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ark);
    expect(result.metadata.url).toBe(ark);
    expect(result.metadata.viewerUrl).toBeUndefined();
  });

  it("fetches a DGS distribution URL directly", async () => {
    mockImageResponse();
    const url = "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg";

    await imageReadTool({ ark: url }, LOCAL);

    const [fetchedUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchedUrl).toBe(url);
  });

  it("expands a canonical document-image ARK (3:1:) to a resolver URL", async () => {
    mockImageResponse();

    const result = await imageReadTool({ ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M" }, LOCAL);

    const [fetchedUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchedUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M"
    );
    expect(result.metadata.viewerUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M"
    );
  });

  it("rejects a record ARK (1:2:, e.g. record_search's recordArk) without fetching", async () => {
    // Verified live (2026-07-07): a 1:2: ARK's resolver returns an HTML
    // shell, not the image, so this shape is deliberately unsupported —
    // only 3:1:/3:2: document-image ARKs resolve to bytes.
    await expect(
      imageReadTool({ ark: "ark:/61903/1:2:HSJG-CLNF" }, LOCAL)
    ).rejects.toThrow(/Unrecognized ark/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("expands a bare n:n:id ARK to a resolver URL", async () => {
    mockImageResponse();

    await imageReadTool({ ark: "3:2:3Q9M-CSNL-S98H-M" }, LOCAL);

    const [fetchedUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchedUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:2:3Q9M-CSNL-S98H-M"
    );
  });

  it("passes a full resolver URL through unchanged", async () => {
    mockImageResponse();
    const url = "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M";

    await imageReadTool({ ark: url }, LOCAL);

    const [fetchedUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchedUrl).toBe(url);
  });

  it("forwards i/cc/groupId from a full page URL, and recovers via the fallback when that URL isn't an image", async () => {
    // Wiring test: the URL-computation logic itself (forwarding params,
    // dropping irrelevant ones, offering a fallback) is covered directly
    // against resolveFsImageInput in tests/utils/fs-image-fetch.test.ts.
    // This confirms imageReadTool actually threads url + fallbackUrl through
    // to fetchFsImageBytes end to end — the regression from unconditionally
    // forwarding i=/cc=/groupId= (#1203 review) was exactly a wiring gap: a
    // non-image response with no fallback attempted.
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
    mockImageResponse();
    const url =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en&i=999&cc=1858355&groupId=1858355";

    const result = await imageReadTool({ ark: url }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=999&cc=1858355&groupId=1858355"
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X"
    );
    expect(result.metadata.mimeType).toBe("image/jpeg");
    // metadata.url reports the URL that actually worked, not the failed primary.
    expect(result.metadata.url).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X"
    );
  });

  it("rejects an unrecognized ark value without fetching", async () => {
    await expect(imageReadTool({ ark: "not-an-ark" }, LOCAL)).rejects.toThrow(
      /Unrecognized ark/i
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a persona-shaped unprefixed id without fetching", async () => {
    await expect(imageReadTool({ ark: "QPRC-WPBZ" }, LOCAL)).rejects.toThrow(
      /exactly as the user gave it/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches an unprefixed XXXX-XXXX-XXXX-X id as 3:1:", async () => {
    mockImageResponse();

    await imageReadTool({ ark: "3QS7-89Q6-89S6-Y" }, LOCAL);

    const [fetchedUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchedUrl).toBe("https://www.familysearch.org/ark:/61903/3:1:3QS7-89Q6-89S6-Y");
  });

  it("surfaces a non-image resolver response as an error rather than misinterpreting it", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(
      imageReadTool({ ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M" }, LOCAL)
    ).rejects.toThrow(/Expected an image response/i);
  });
});

describe("imageReadTool — input validation", () => {
  it("rejects when both imageId and ark are provided", async () => {
    await expect(
      imageReadTool({ imageId: "004884748_02613", ark: "ark:/61903/1:2:HSJG-CLNF" }, LOCAL)
    ).rejects.toThrow(/exactly one of imageId, ark, or memoryArtifactUrl/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects when neither imageId nor ark is provided", async () => {
    await expect(imageReadTool({}, LOCAL)).rejects.toThrow(
      /requires one of imageId, ark, or memoryArtifactUrl/i
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("imageReadTool — memoryArtifactUrl input", () => {
  // `ImageReadInput extends FsImageInput`, so `memoryArtifactUrl` is accepted
  // here and `resolveFsImageInput` returns `memoryShape: true` for it. The tool
  // destructured only {url, label, fallbackUrl} and called fetchFsImageBytes
  // with three arguments, so the flag fell back to its `= false` default: the
  // FamilySearch bearer went to a URL that needs no credential. The schema has
  // no `additionalProperties: false` and index.ts casts without validating, so
  // this call shape is reachable in production.
  const ART = "https://sg30p0.familysearch.org/ark:/61903/dist.jpg?ctx=1";

  it("sends NO Authorization header, and never asks for a token", async () => {
    mockImageResponse();
    await imageReadTool({ memoryArtifactUrl: ART }, LOCAL);
    expect(mockedGetValidToken).not.toHaveBeenCalled();
    const headers = new Headers(mockFetch.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("omits viewerUrl for memory artifact input (issue #2854)", async () => {
    mockImageResponse();
    const result = await imageReadTool({ memoryArtifactUrl: ART }, LOCAL);
    expect(result.metadata.viewerUrl).toBeUndefined();
  });

  it("still sends the bearer for an ordinary imageId, so the flag is not stuck on", async () => {
    // The other direction: a fix that simply stopped sending the token would
    // pass the test above and break every non-memory read.
    mockImageResponse();
    await imageReadTool({ imageId: "004884748_02613" }, LOCAL);
    expect(mockedGetValidToken).toHaveBeenCalled();
    const headers = new Headers(mockFetch.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("refuses an artifact URL on any other host", async () => {
    await expect(
      imageReadTool({ memoryArtifactUrl: "https://evil.example.com/a/dist.jpg" }, LOCAL),
    ).rejects.toThrow(/Unrecognized memoryArtifactUrl/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("imageReadTool — hard image cap (#3010, image-transcribe spec §5.8)", () => {
  const GROUP = "004884748";
  const img = (seq: number) => `${GROUP}_${String(seq).padStart(5, "0")}`;
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "imgr-cap-"));
    await writeFile(join(project, "research.json"), "{}");
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  async function readTwenty() {
    for (let i = 1; i <= 20; i++) {
      mockImageResponse();
      await imageReadTool({ imageId: img(i), projectPath: project }, LOCAL);
    }
  }

  it("refuses the 21st distinct image in a group without fetching it", async () => {
    await readTwenty();
    mockFetch.mockClear();
    await expect(imageReadTool({ imageId: img(21), projectPath: project }, LOCAL)).rejects.toThrow(
      /Image cap reached: 20 distinct images from image group 004884748/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-reading one of the first 20 still works", async () => {
    await readTwenty();
    mockImageResponse();
    const again = await imageReadTool({ imageId: img(3), projectPath: project }, LOCAL);
    expect(again.metadata.sizeBytes).toBe(4);
  });

  it("counts a DGS distribution URL passed as ark", async () => {
    await readTwenty();
    mockFetch.mockClear();
    await expect(
      imageReadTool({ ark: `https://familysearch.org/das/v2/dgs:${img(21)}/dist.jpg`, projectPath: project }, LOCAL),
    ).rejects.toThrow(/Image cap reached/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a failed fetch does not advance the count", async () => {
    for (let i = 1; i <= 19; i++) {
      mockImageResponse();
      await imageReadTool({ imageId: img(i), projectPath: project }, LOCAL);
    }
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", headers: { get: () => null } });
    await expect(imageReadTool({ imageId: img(20), projectPath: project }, LOCAL)).rejects.toThrow();
    mockFetch.mockReset();
    mockImageResponse();
    const r = await imageReadTool({ imageId: img(21), projectPath: project }, LOCAL);
    expect(r.metadata.sizeBytes).toBe(4);
  });
});
