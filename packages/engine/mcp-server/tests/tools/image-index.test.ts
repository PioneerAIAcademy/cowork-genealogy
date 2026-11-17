// image_index: the records FamilySearch has indexed on one page image, with
// the personas and names on each (docs/specs/image-index-tool-spec.md).
//
// The Peru fixtures in tests/fixtures/image-index/ are the raw FamilySearch
// bodies recorded on 2026-11-17 by `dev/try-image-index.ts --record`; their
// own `_note` says so.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL, bearerPrincipal } from "../../src/auth/principal.js";
import { HOSTED_REAUTH_INSTRUCTION, REJECTED_TOKEN_MESSAGE } from "../../src/auth/config.js";
import { markFsRefusal } from "../../src/utils/fs-budget.js";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

import { getValidToken } from "../../src/auth/refresh.js";
import {
  IMAGE_INDEX_BUDGET_MS,
  IMAGE_INDEX_CAP,
  IMAGE_INDEX_CONCURRENCY,
  IMAGE_INDEX_READ_TIMEOUT_MS,
  imageIndexSchema,
  imageIndexTool,
} from "../../src/tools/image-index.js";
import { BROWSER_USER_AGENT, TOOL_RESULT_CHAR_BUDGET } from "../../src/constants.js";
import type { ImageIndexInput, ImageIndexResult } from "../../src/types/image-index.js";
import { toArk } from "../../src/utils/ark.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "image-index");
const PERU_LIST = JSON.parse(readFileSync(join(fixtureDir, "peru-list.json"), "utf8"));
const PERU_RECORDS = JSON.parse(readFileSync(join(fixtureDir, "peru-records.json"), "utf8"));
const PERU = "ark:/61903/3:1:33SQ-GYY1-B2G";

const RECORD_TYPE = "http://gedcomx.org/Record";
const PERSISTENT = "http://gedcomx.org/Persistent";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/x-gedcomx-v1+json" },
  });
}

function isList(url: string): boolean {
  return new URL(url).pathname.startsWith("/platform/records/images/");
}

function recordIdOf(url: string): string | undefined {
  return /^\/platform\/records\/records\/([^/]+)$/.exec(new URL(url).pathname)?.[1];
}

/** Every URL the tool asked for, in order. */
function requested(): string[] {
  return mockFetch.mock.calls.map((c) => String(c[0]));
}

function recordRequests(): string[] {
  return requested().filter((u) => !isList(u));
}

/** Answer the list call with `list` and each record read from `records`. */
function route(list: unknown, records: Record<string, unknown>): void {
  mockFetch.mockImplementation(async (url: string | URL) => {
    const u = String(url);
    if (isList(u)) return json(list);
    const id = recordIdOf(u);
    if (id !== undefined && id in records) return json(records[id]);
    return json({ errors: ["not found"] }, 404);
  });
}

function sd(id: string, href?: string): Record<string, unknown> {
  return {
    id: `sd_${id}`,
    resourceType: RECORD_TYPE,
    identifiers: { [PERSISTENT]: [`https://familysearch.org/ark:/61903/1:2:${id}`] },
    links: { record: { href: href ?? `https://www.familysearch.org/platform/records/records/${id}?flag=fsh&cc=7` } },
  };
}

function person(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `p_${id}`,
    principal: true,
    identifiers: { [PERSISTENT]: [`https://familysearch.org/ark:/61903/1:1:${id}`] },
    names: [{ nameForms: [{ fullText: name }] }],
    ...extra,
  };
}

/** A list of `n` records R0..R(n-1), each read answering one persona. */
function listOf(n: number): { list: unknown; records: Record<string, unknown> } {
  const ids = Array.from({ length: n }, (_, i) => `R${i}`);
  return {
    list: { sourceDescriptions: ids.map((id) => sd(id)) },
    records: Object.fromEntries(ids.map((id, i) => [id, { persons: [person(`P${i}`, `Name ${i}`)] }])),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getValidToken).mockReset();
  vi.mocked(getValidToken).mockResolvedValue("tok");
});

