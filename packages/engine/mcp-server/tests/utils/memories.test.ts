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
} from "../../src/utils/memories.js";

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

  it("keeps Document and Story on kind alone, with no record language", () => {
    const doc = mem({ id: "44005158", title: "Almon G. Clegg Poems.pdf", kind: "Document", mediaType: "application/pdf" });
    const story = mem({ id: "228755097", title: "UNITY IN THE TRACES", kind: "Story", mediaType: "text/plain" });
    expect(hasRecordLanguage(doc)).toBe(false);
    expect(hasRecordLanguage(story)).toBe(false);
    expect(filterSourceStyle([doc, story], null)).toHaveLength(2);
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
