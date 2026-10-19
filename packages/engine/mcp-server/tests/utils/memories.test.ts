/**
 * The filter is the lead's ruling of 2026-09-15 (issue #1689). Every case below
 * uses a shape `dev/probe-memories.ts` actually observed on FamilySearch, not an
 * invented one — the ids and titles are real memories from the 221-memory corpus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  filterSourceStyle,
  rankForTranscription,
  hasRecordLanguage,
  fetchStoryText,
  memoryPageId,
  resolveMemoryArtifactUrl,
} from "../../src/utils/memories.js";
import { LOCAL } from "../../src/auth/principal.js";

// Nothing else in this file reads a token, so mocking the whole module is safe.
const getValidTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/refresh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/refresh.js")>();
  return { ...actual, getValidToken: getValidTokenMock };
});

type M = Parameters<typeof filterSourceStyle>[0][number];

const mem = (over: Partial<M> & Pick<M, "id">): M => ({
  title: "",
  mediaType: "image/jpeg",
  kind: "Photo",
  ...over,
});

describe("filterSourceStyle — stage 1 exclusions run first", () => {
  it("drops audio whatever else matches, including a Story-qualified MP3", () => {
    // Real: id 241796737, "Almon Clegg mission experience.mp3", Story-qualified,
    // 82 chars of description. Kind alone would keep it.
    const audio = mem({
      id: "241796737",
      title: "Almon Clegg mission experience.mp3",
      mediaType: "audio/mpeg",
      kind: "Story",
      descriptionPreview: "his mission and the certificate he was given",
    });
    expect(hasRecordLanguage(audio), "the keyword arm WOULD match it").toBe(true);
    expect(filterSourceStyle([audio], null)).toEqual([]);
  });

  it("drops the designated portrait even when it carries record language", () => {
    const portrait = mem({ id: "9685", title: "World War II Draft Card", kind: "Photo" });
    expect(filterSourceStyle([portrait], null)).toHaveLength(1);
    expect(filterSourceStyle([portrait], "9685")).toEqual([]);
  });

  it("drops video the same way", () => {
    expect(filterSourceStyle([mem({ id: "v1", mediaType: "video/mp4", kind: "Story" })], null)).toEqual([]);
  });
});

describe("filterSourceStyle — stage 2 keeps on any arm", () => {
  it("keeps a PDF filed under Photo (the one memory the PDF arm earns)", () => {
    // 28 of 29 PDFs in the corpus are already Documents; this is the exception
    // the arm exists for.
    const m = mem({ id: "p1", mediaType: "application/pdf", kind: "Photo", title: "untitled" });
    expect(filterSourceStyle([m], null)).toHaveLength(1);
  });

  it("keeps a Document on kind alone, with no record language", () => {
    const doc = mem({ id: "44005158", title: "Almon G. Clegg Poems", kind: "Document", mediaType: "image/jpeg" });
    expect(hasRecordLanguage(doc)).toBe(false);
    expect(filterSourceStyle([doc], null)).toHaveLength(1);
  });

  it("drops a Story with no record language — stories earn their way in like photos", () => {
    const story = mem({ id: "228755097", title: "UNITY IN THE TRACES", kind: "Story", mediaType: "text/plain" });
    expect(hasRecordLanguage(story)).toBe(false);
    expect(filterSourceStyle([story], null)).toEqual([]);
  });

  it("keeps a Story whose title carries record language", () => {
    const story = mem({ id: "s-obit", title: "Obituary of Almon Clegg", kind: "Story", mediaType: "text/plain" });
    expect(filterSourceStyle([story], null)).toHaveLength(1);
  });

  it("keeps the record scans uploaders file under Photo — the trade the ruling bought", () => {
    // All real, all Photo-qualified JPEGs the floor would have missed.
    const photos = [
      mem({ id: "175960782", title: "World War II Draft Card" }),
      mem({ id: "180024695", title: "Elder Dennis A Clegg in 1950 Census in Texas" }),
      mem({ id: "171034261", title: "George A. Clegg-Sarah E. Giles, Marriage license and certificate" }),
      mem({ id: "218717632", title: "Obituary" }),
      mem({ id: "10770109", title: "HEADSTONE:  Heber City, Utah" }),
    ];
    expect(filterSourceStyle(photos, null)).toHaveLength(5);
  });

  it("drops an ordinary family snapshot", () => {
    const snaps = [
      mem({ id: "139112814", title: "Geneva and Almon Clegg dropping off grandchildren" }),
      mem({ id: "17672112", title: "7D34DE84-43EC-4585-A2D" }),
      mem({ id: "109403981", title: "Colorized" }),
      // The three above pass on ANY version of the keyword arm, because none of
      // them happens to contain a name the stems match. This one does: with the
      // old blanket `\w*`, `will` matched William and the snapshot was kept as
      // source-style AND ranked first for the OCR budget.
      mem({ id: "n1", title: "William and Geneva at the lake" }),
    ];
    expect(filterSourceStyle(snaps, null)).toEqual([]);
  });

  it("does not read record language out of ordinary given names", () => {
    // Every one of these matched before the stems were anchored. William is one
    // of the commonest Anglophone given names, so this was not a corner case --
    // it kept a family snapshot on a large fraction of real trees.
    const names = [
      "William and Geneva at the lake",
      "Willie Clegg as a boy",
      "Willard Clegg, 1948",
      "Grandma Willa on the porch",
      "Willow tree in the yard",
      "Birthday party 1962",
      "Registered nurse graduation photo",
      "Deedee at the beach",
      "Mustering out? no - Mustard picnic",
      "Bibi at the beach",
    ];
    for (const title of names) {
      expect(hasRecordLanguage(mem({ id: "x", title })), title).toBe(false);
    }
  });

  it("still fires on the record language it exists for", () => {
    // The other direction: anchoring must not cost recall. A guard that only
    // ever stops matching is not a fix, it is a deletion.
    const records = [
      "Last will and testament of Almon Clegg",
      "Wills and probate, Wasatch County",
      "1880 census page, Detroit Ward 8",
      "Federal censuses 1850 and 1860",
      "Deed of sale, 40 acres",
      "Birth certificate",
      "Death certificate",
      "Obituary",
      "Obituaries, Deseret News",
      "Baptism record",
      "Baptised at St Mary's",
      "Naturalization papers",
      "Parish register, Trowbridge",
      "Civil registration index",
      "World War II Draft Card",
      "Draft cards, Utah",
      "HEADSTONE:  Heber City, Utah",
      "Muster roll, Company D",
      "Enlistment papers",
      "Passenger manifest",
      "Land patent, Sanpete County",
      "Affidavit of support",
      "Marriage license and certificate",
      // Record classes the stems were missing. A photographed family-Bible
      // register is a classic memory-only source and is nearly always filed
      // under Photos, so it falls through every other arm.
      "Family Bible register page",
      "Bibles of the Clegg family",
      "Cemetery record, Heber City",
      "Cemeteries of Wasatch County",
    ];
    for (const title of records) {
      expect(hasRecordLanguage(mem({ id: "x", title })), title).toBe(true);
    }
  });

  it("the keyword arm is language-independent underneath: a German tree keeps its Documents", () => {
    const german = [
      mem({ id: "g1", title: "Taufregister Seite 12", kind: "Document", mediaType: "image/jpeg" }),
      mem({ id: "g2", title: "Sterbeurkunde", kind: "Document", mediaType: "application/pdf" }),
      mem({ id: "g3", title: "Familienfoto am See", kind: "Photo" }),
    ];
    // No English keyword fires on any of them...
    expect(german.filter(hasRecordLanguage)).toEqual([]);
    // ...yet both Documents survive on the floor, and only the snapshot drops.
    expect(filterSourceStyle(german, null).map((m) => m.id)).toEqual(["g1", "g2"]);
  });
});

describe("rankForTranscription", () => {
  it("puts record-language first so the budget is not spent on family histories", () => {
    const ranked = rankForTranscription([
      mem({ id: "hist", title: "Life History of Almon Giles Clegg", kind: "Document", sizeBytes: 1_000 }),
      mem({ id: "census", title: "1950 Census in Texas", sizeBytes: 9_000_000 }),
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["census", "hist"]);
  });

  it("breaks ties by size, so one big scan cannot starve several small ones", () => {
    const ranked = rankForTranscription([
      mem({ id: "big", title: "Marriage license", sizeBytes: 6_800_000 }),
      mem({ id: "small", title: "Death certificate", sizeBytes: 120_000 }),
      mem({ id: "mid", title: "Obituary", sizeBytes: 900_000 }),
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["small", "mid", "big"]);
  });

  it("does not mutate its input", () => {
    const input = [mem({ id: "a", sizeBytes: 2 }), mem({ id: "b", title: "census", sizeBytes: 1 })];
    const before = input.map((m) => m.id);
    rankForTranscription(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });
});

describe("fetchStoryText — the story leg validates the host the image leg validates", () => {
  const ARTIFACT = "https://sg30p0.familysearch.org/abc/dist.txt?ctx=1";
  let previousFetch: typeof globalThis.fetch;
  const fetchMock = vi.fn();
  beforeEach(() => {
    previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    fetchMock.mockReset();
  });
  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  const story = (artifactUrl: string) => ({
    id: "s1",
    title: "a story",
    mediaType: "text/plain",
    kind: "Story" as const,
    artifactUrl,
  });

  it("fetches a real artifact URL and returns its words", async () => {
    fetchMock.mockResolvedValue(new Response("Almon told this himself.", { status: 200 }));
    await expect(fetchStoryText(story(ARTIFACT))).resolves.toBe("Almon told this himself.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://evil.example.com/abc/dist.txt",
    "http://sg30p0.familysearch.org/abc/dist.txt",
    "https://sg30p0.familysearch.org.evil.example.com/abc/dist.txt",
    "https://www.familysearch.org/memories/12345",
  ])("refuses to fetch %s at all", async (bad) => {
    // `artifactUrl` is `sourceDescriptions[].about` taken verbatim off an
    // upstream body. The image leg has always checked the host; this leg did
    // not, so whatever `about` held was fetched and its body landed in
    // `sources[].text`. No credential was ever attached, which is why this is
    // depth rather than a live hole -- but the two legs read the SAME field and
    // must not disagree about what is fetchable.
    await expect(fetchStoryText(story(bad))).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe("resolveMemoryPageUrl — a Memories PAGE url is resolved to the bytes url", () => {
  // Every url and every `about` below is a shape dev/probe-memory-page.ts saw
  // live on 2026-09-30 over 5 artifacts, not an invented one.
  const ABOUT =
    "https://sg30p0.familysearch.org/service/records/storage/dascloud/patron/v2/TH-7768-103723-9979-62/dist.jpg?ctx=ArtCtxPublic";
  const PAGE = "https://www.familysearch.org/photos/artifacts/117201348";

  let previousFetch: typeof globalThis.fetch;
  const fetchMock = vi.fn();
  beforeEach(() => {
    previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    fetchMock.mockReset();
    getValidTokenMock.mockReset();
    getValidTokenMock.mockResolvedValue("tok");
  });
  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  const ok = (about: unknown) =>
    new Response(JSON.stringify({ sourceDescriptions: [{ about }] }), { status: 200 });

  it("1. resolves a page url to the artifact's `about`", async () => {
    fetchMock.mockResolvedValue(ok(ABOUT));
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).resolves.toBe(ABOUT);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.familysearch.org/platform/memories/memories/117201348",
    );
  });

  it("2. accepts the bare host as well as www.", async () => {
    // Asserted on the id, not through a `!`: a non-null assertion turns a null
    // id into a lookup for ".../null", which the mock answers happily — so the
    // test passed with the `www.`-required break applied until this changed.
    const id = memoryPageId("https://familysearch.org/photos/artifacts/117201348");
    expect(id).toBe("117201348");
    fetchMock.mockResolvedValue(ok(ABOUT));
    await expect(resolveMemoryArtifactUrl(id!, LOCAL)).resolves.toBe(ABOUT);
  });

  it("3. keeps a query string, fragment and trailing slash out of the id", async () => {
    for (const suffix of ["/", "?foo=1", "#frag"]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(ok(ABOUT));
      expect(memoryPageId(`${PAGE}${suffix}`), `suffix ${suffix}`).toBe("117201348");
      await resolveMemoryArtifactUrl(memoryPageId(`${PAGE}${suffix}`)!, LOCAL);
      expect(fetchMock.mock.calls[0][0], `suffix ${suffix}`).toBe(
        "https://api.familysearch.org/platform/memories/memories/117201348",
      );
    }
  });

  it("4. rejects a url that merely CONTAINS a FamilySearch page url — the anchor", async () => {
    // The only shape where dropping `^` changes the answer: measured null
    // anchored, an id unanchored. No id means the tool never reaches the
    // resolver, so nothing is looked up on behalf of an unvalidated host.
    expect(memoryPageId(`https://evil.example.com/r?u=${PAGE}`)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4b. rejects a foreign host — the host literal, NOT the anchor", async () => {
    // Kept separate on purpose: this is null with AND without `^`, so it can
    // never red the anchor break and must not be read as anchor coverage.
    expect(memoryPageId("https://evil.example/photos/artifacts/1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4c. rejects a host-suffix lookalike", async () => {
    expect(memoryPageId("https://www.familysearch.org.evil.com/photos/artifacts/1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4d. rejects a non-numeric id, which the terminator is what catches", async () => {
    expect(memoryPageId("https://www.familysearch.org/photos/artifacts/123abc")).toBeNull();
  });

  it("5. refuses an `about` that is not a memory artifact url", async () => {
    fetchMock.mockResolvedValue(ok("https://evil.example/not-an-artifact.jpg"));
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).rejects.toThrow(/no readable artifact/);
  });

  it("6. throws an actionable error on a 404 and on empty sourceDescriptions", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).rejects.toThrow(
      /Memories lookup failed \(404\).*call the login tool/s,
    );

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sourceDescriptions: [] }), { status: 200 }),
    );
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).rejects.toThrow(/no readable artifact/);
  });

  it("resolves for a LOGGED-OUT caller — getValidToken is never reached", async () => {
    // The whole point of the unauthenticated lookup. An unconditional fsFetch
    // calls getValidToken FIRST and throws "User is not logged in" before any
    // request, refusing a logged-out caller an artifact FamilySearch serves
    // anonymously. Asserted by making a token read fatal, not by inspecting
    // headers: with an unconditional fsFetch the throw happens before a header
    // exists for test 12 to look at.
    getValidTokenMock.mockRejectedValue(
      new Error("User is not logged in to FamilySearch. Call the login tool."),
    );
    fetchMock.mockResolvedValue(ok(ABOUT));
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).resolves.toBe(ABOUT);
    expect(getValidTokenMock).not.toHaveBeenCalled();
  });

  it("11. accepts the /memories/<id> form person_read hands the agent", async () => {
    fetchMock.mockResolvedValue(ok(ABOUT));
    await expect(
      resolveMemoryArtifactUrl(memoryPageId("https://www.familysearch.org/memories/117201348")!, LOCAL),
    ).resolves.toBe(ABOUT);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.familysearch.org/platform/memories/memories/117201348",
    );
  });

  /** Read a header whatever shape the init used. `Object.keys()` on a `Headers`
   *  instance returns [], and fsFetch's mergeAuth builds exactly one of those —
   *  so a naive key check reads as "no token" on the very call that carries it.
   *  Measured: this assertion was vacuous until it went through `new Headers`. */
  const authHeaderOf = (call: unknown[]): string | null =>
    new Headers(((call[1] ?? {}) as RequestInit).headers).get("Authorization");

  it("12. looks up WITHOUT a bearer, and retries with one only on a 403", async () => {
    // The lookup is anonymous because the probe measured it so; demanding a
    // token would refuse a logged-out caller a public artifact.
    fetchMock.mockResolvedValue(ok(ABOUT));
    await resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL);
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBeNull();

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValue(ok(ABOUT));
    await expect(resolveMemoryArtifactUrl(memoryPageId(PAGE)!, LOCAL)).resolves.toBe(ABOUT);
    expect(fetchMock.mock.calls.length, "403 must trigger exactly one retry").toBe(2);
    expect(authHeaderOf(fetchMock.mock.calls[0]), "first call stays anonymous").toBeNull();
    expect(authHeaderOf(fetchMock.mock.calls[1]), "the retry carries the bearer").toMatch(
      /^Bearer /,
    );
  });
});
