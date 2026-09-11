import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  sourceAttachmentsTool,
  ATTACHMENTS_URI_CAP,
} from "../../src/tools/source-attachments.js";
import { getValidToken } from "../../src/auth/refresh.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ark = (n: number) => `ark:/61903/1:1:TEST-${String(n).padStart(4, "0")}`;
const url = (n: number) => `https://www.familysearch.org/${ark(n)}`;

function okWith(map: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ attachedSourcesMap: map }),
  };
}

/** One attachment entry naming `personId`. */
const entryFor = (personId: string) => [
  { persons: [{ entityId: personId, tags: ["Birth"] }], sourceId: "S1" },
];

/** Every URI the mock was asked for, across all calls, in order. */
function sentBatches(): string[][] {
  return mockFetch.mock.calls.map(
    (c) => JSON.parse((c[1] as { body: string }).body).uris as string[],
  );
}

describe("source_attachments", () => {
  it("rejects an empty uris array", async () => {
    await expect(sourceAttachmentsTool({ uris: [] })).rejects.toThrow(
      /must not be empty/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends one POST and keys the answer back to the caller's input string", async () => {
    mockFetch.mockResolvedValueOnce(okWith({ [url(1)]: entryFor("KWZZ-111") }));

    const out = await sourceAttachmentsTool({ uris: [ark(1), ark(2)] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]).toEqual([url(1), url(2)]);
    // Keyed by the ARK the caller passed, not the resolver URL the API answers with.
    expect(out.attachments[ark(1)]).toEqual([
      { personId: "KWZZ-111", tags: ["Birth"] },
    ]);
    expect(out.unattached).toEqual([ark(2)]);
  });

  // ─── The cap (#1212) ──────────────────────────────────────────────────────
  // FamilySearch rejects a batch over 100 outright: measured live 2026-09-11,
  // 100 -> 200 and 101 -> `400.002 LimitException: Limit Exceeded 100`.

  it("sends exactly one POST at the cap", async () => {
    mockFetch.mockResolvedValue(okWith({}));
    const uris = Array.from({ length: ATTACHMENTS_URI_CAP }, (_, i) => ark(i));

    await sourceAttachmentsTool({ uris });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]).toHaveLength(ATTACHMENTS_URI_CAP);
  });

  it("splits one URI past the cap into two POSTs, neither over the cap", async () => {
    mockFetch.mockResolvedValue(okWith({}));
    const uris = Array.from({ length: ATTACHMENTS_URI_CAP + 1 }, (_, i) => ark(i));

    await sourceAttachmentsTool({ uris });

    const batches = sentBatches();
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(ATTACHMENTS_URI_CAP);
    expect(batches[1]).toHaveLength(1);
    // The split must partition, not sample: every URI sent exactly once.
    expect(batches.flat()).toEqual(uris.map((_, i) => url(i)));
  });

  it("merges attachments found in different chunks", async () => {
    // First chunk answers for uri 0, second for the one past the cap. A merge
    // that dropped either map would lose one of these.
    const lastIndex = ATTACHMENTS_URI_CAP;
    mockFetch
      .mockResolvedValueOnce(okWith({ [url(0)]: entryFor("KWZZ-AAA") }))
      .mockResolvedValueOnce(okWith({ [url(lastIndex)]: entryFor("KWZZ-BBB") }));

    const uris = Array.from({ length: ATTACHMENTS_URI_CAP + 1 }, (_, i) => ark(i));
    const out = await sourceAttachmentsTool({ uris });

    expect(out.attachments[ark(0)]).toEqual([
      { personId: "KWZZ-AAA", tags: ["Birth"] },
    ]);
    expect(out.attachments[ark(lastIndex)]).toEqual([
      { personId: "KWZZ-BBB", tags: ["Birth"] },
    ]);
    expect(Object.keys(out.attachments)).toHaveLength(2);
    expect(out.unattached).toHaveLength(ATTACHMENTS_URI_CAP - 1);
  });

  it("chunks by DEDUPLICATED uri count, so duplicates do not force a second POST", async () => {
    mockFetch.mockResolvedValue(okWith({}));
    // Cap distinct ARKs, each repeated — 2x the cap in raw input length.
    const distinct = Array.from({ length: ATTACHMENTS_URI_CAP }, (_, i) => ark(i));

    await sourceAttachmentsTool({ uris: [...distinct, ...distinct] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates a 401 from a later chunk, not just the first", async () => {
    mockFetch
      .mockResolvedValueOnce(okWith({}))
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });
    const uris = Array.from({ length: ATTACHMENTS_URI_CAP + 1 }, (_, i) => ark(i));

    await expect(sourceAttachmentsTool({ uris })).rejects.toThrow(
      /call the login tool/,
    );
  });
});