describe("image_index: the acceptance check", () => {
  it("lists the recorded Peru page's 27 records with Michael Barry and Mila Fuller", async () => {
    // Written so a recording of the real page (`--record`) passes it too: it
    // pages to the end as a caller does (large households can need more than
    // one answer), and checks each record against its own body.
    route(PERU_LIST, PERU_RECORDS);
    const pages: ImageIndexResult[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined && pages.length < 30) {
      const page = await imageIndexTool({ imageId: PERU, collectionId: "1803958", ...(offset ? { offset } : {}) }, LOCAL);
      pages.push(page);
      offset = page.nextOffset;
    }
    for (const page of pages) {
      expect(page).toMatchObject({
        imageArk: PERU,
        collectionId: "1803958",
        total: 27,
        ordered: false,
        hydrationTimedOut: false,
        rateLimited: false,
      });
    }
    const entries = pages.flatMap((page) => page.entries);
    expect(entries.map((e) => e.index)).toEqual(Array.from({ length: 27 }, (_, i) => i));
    expect(entries.every((e) => e.hydrated)).toBe(true);

    // Measured from malachi: the list's first entry is record 1TVW-1PV, and it
    // carries Michael Barry (his place among its personas was not measured).
    expect(entries[0].recordArk).toBe("ark:/61903/1:2:1TVW-1PV");
    expect(entries[0].personas.find((p) => p.personaArk === "ark:/61903/1:1:XHPP-F3V")).toMatchObject({
      name: "Michael Barry",
    });
    // On the page per the in-network list; where in the list is not measured.
    expect(entries.flatMap((e) => e.personas).find((p) => p.personaArk === "ark:/61903/1:1:XHPP-FQX")).toMatchObject({
      name: "Mila Fuller",
    });

    // Against the fixture itself: every Record entry the list carries, once,
    // each with exactly the persona arks its own body carries.
    const recordIds = (PERU_LIST.sourceDescriptions as Array<Record<string, any>>)
      .filter((d) => d?.resourceType === RECORD_TYPE)
      .map((d) => recordIdOf(new URL(d.links.record.href, "https://www.familysearch.org").toString()) as string);
    // In the list's own order (the tool never reorders), whatever that order is.
    expect(entries.map((e) => e.recordArk)).toEqual(recordIds.map((id) => `ark:/61903/1:2:${id}`));
    const bodyArks = (id: string): Array<string | undefined> =>
      ((PERU_RECORDS[id] as { persons: unknown[] }).persons ?? [])
        .filter((p): p is Record<string, any> => typeof p === "object" && p !== null && !Array.isArray(p))
        .map((p) =>
          ((p.identifiers?.[PERSISTENT] ?? []) as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((x) => toArk(x.trim()))
            .find((a) => /^ark:\/61903\/1:1:/.test(a)),
        )
        .sort();
    const bodyNames = (id: string): Set<string> =>
      new Set(
        ((PERU_RECORDS[id] as { persons: unknown[] }).persons ?? []).flatMap((p) => {
          const person = p as Record<string, any>;
          const forms = ((person?.names ?? []) as Array<Record<string, any>>).flatMap((n) => n?.nameForms ?? []);
          return [...forms.map((f: Record<string, any>) => f?.fullText), person?.display?.name]
            .filter((t): t is string => typeof t === "string" && t.trim() !== "")
            .map((t) => t.trim());
        }),
      );
    for (const e of entries) {
      const id = (e.recordArk as string).replace("ark:/61903/1:2:", "");
      expect(e.personas.map((p) => p.personaArk).sort(), id).toEqual(bodyArks(id));
      const names = bodyNames(id);
      for (const p of e.personas) if (p.name !== undefined) expect(names.has(p.name), `${id}: ${p.name}`).toBe(true);
    }

    // One list call per answer; every record read, and read once when one
    // answer holds them all (an entry cut to fit the size limit is read again
    // on the next page).
    expect(requested().filter(isList)).toHaveLength(pages.length);
    expect(new Set(recordRequests().map((u) => recordIdOf(u)))).toEqual(new Set(recordIds));
    expect(recordRequests()).toHaveLength(
      pages.reduce((n, page) => n + Math.min(IMAGE_INDEX_CAP, 27 - page.offset), 0),
    );
    expect(requested()[0]).toBe(
      "https://www.familysearch.org/platform/records/images/3:1:33SQ-GYY1-B2G/records?cc=1803958",
    );
  });

  it("sends the measured headers and the bearer, and reads each record through the list's own link", async () => {
    route(PERU_LIST, PERU_RECORDS);
    await imageIndexTool({ imageId: PERU, collectionId: "1803958" }, LOCAL);

    for (const [, init] of mockFetch.mock.calls) {
      const h = new Headers((init as RequestInit).headers);
      expect(h.get("Accept")).toBe("application/x-gedcomx-v1+json");
      expect(h.get("User-Agent")).toBe(BROWSER_USER_AGENT);
      expect(h.get("Authorization")).toBe("Bearer tok");
    }
    expect(recordRequests()[0]).toBe(
      "https://www.familysearch.org/platform/records/records/1TVW-1PV?flag=fsh&cc=1803958",
    );
  });
});

describe("image_index: order", () => {
  it("keeps FamilySearch's list order and never sorts, even when ids and sort keys run backwards", async () => {
    const ids = ["Z9", "M5", "A1"];
    const keys = ["0003", "0002", "0001"];
    route(
      { sourceDescriptions: ids.map((id) => sd(id)) },
      Object.fromEntries(
        ids.map((id, i) => [
          id,
          {
            persons: [
              person(`P${id}`, id, { fields: [{ values: [{ labelId: "FS_SORT_KEY", text: keys[i] }] }] }),
            ],
          },
        ]),
      ),
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries.map((e) => e.recordArk)).toEqual(ids.map((id) => `ark:/61903/1:2:${id}`));
    expect(r.entries.map((e) => e.personas[0].sortKey)).toEqual(keys);
    expect(r.entries.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(r.ordered).toBe(false);
  });
});

describe("image_index: what a persona carries", () => {
  it("takes role, relationship to head and sort key only when the record carries them", async () => {
    route(
      { sourceDescriptions: [sd("R0")] },
      {
        R0: {
          persons: [
            person("H", "Ann Head", {
              display: { role: "Principal", name: "display name loses" },
              fields: [
                {
                  values: [
                    { labelId: "PR_RELATIONSHIP_TO_HEAD", text: "Head" },
                    { labelId: "FS_SORT_KEY", text: "000_1_688_1" },
                    { labelId: "PR_EXT_LINE_NBR_ORIG", text: "12" },
                    { labelId: "SOURCE_PERSON_NBR_ORIG", text: "3" },
                  ],
                },
              ],
            }),
            person("W", "Wife Name", { principal: false }),
          ],
        },
      },
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0].personas).toEqual([
      {
        personaArk: "ark:/61903/1:1:H",
        name: "Ann Head",
        principal: true,
        role: "Principal",
        relationshipToHead: "Head",
        sortKey: "000_1_688_1",
        lineNumber: "12",
        personNumber: "3",
      },
      { personaArk: "ark:/61903/1:1:W", name: "Wife Name", principal: false },
    ]);
  });

  it("falls back past a preferred name with no text, and takes only a 1:1 persona ark", async () => {
    route(
      { sourceDescriptions: [sd("R0")] },
      {
        R0: {
          persons: [
            {
              id: "a",
              identifiers: {
                [PERSISTENT]: ["https://familysearch.org/ark:/61903/4:1:KGS8-LY1", "https://familysearch.org/ark:/61903/1:1:AAA1-BB2"],
              },
              names: [{ preferred: true, nameForms: [] }, { nameForms: [{ fullText: "Mila Fuller" }] }],
            },
            {
              id: "b",
              identifiers: { [PERSISTENT]: ["not-an-ark", "https://familysearch.org/ark:/61903/1:2:1TVW-1PV"] },
              names: [{ preferred: true, nameForms: [{ fullText: "  " }] }, { nameForms: [{ fullText: "Michael Barry" }] }],
            },
          ],
        },
      },
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0].personas).toEqual([
      { personaArk: "ark:/61903/1:1:AAA1-BB2", name: "Mila Fuller", principal: false },
      { name: "Michael Barry", principal: false },
    ]);
  });

  it("reads the preferred name first, then the first name, then display.name, and leaves a nameless persona nameless", async () => {
    route(
      { sourceDescriptions: [sd("R0")] },
      {
        R0: {
          persons: [
            {
              id: "a",
              names: [
                { nameForms: [{ fullText: "Alternate" }] },
                { preferred: true, nameForms: [{ fullText: "Preferred" }] },
              ],
            },
            { id: "b", names: [{ nameForms: [{ fullText: "Only" }] }] },
            { id: "c", display: { name: "From Display" } },
            { id: "d", names: [{ nameForms: [{ fullText: "   " }] }] },
            { id: "e" },
          ],
        },
      },
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0].personas.map((p) => p.name)).toEqual([
      "Preferred",
      "Only",
      "From Display",
      undefined,
      undefined,
    ]);
    expect(r.entries[0].personas.every((p) => p.principal === false)).toBe(true);
    expect(r.entries[0].personas.every((p) => p.personaArk === undefined)).toBe(true);
  });
});

