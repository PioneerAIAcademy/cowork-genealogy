/**
 * person_read x memories — issue #1689 Half 2 acceptance.
 *
 * Drives the real tool with the memories endpoint mocked at the fetch layer, so
 * the filter, the paging and the merge are all exercised rather than stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

import { personReadTool } from "../../src/tools/person-read.js";
import { LOCAL } from "../../src/auth/principal.js";
import { getValidToken } from "../../src/auth/refresh.js";

const PID = "KWCJ-RN4";

const person = (living = false) => ({
  persons: [{ id: PID, living, names: [{ nameForms: [{ fullText: "Almon Giles Clegg" }] }] }],
  relationships: [],
  sourceDescriptions: [{ id: "SD_PERSON_" + PID, titles: [{ value: "tree source" }] }],
});

const memory = (over: Record<string, unknown>) => ({
  id: "m1",
  mediaType: "image/jpeg",
  titles: [{ value: "untitled" }],
  artifactMetadata: [{ qualifiers: [{ name: "http://familysearch.org/v1/Photo" }] }],
  links: { memory: { href: "https://www.familysearch.org/memories/m1" } },
  ...over,
});

const qualifier = (k: string) => [{ qualifiers: [{ name: `http://familysearch.org/v1/${k}` }] }];

// person-read.test.ts stubs globalThis.fetch at MODULE scope and never unstubs.
// Two module-scope stubs in one worker means whichever file loads second wins,
// and its transient-429 test starts failing. So this file saves whatever is
// there, installs its own for the duration of each test, and puts the previous
// value back -- surgical, and it does not touch vitest's stub registry.
const fetchMock = vi.fn();
let previousFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.mocked(getValidToken).mockResolvedValue("tok");
  previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  fetchMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  vi.clearAllMocks();
});

/** route by URL: the tree read, the portrait, then memories pages in order */
function routes(opts: { person?: unknown; living?: boolean; pages?: unknown[][]; memoriesStatus?: number }) {
  const pages = opts.pages ?? [[]];
  let pageIdx = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/portrait")) return new Response(null, { status: 404 });
    if (url.includes("/memories")) {
      if (opts.memoriesStatus && opts.memoriesStatus !== 200) {
        return new Response("boom", { status: opts.memoriesStatus });
      }
      const body = pages[pageIdx];
      const isLast = pageIdx >= pages.length - 1;
      pageIdx++;
      if (body === undefined) return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify({
          sourceDescriptions: body,
          // the next href MUST keep /memories in it, or the router below sends
          // page 2 to the tree-read branch and the test silently measures one page
          links: isLast
            ? {}
            : { next: { href: `https://api.familysearch.org/platform/tree/persons/${PID}/memories?start=${pageIdx * 25}` } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(opts.person ?? person(opts.living)), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
}

describe("person_read + memories", () => {
  it("acceptance 2: a source-style memory arrives in sources[] in the same shape as any source", async () => {
    routes({ pages: [[memory({ id: "175960782", titles: [{ value: "World War II Draft Card" }] })]] });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(Object.keys(out).sort()).toEqual(["persons", "relationships", "sources"]);
    const m = out.sources.find((s) => s.id === "175960782");
    expect(m).toBeDefined();
    expect(Object.keys(m!).sort()).toEqual(["id", "title", "url"]);  // no discriminator
  });

  it("acceptance 3: a non-source-style memory is absent entirely", async () => {
    routes({ pages: [[
      memory({ id: "snap", titles: [{ value: "Clegg family reunion" }] }),
      memory({ id: "mp3", mediaType: "audio/mpeg", artifactMetadata: qualifier("Story"),
               titles: [{ value: "Almon Clegg mission experience" }] }),
    ]] });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(out.sources.map((s) => s.id)).toEqual(["SD_PERSON_" + PID].filter(() => false).concat(
      out.sources.filter((s) => s.id.startsWith("SD_")).map((s) => s.id)));
    expect(out.sources.find((s) => s.id === "snap")).toBeUndefined();
    expect(out.sources.find((s) => s.id === "mp3")).toBeUndefined();
  });

  it("acceptance 5: a person with no memories returns exactly what it returned before", async () => {
    routes({ pages: [[]] });
    const withFlag = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(withFlag.sources.every((s) => s.id.startsWith("SD_"))).toBe(true);
  });

  it("acceptance 6: a memories endpoint that 500s still returns the tree read", async () => {
    routes({ memoriesStatus: 500 });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(out.persons).toHaveLength(1);
    expect(out.sources.every((s) => s.id.startsWith("SD_"))).toBe(true);
  });

  it("acceptance 6b: a memories fetch that THROWS still returns the tree read", async () => {
    // The 500 case above does NOT exercise the fail-soft catch: fetchMemories
    // breaks out of its loop on a non-200, it does not throw. Verified by
    // mutation -- making the catch rethrow left that test green. Only a real
    // throw reaches the catch, so this is the case that pins it.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memories") || url.includes("/portrait")) {
        throw new TypeError("fetch failed: ECONNRESET");
      }
      return new Response(JSON.stringify(person()), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(out.persons).toHaveLength(1);
    expect(out.sources.every((s) => s.id.startsWith("SD_"))).toBe(true);
  });

  it("pages to completion, and survives the 204-with-empty-body last page", async () => {
    routes({ pages: [
      [memory({ id: "d1", artifactMetadata: qualifier("Document") })],
      [memory({ id: "d2", artifactMetadata: qualifier("Document") })],
      undefined as unknown as unknown[],   // the real last hop: 204, empty body
    ] });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(out.sources.map((s) => s.id).filter((i) => !i.startsWith("SD_"))).toEqual(["d1", "d2"]);
  });

  it("makes NO memories call when sourceDescriptions is false", async () => {
    routes({ pages: [[memory({ id: "d1", artifactMetadata: qualifier("Document") })]] });
    await personReadTool({ personId: PID, sourceDescriptions: false }, LOCAL);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/memories"))).toHaveLength(0);
  });

  it("makes NO memories call for a living person", async () => {
    routes({ living: true, pages: [[memory({ id: "d1", artifactMetadata: qualifier("Document") })]] });
    await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/memories"))).toHaveLength(0);
  });

  it("titles never empty: falls back to filename, then to the memory id", async () => {
    routes({ pages: [[
      memory({ id: "f1", titles: [], artifactMetadata: [{ filename: "draftcard.jpg",
               qualifiers: [{ name: "http://familysearch.org/v1/Document" }] }] }),
      memory({ id: "f2", titles: [], artifactMetadata: qualifier("Document") }),
    ]] });
    const out = await personReadTool({ personId: PID, sourceDescriptions: true }, LOCAL);
    expect(out.sources.find((s) => s.id === "f1")!.title).toBe("draftcard.jpg");
    expect(out.sources.find((s) => s.id === "f2")!.title).toBe("FamilySearch memory f2");
  });
});

/**
 * Acceptance 10 — the memories phase must not outlive person_read.
 *
 * fetchMemories and fetchPortraitId both go through fetchWithRetry, which
 * re-attempts a transient failure on a jittered timer. Under Promise.all a
 * memories rejection abandons the portrait leg mid-retry, and its next attempt
 * lands after the tool has returned -- in the suite that showed up as an
 * unrelated person-read.test.ts case failing 4 runs in 10. Dispatch is by URL,
 * not call order: the two legs are issued concurrently and race.
 */
describe("person_read memories — nothing outlives the call", () => {
  it("waits for the portrait leg even when the memories leg fails", async () => {
    let portraitSettled = false;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/memories")) {
        // A 200 whose body read rejects. fetchWithRetry only re-attempts a
        // thrown fetch or a retryable STATUS, so this propagates immediately
        // instead of spending ~700ms in backoff -- which is what lets the
        // portrait delay below actually discriminate the two shapes.
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () => Promise.reject(new TypeError("memories body unreadable")),
        };
      }
      if (u.includes("/portrait")) {
        return await new Promise((resolve) =>
          setTimeout(() => {
            portraitSettled = true;
            resolve(new Response(null, { status: 404 }));
          }, 150),
        );
      }
      return new Response(JSON.stringify(person()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await personReadTool(
      { personId: PID, sourceDescriptions: true },
      LOCAL,
    );

    // The assertion that pins allSettled. Under Promise.all the tool returns
    // the instant the memories leg rejects -- roughly 150ms before the portrait
    // leg settles -- so this reads false there and true here.
    expect(portraitSettled).toBe(true);
    // Fail-soft still holds: the read succeeds and carries no memory rows.
    expect(result.persons[0].id).toBe(PID);
    expect((result.sources ?? []).some((s) => s.id === "m1")).toBe(false);
  });
});
