/**
 * The filter is the lead's ruling of 2026-09-15 (issue #1689). Every case below
 * uses a shape `dev/probe-memories.ts` actually observed on FamilySearch, not an
 * invented one — the ids and titles are real memories from the 221-memory corpus.
 */
import { describe, it, expect } from "vitest";
import {
  filterSourceStyle,
  rankForTranscription,
  hasRecordLanguage,
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
    ];
    expect(filterSourceStyle(snaps, null)).toEqual([]);
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