describe("image_index: the cap and the cursor", () => {
  it("reads at most the cap per call and pages with nextOffset", async () => {
    expect(IMAGE_INDEX_CAP).toBe(30);
    const { list, records } = listOf(70);
    route(list, records);

    const first = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(first.total).toBe(70);
    expect(first.entries.map((e) => e.index)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(first.nextOffset).toBe(30);
    expect(mockFetch).toHaveBeenCalledTimes(31);

    mockFetch.mockClear();
    const second = await imageIndexTool({ imageId: PERU, offset: first.nextOffset }, LOCAL);
    expect(second.entries[0].index).toBe(30);
    expect(second.entries[0].personas[0].name).toBe("Name 30");
    expect(second.nextOffset).toBe(60);
    expect(mockFetch).toHaveBeenCalledTimes(31);

    mockFetch.mockClear();
    const third = await imageIndexTool({ imageId: PERU, offset: second.nextOffset }, LOCAL);
    expect(third.entries.map((e) => e.index)).toEqual(Array.from({ length: 10 }, (_, i) => 60 + i));
    expect(third.nextOffset).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(11);
  });

  it("reads at most the configured number at once", async () => {
    const { list, records } = listOf(30);
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json(list);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json(records[recordIdOf(u) as string]);
    });
    await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(peak).toBe(IMAGE_INDEX_CONCURRENCY);
  });

  it("refuses an offset at or past the list's end after the list call, reading no record", async () => {
    const { list, records } = listOf(5);
    route(list, records);
    await expect(imageIndexTool({ imageId: PERU, offset: 5 }, LOCAL)).rejects.toThrow(/offset 5.*5 records/s);
    await expect(imageIndexTool({ imageId: PERU, offset: 9 }, LOCAL)).rejects.toThrow(/offset 9/);
    expect(recordRequests()).toEqual([]);
  });

  it("answers an empty list as an answer, not an error", async () => {
    route({ sourceDescriptions: [] }, {});
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r).toMatchObject({ total: 0, returned: 0, entries: [], hydrationTimedOut: false });
    expect(r.nextOffset).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an offset into an empty list", async () => {
    route({ sourceDescriptions: [] }, {});
    await expect(imageIndexTool({ imageId: PERU, offset: 3 }, LOCAL)).rejects.toThrow(/offset 3.*0 records/s);
  });

  it("says so when FamilySearch's list answer carries a next-page link", async () => {
    const { list, records } = listOf(2);
    route({ ...(list as object), links: { next: { href: "https://www.familysearch.org/platform/records/images/x/records?start=2" } } }, records);
    const paged = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(paged.listTruncated).toBe(true);
    expect(paged.total).toBe(2);
    route(list, records);
    const whole = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(whole.listTruncated).toBeUndefined();
    for (const next of [false, {}, "", { href: "  " }, null]) {
      route({ ...(list as object), links: { self: { href: "x" }, next } }, records);
      expect((await imageIndexTool({ imageId: PERU }, LOCAL)).listTruncated, JSON.stringify(next)).toBeUndefined();
    }
  });

  it("counts only Record descriptions, in array order, and skips the rest", async () => {
    route(
      {
        sourceDescriptions: [
          { id: "img", resourceType: "http://gedcomx.org/DigitalArtifact", links: { record: { href: "x" } } },
          sd("R0"),
          { id: "col", resourceType: "http://gedcomx.org/Collection" },
          sd("R1"),
          "not an object",
          null,
        ],
      },
      { R0: { persons: [person("A", "A")] }, R1: { persons: [person("B", "B")] } },
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.total).toBe(2);
    expect(r.entries.map((e) => e.recordArk)).toEqual(["ark:/61903/1:2:R0", "ark:/61903/1:2:R1"]);
  });
});

describe("image_index: input, refused before any request", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["no imageId", {}, /imageId/],
    ["an empty imageId", { imageId: "  " }, /imageId/],
    ["a number for imageId", { imageId: 5 }, /imageId/],
    ["a persona ark", { imageId: "ark:/61903/1:1:XHPP-F3V" }, /1:1:.*record/i],
    ["a record ark", { imageId: "https://www.familysearch.org/ark:/61903/1:2:1TVW-1PV" }, /1:2:/],
    ["a DGS image number", { imageId: "005155907_00688" }, /DGS|image number/i],
    ["a film-viewer URL", { imageId: "https://www.familysearch.org/search/film/005155907?i=687" }, /film/i],
    ["junk", { imageId: "hello" }, /document-image ARK/],
    ["a non-digit collectionId", { imageId: PERU, collectionId: "18039x" }, /collectionId/],
    ["a numeric collectionId", { imageId: PERU, collectionId: 1803958 }, /collectionId/],
    ["a null offset", { imageId: PERU, offset: null }, /offset/],
    ["a string offset", { imageId: PERU, offset: "3" }, /offset/],
    ["a negative offset", { imageId: PERU, offset: -1 }, /offset/],
    ["a fractional offset", { imageId: PERU, offset: 1.5 }, /offset/],
    ["a NaN offset", { imageId: PERU, offset: Number.NaN }, /offset/],
    [
      "a URL repeating cc= with two values",
      { imageId: `https://www.familysearch.org/ark:/61903/3:1:33SQ-GYY1-B2G?cc=1803958&cc=999` },
      /cc=.*1803958.*999|more than one/s,
    ],
    [
      "two different collection ids",
      { imageId: `https://www.familysearch.org/ark:/61903/3:1:33SQ-GYY1-B2G?cc=1803958&wc=x`, collectionId: "99" },
      /collectionId.*1803958|1803958.*collectionId/s,
    ],
  ];
  for (const [label, input, message] of cases) {
    it(`refuses ${label}`, async () => {
      await expect(imageIndexTool(input as ImageIndexInput, LOCAL)).rejects.toThrow(message);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(getValidToken).not.toHaveBeenCalled();
    });
  }
});

describe("image_index: the image id and the collection", () => {
  const forms: Array<[string, string, string]> = [
    ["a canonical ark", PERU, "3:1:33SQ-GYY1-B2G/records"],
    ["a bare type-prefixed id", "3:1:33SQ-GYY1-B2G", "3:1:33SQ-GYY1-B2G/records"],
    ["a resolver URL", "https://familysearch.org/ark:/61903/3:1:33SQ-GYY1-B2G", "3:1:33SQ-GYY1-B2G/records"],
    ["a 3:2 ark", "ark:/61903/3:2:77TQ-ABCD", "3:2:77TQ-ABCD/records"],
    ["an unprefixed 4-4-4-1 image id", "939V-5N9Q-R9FX-T", "3:1:939V-5N9Q-R9FX-T/records"],
    ["a URL repeating one cc", "https://www.familysearch.org/ark:/61903/3:1:33SQ-GYY1-B2G?cc=7&cc=7", "3:1:33SQ-GYY1-B2G/records?cc=7"],
  ];
  for (const [label, imageId, tail] of forms) {
    it(`accepts ${label} and sends the id unencoded`, async () => {
      route({ sourceDescriptions: [] }, {});
      await imageIndexTool({ imageId }, LOCAL);
      expect(requested()[0]).toBe(`https://www.familysearch.org/platform/records/images/${tail}`);
    });
  }

  it("takes cc from a viewer URL, and an equal collectionId beside it", async () => {
    route({ sourceDescriptions: [] }, {});
    const viewer = "https://www.familysearch.org/ark:/61903/3:1:33SQ-GYY1-B2G?cc=1803958&wc=XYZ&i=6";
    const a = await imageIndexTool({ imageId: viewer }, LOCAL);
    const b = await imageIndexTool({ imageId: viewer, collectionId: "1803958" }, LOCAL);
    expect(requested()).toEqual([
      "https://www.familysearch.org/platform/records/images/3:1:33SQ-GYY1-B2G/records?cc=1803958",
      "https://www.familysearch.org/platform/records/images/3:1:33SQ-GYY1-B2G/records?cc=1803958",
    ]);
    expect(a.collectionId).toBe("1803958");
    expect(b.collectionId).toBe("1803958");
  });

  it("sends no cc when neither the URL nor the input names one", async () => {
    route({ sourceDescriptions: [] }, {});
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(new URL(requested()[0]).search).toBe("");
    expect(r.collectionId).toBeUndefined();
  });
});

describe("image_index: the list call fails", () => {
  it("passes on a missing session's own message and asks nothing of FamilySearch", async () => {
    vi.mocked(getValidToken).mockRejectedValueOnce(new Error(HOSTED_REAUTH_INSTRUCTION));
    await expect(imageIndexTool({ imageId: PERU }, bearerPrincipal(""))).rejects.toThrow(
      HOSTED_REAUTH_INSTRUCTION,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("answers a 401 with the desktop login instruction, and with reconnect when hosted", async () => {
    mockFetch.mockImplementation(async () => json({}, 401));
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(REJECTED_TOKEN_MESSAGE);
    await expect(imageIndexTool({ imageId: PERU }, bearerPrincipal("tok"))).rejects.toThrow(
      HOSTED_REAUTH_INSTRUCTION,
    );
    expect(recordRequests()).toEqual([]);
  });

  const statuses: Array<[number, RegExp]> = [
    [403, /restricted/i],
    [404, /no record list.*collectionId/is],
    [429, /rate limit/i],
    [500, /500/],
  ];
  for (const [status, message] of statuses) {
    it(`answers a ${status} with what to do, reading no record`, async () => {
      mockFetch.mockImplementation(async () => json({}, status));
      await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(message);
      expect(recordRequests()).toEqual([]);
    });
  }

  it("names the unmeasured 3:2: form on a 404 for one, and not for a 3:1:", async () => {
    mockFetch.mockImplementation(async () => json({}, 404));
    await expect(imageIndexTool({ imageId: "ark:/61903/3:2:77TQ-ABCD" }, LOCAL)).rejects.toThrow(/measured only with 3:1:/);
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.not.toThrow(/measured only/);
  });

  it("refuses a 200 whose body is not JSON", async () => {
    mockFetch.mockImplementation(async () => new Response("<html>challenge</html>", { status: 200 }));
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(/could not be read/);
  });

  for (const body of [null, [], "text", 5]) {
    it(`refuses a 200 whose body is ${JSON.stringify(body)}`, async () => {
      mockFetch.mockImplementation(async () => json(body));
      await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(/could not be read/);
    });
  }

  it("treats a missing sourceDescriptions as an empty list", async () => {
    mockFetch.mockImplementation(async () => json({ description: "x" }));
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.total).toBe(0);
  });

  it("throws a network failure, reading no record", async () => {
    mockFetch.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow();
    expect(recordRequests()).toEqual([]);
  });
});

describe("image_index: one record's read fails", () => {
  it("marks only that entry, says why, and reads the rest", async () => {
    const ids = ["OK0", "GONE", "BAD", "THROWS", "OK4", "NOPERSONS"];
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json({ sourceDescriptions: ids.map((id) => sd(id)) });
      const id = recordIdOf(u);
      if (id === "GONE") return json({}, 404);
      if (id === "BAD") return new Response("not json", { status: 200 });
      if (id === "THROWS") throw new TypeError("fetch failed");
      if (id === "NOPERSONS") return json({ persons: "nope" });
      return json({ persons: [person(`P_${id}`, String(id))] });
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    const byArk = Object.fromEntries(r.entries.map((e) => [e.recordArk, e]));
    expect(r.entries).toHaveLength(6);
    expect(byArk["ark:/61903/1:2:OK0"].hydrated).toBe(true);
    expect(byArk["ark:/61903/1:2:OK4"].hydrated).toBe(true);
    expect(byArk["ark:/61903/1:2:GONE"]).toMatchObject({ hydrated: false, personas: [] });
    expect(byArk["ark:/61903/1:2:GONE"].error).toMatch(/404/);
    expect(byArk["ark:/61903/1:2:BAD"].error).toMatch(/unreadable record body/);
    expect(byArk["ark:/61903/1:2:THROWS"].hydrated).toBe(false);
    expect(byArk["ark:/61903/1:2:THROWS"].error).toBeTruthy();
    expect(byArk["ark:/61903/1:2:NOPERSONS"].error).toMatch(/unreadable record body/);
    expect(r.hydrationTimedOut).toBe(false);
    expect(r.nextOffset).toBeUndefined();
  });

  it("keeps a restricted record as an entry that says so", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json({ sourceDescriptions: [sd("LOCKED"), sd("OPEN")] });
      return recordIdOf(u) === "LOCKED" ? json({}, 403) : json({ persons: [person("P", "Open")] });
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0]).toMatchObject({ hydrated: false, recordArk: "ark:/61903/1:2:LOCKED" });
    expect(r.entries[0].error).toMatch(/403.*restricted/);
    expect(r.entries[1].hydrated).toBe(true);
    expect(r.rateLimited).toBe(false);
  });

  it("advises a retry only for a server error", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json({ sourceDescriptions: [sd("GONE410"), sd("DOWN503")] });
      return recordIdOf(u) === "GONE410" ? json({}, 410) : json({}, 503);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0].error).toMatch(/^HTTP 410/);
    expect(r.entries[0].error).not.toMatch(/retry/);
    expect(r.entries[1].error).toMatch(/^HTTP 503.*retry/);
  });

  it("stops reading and asks for a sign-in when a record read gets 401", async () => {
    const { list } = listOf(30);
    mockFetch.mockImplementation(async (url: string | URL) => (isList(String(url)) ? json(list) : json({}, 401)));
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(REJECTED_TOKEN_MESSAGE);
    expect(recordRequests()).toHaveLength(IMAGE_INDEX_CONCURRENCY);
  });

  it("asks for a sign-in when the token re-check after a 401 finds the user signed out (case 6)", async () => {
    const { list } = listOf(30);
    let signedOut = false;
    vi.mocked(getValidToken).mockImplementation(async () => {
      if (signedOut) throw new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.");
      return "tok";
    });
    mockFetch.mockImplementation(async (url: string | URL) => {
      if (isList(String(url))) return json(list);
      signedOut = true;
      return json({}, 401);
    });
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(/not logged in/);
    expect(recordRequests().length).toBeLessThanOrEqual(IMAGE_INDEX_CONCURRENCY);
  });

  it("asks for a sign-in when the session is lost mid-call with no 401 (case 7)", async () => {
    const { list, records } = listOf(30);
    let calls = 0;
    vi.mocked(getValidToken).mockImplementation(async () => {
      calls++;
      if (calls > 3) throw new Error("Your FamilySearch session has expired and refresh failed. Call the login tool.");
      return "tok";
    });
    route(list, records);
    await expect(imageIndexTool({ imageId: PERU }, LOCAL)).rejects.toThrow(/refresh failed/);
    expect(recordRequests().length).toBeLessThanOrEqual(IMAGE_INDEX_CONCURRENCY);
  });

  it("stops reading at a 429, and points nextOffset at the refused record", async () => {
    const { list, records } = listOf(10);
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json(list);
      const id = recordIdOf(u) as string;
      if (id === "R2") return json({}, 429);
      // The others answer a moment later, so the 429 is seen while they are in
      // flight: nothing may start after it.
      await new Promise((r) => setTimeout(r, 20));
      return json(records[id]);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.rateLimited).toBe(true);
    expect(r.hydrationTimedOut).toBe(false);
    expect(r.entries.map((e) => e.index)).toEqual([0, 1]);
    expect(r.nextOffset).toBe(2);
    expect(recordRequests()).toHaveLength(IMAGE_INDEX_CONCURRENCY);
    // A read skipped after the stop does not even read the token (under the
    // desktop login that can be a refresh): the list call, then six reads.
    expect(getValidToken).toHaveBeenCalledTimes(1 + IMAGE_INDEX_CONCURRENCY);
  });

  it("stops reading at a local FamilySearch refusal (budget or a paused user) the same way", async () => {
    const { list, records } = listOf(10);
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json(list);
      const id = recordIdOf(u) as string;
      if (id === "R1") throw markFsRefusal(new Error("FamilySearch request budget spent; try again in about 30 seconds."));
      // The others answer a moment later, so the refusal is seen while they
      // are in flight: nothing may start after it.
      await new Promise((r) => setTimeout(r, 20));
      return json(records[id]);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.rateLimited).toBe(true);
    expect(r.hydrationTimedOut).toBe(false);
    expect(r.entries.map((e) => e.index)).toEqual([0]);
    expect(r.nextOffset).toBe(1);
    // The refusal is thrown from the mock, so it counts as one of the six calls.
    expect(recordRequests()).toHaveLength(IMAGE_INDEX_CONCURRENCY);
  });

  it("reports a body read that times out or resets as that read's retryable error, not an unreadable body (row 4b)", async () => {
    const stalled = (error: Error): Response => {
      const res = new Response("{}", { status: 200 });
      Object.defineProperty(res, "text", { value: () => Promise.reject(error), configurable: true, writable: true });
      Object.defineProperty(res, "json", { value: () => Promise.reject(error), configurable: true, writable: true });
      return res;
    };
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json({ sourceDescriptions: [sd("SLOW"), sd("RESET"), sd("GARBLED")] });
      const id = recordIdOf(u);
      if (id === "SLOW") return stalled(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      if (id === "RESET") return stalled(new TypeError("terminated"));
      return new Response("{not json", { status: 200 });
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.entries[0].error).toMatch(/timed out/);
    expect(r.entries[1].error).toMatch(/terminated/);
    expect(r.entries[2].error).toBe("unreadable record body");
  });

  it("raises a 429 stop when the status arrives, before its body drains (row 8b)", async () => {
    const { list, records } = listOf(10);
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json(list);
      const id = recordIdOf(u) as string;
      if (id === "R0") {
        const res = new Response("", { status: 429 });
        Object.defineProperty(res, "text", {
          value: () => new Promise((r) => setTimeout(() => r(""), 300)),
          configurable: true,
          writable: true,
        });
        return res;
      }
      await new Promise((r) => setTimeout(r, 60));
      return json(records[id]);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.rateLimited).toBe(true);
    expect(recordRequests()).toHaveLength(IMAGE_INDEX_CONCURRENCY);
  });

  it("refuses at the request a read that passed the stop check before the stop (row 8c)", async () => {
    const { list, records } = listOf(7);
    let calls = 0;
    vi.mocked(getValidToken).mockImplementation(async () => {
      calls++;
      // The seventh read's token read (call 8: the list, then six reads) is
      // slow, so its request comes after R0's 429 has landed.
      if (calls === 8) await new Promise((r) => setTimeout(r, 100));
      return "tok";
    });
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json(list);
      const id = recordIdOf(u) as string;
      if (id === "R0") {
        await new Promise((r) => setTimeout(r, 50));
        return json({}, 429);
      }
      return json(records[id]);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.rateLimited).toBe(true);
    expect(recordRequests().map((u) => recordIdOf(u))).not.toContain("R6");
    expect(r.hydrationTimedOut).toBe(false);
    expect(r.entries.map((e) => e.index)).toEqual([]);
    expect(r.nextOffset).toBe(0);
  });

  it("reads a failing record once, so the cap bounds the requests", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (isList(u)) return json({ sourceDescriptions: [sd("DOWN")] });
      return json({}, 500);
    });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(recordRequests()).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ hydrated: false, recordArk: "ark:/61903/1:2:DOWN" });
    expect(r.entries[0].error).toMatch(/500.*offset/);
  });

  it("never sends the bearer anywhere but FamilySearch's record path", async () => {
    const bad: Array<[string, string | undefined]> = [
      ["EVIL", "https://evil.example.com/platform/records/records/EVIL"],
      ["LOOKALIKE", "https://www.familysearch.org.evil.example/platform/records/records/LOOKALIKE"],
      ["PLAIN", "http://www.familysearch.org/platform/records/records/PLAIN"],
      ["OTHERPATH", "https://www.familysearch.org/platform/tree/persons/OTHERPATH"],
      ["TRAVERSE", "https://www.familysearch.org/platform/records/records/../../tree/persons/X"],
      ["CREDS", "https://user:pw@www.familysearch.org/platform/records/records/CREDS"],
      ["PORT", "https://www.familysearch.org:8443/platform/records/records/PORT"],
      ["NOHREF", undefined],
    ];
    const descriptions = bad.map(([id, href]) => {
      const d = sd(id, href ?? "unused");
      if (href === undefined) delete (d as { links?: unknown }).links;
      return d;
    });
    descriptions.push(sd("FINE", "/platform/records/records/FINE?cc=1"));
    route({ sourceDescriptions: descriptions }, { FINE: { persons: [person("F", "Fine")] } });

    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(recordRequests()).toEqual(["https://www.familysearch.org/platform/records/records/FINE?cc=1"]);
    for (const e of r.entries.slice(0, bad.length)) {
      expect(e).toMatchObject({ hydrated: false, personas: [], error: "not a FamilySearch record link" });
      expect(e.recordArk).toBeUndefined();
    }
    expect(r.entries[bad.length]).toMatchObject({ hydrated: true, recordArk: "ark:/61903/1:2:FINE" });
  });
});

describe("image_index: the deadline", () => {
  it("stops the answer at the first unfinished read, so nextOffset points at it", async () => {
    vi.useFakeTimers();
    try {
      const { list, records } = listOf(27);
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (isList(u)) return Promise.resolve(json(list));
        const id = recordIdOf(u) as string;
        if (id === "R3") {
          // Resolves at 90 s rather than never: with the deadline removed a
          // never-resolving read hangs to the vitest timeout instead of failing.
          return new Promise((resolve) => setTimeout(() => resolve(json(records[id])), 90_000));
        }
        return Promise.resolve(json(records[id]));
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.entries.map((e) => e.index)).toEqual([0, 1, 2]);
      expect(r.entries.every((e) => e.hydrated)).toBe(true);
      expect(r.nextOffset).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(28);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes no request for a read that would start after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { list, records } = listOf(27);
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (isList(u)) return Promise.resolve(json(list));
        return new Promise((resolve) =>
          setTimeout(() => resolve(json(records[recordIdOf(u) as string])), 90_000),
        );
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
      const r = await promise;
      // Let the abandoned first wave land, so the queued reads try to start.
      await vi.advanceTimersByTimeAsync(120_000);

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.entries).toEqual([]);
      expect(r.returned).toBe(0);
      expect(r.nextOffset).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1 + IMAGE_INDEX_CONCURRENCY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a stalled read into an error entry inside the budget, so paging moves past it", async () => {
    // AbortSignal.timeout runs on a real timer; this one runs on the fake clock
    // so the read's own timeout fires in test time, as fetch's does in life.
    vi.useFakeTimers();
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
      return c.signal;
    });
    try {
      const { list, records } = listOf(3);
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (isList(u)) return Promise.resolve(json(list));
        const id = recordIdOf(u) as string;
        if (id !== "R0") return Promise.resolve(json(records[id]));
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(false);
      expect(r.entries).toHaveLength(3);
      expect(r.entries[0]).toMatchObject({ index: 0, hydrated: false, recordArk: "ark:/61903/1:2:R0" });
      expect(r.entries[0].error).toMatch(/timed out/);
      expect(r.entries[1].hydrated).toBe(true);
      expect(r.nextOffset).toBeUndefined();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("gives a late read only what is left before the deadline's margin, and starts none with too little", async () => {
    vi.useFakeTimers();
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    try {
      const { list, records } = listOf(1);
      const slowList = (delay: number) =>
        mockFetch.mockImplementation((url: string | URL) =>
          isList(String(url))
            ? new Promise((resolve) => setTimeout(() => resolve(json(list)), delay))
            : Promise.resolve(json(records[recordIdOf(String(url)) as string])),
        );

      slowList(40_000);
      let promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(41_000);
      let r = await promise;
      expect(r.entries).toHaveLength(1);
      expect(timeouts[1]).toBe(IMAGE_INDEX_BUDGET_MS - 40_000 - 2_000);

      mockFetch.mockReset();
      slowList(46_500);
      promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
      r = await promise;
      expect(recordRequests()).toEqual([]);
      expect(r).toMatchObject({ entries: [], nextOffset: 0, hydrationTimedOut: true, rateLimited: false });
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("counts a read that lands after the deadline as unfinished, even before the timer fires", async () => {
    // setSystemTime moves the clock without firing timers, so the read lands
    // past the deadline while the race's own timer has not run yet.
    vi.useFakeTimers();
    try {
      const { list, records } = listOf(1);
      let release: (r: Response) => void = () => {};
      let started: () => void = () => {};
      const readStarted = new Promise<void>((r) => {
        started = r;
      });
      mockFetch.mockImplementation((url: string | URL) => {
        if (isList(String(url))) return Promise.resolve(json(list));
        started();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await readStarted;
      vi.setSystemTime(Date.now() + IMAGE_INDEX_BUDGET_MS + 1);
      release(json(records.R0));
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.entries).toEqual([]);
      expect(r.nextOffset).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  for (const status of [401, 429]) {
    it(`changes nothing for a ${status} that lands after the deadline (case 10)`, async () => {
      vi.useFakeTimers();
      try {
        const { list } = listOf(1);
        let release: (r: Response) => void = () => {};
        let started: () => void = () => {};
        const readStarted = new Promise<void>((r) => {
          started = r;
        });
        mockFetch.mockImplementation((url: string | URL) => {
          if (isList(String(url))) return Promise.resolve(json(list));
          started();
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        });
        const promise = imageIndexTool({ imageId: PERU }, LOCAL);
        await readStarted;
        vi.setSystemTime(Date.now() + IMAGE_INDEX_BUDGET_MS + 1);
        release(json({}, status));
        await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
        const r = await promise;
        expect(r).toMatchObject({ entries: [], nextOffset: 0, hydrationTimedOut: true, rateLimited: false });
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it("says both when one record ran out of time and another was rate-limited (case 11)", async () => {
    vi.useFakeTimers();
    try {
      const { list, records } = listOf(2);
      let release: (r: Response) => void = () => {};
      let started: () => void = () => {};
      const slowStarted = new Promise<void>((r) => {
        started = r;
      });
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (isList(u)) return Promise.resolve(json(list));
        if (recordIdOf(u) === "R1") return Promise.resolve(json({}, 429));
        started();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await slowStarted;
      await vi.advanceTimersByTimeAsync(1);
      vi.setSystemTime(Date.now() + IMAGE_INDEX_BUDGET_MS + 1);
      release(json(records.R0));
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 1);
      const r = await promise;
      expect(r).toMatchObject({ entries: [], nextOffset: 0, hydrationTimedOut: true, rateLimited: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends inside the budget when the list call answers 401 late and the desktop login repeats it (row 17)", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
      return c.signal;
    });
    let tokens = 0;
    vi.mocked(getValidToken).mockImplementation(async () => `tok${++tokens}`);
    try {
      let listCalls = 0;
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        if (!isList(String(url))) return Promise.resolve(json({ persons: [] }));
        listCalls++;
        if (listCalls === 1) {
          return new Promise((resolve) => setTimeout(() => resolve(json({}, 401)), 23_900));
        }
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      });
      let settledAt: number | undefined;
      const t0 = Date.now();
      const promise = imageIndexTool({ imageId: PERU }, LOCAL).then(
        () => (settledAt = Date.now() - t0),
        () => (settledAt = Date.now() - t0),
      );
      // Past any outcome, so a call that overruns fails on the assertion below
      // instead of hanging the test.
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 30_000);
      await promise;
      expect(listCalls).toBe(2);
      expect(settledAt).toBeDefined();
      expect(settledAt as number).toBeLessThanOrEqual(IMAGE_INDEX_BUDGET_MS);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reads nothing and says so when the list call spent the budget", async () => {
    vi.useFakeTimers();
    try {
      const { list } = listOf(5);
      mockFetch.mockImplementation((url: string | URL) => {
        if (isList(String(url))) {
          return new Promise((resolve) => setTimeout(() => resolve(json(list)), IMAGE_INDEX_BUDGET_MS + 5_000));
        }
        return Promise.resolve(json({ persons: [] }));
      });
      const promise = imageIndexTool({ imageId: PERU }, LOCAL);
      await vi.advanceTimersByTimeAsync(IMAGE_INDEX_BUDGET_MS + 10_000);
      const r = await promise;

      expect(r).toMatchObject({ total: 5, entries: [], returned: 0, nextOffset: 0, hydrationTimedOut: true });
      expect(recordRequests()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the list call at most 24 s and each read at most its own ceiling", async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    try {
      const { list, records } = listOf(1);
      route(list, records);
      await imageIndexTool({ imageId: PERU }, LOCAL);
      expect(timeouts).toHaveLength(2);
      expect(timeouts[0]).toBe(24_000);
      expect(timeouts[1]).toBe(IMAGE_INDEX_READ_TIMEOUT_MS);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("image_index: the answer's size", () => {
  it("drops trailing entries until the answer fits, and points nextOffset at the first dropped", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `R${i}`);
    const long = "N".repeat(60);
    route(
      { sourceDescriptions: ids.map((id) => sd(id)) },
      Object.fromEntries(
        ids.map((id) => [
          id,
          { persons: Array.from({ length: 20 }, (_, j) => person(`${id}P${j}`, `${long} ${j}`)) },
        ]),
      ),
    );
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(TOOL_RESULT_CHAR_BUDGET);
    expect(r.returned).toBeGreaterThan(0);
    expect(r.returned).toBeLessThan(30);
    expect(r.entries.map((e) => e.index)).toEqual(Array.from({ length: r.returned }, (_, i) => i));
    expect(r.nextOffset).toBe(r.returned);
    expect(r.hydrationTimedOut).toBe(false);
  });

  it("keeps one entry even when it alone is over the budget, so paging always moves", async () => {
    const huge = Array.from({ length: 700 }, (_, j) => person(`H${j}`, `${"N".repeat(60)} ${j}`));
    route({ sourceDescriptions: [sd("R0"), sd("R1")] }, { R0: { persons: huge }, R1: { persons: [] } });
    const r = await imageIndexTool({ imageId: PERU }, LOCAL);
    expect(r.returned).toBe(1);
    expect(r.nextOffset).toBe(1);
  });
});

describe("image_index: schema", () => {
  it("advertises every key the handler reads, and requires only imageId", () => {
    expect(Object.keys(imageIndexSchema.inputSchema.properties).sort()).toEqual([
      "collectionId",
      "imageId",
      "offset",
    ]);
    expect(imageIndexSchema.inputSchema.required).toEqual(["imageId"]);
    expect(imageIndexSchema.name).toBe("image_index");
  });
});
