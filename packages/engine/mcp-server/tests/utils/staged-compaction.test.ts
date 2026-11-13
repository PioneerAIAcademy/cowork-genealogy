/**
 * The two search tools' post-staging compaction, tested directly rather than
 * only through the tools.
 *
 * The tool suites already pin what each transformation does on a fresh
 * response. What they cannot cover is the property the eval harness newly
 * depends on: **idempotency**. `mock_mcp.py` applies these functions to canned
 * fixture responses. Every fixture is in the full shape today — measured, not
 * assumed — so nothing applies them twice yet. This pins the property before
 * the first fixture re-recorded from a live call arrives already compacted, at
 * which point a destructive second pass would reach the agent damaged with no
 * tool test seeing it.
 */

import { describe, it, expect } from "vitest";
import {
  compactStagedRecordSearch,
  compactStagedFulltextSearch,
  annotateResultsWithRanking,
  compactImageTranscribeAnswer,
  normalizeTranscription,
  transcriptionDigest,
  DIGEST_EXCERPT_CHARS,
  INLINE_TRANSCRIPTION_MAX_CHARS,
  compactRecordReadAnswer,
  RECORD_READ_FULL_PERSONAS,
  RECORD_READ_STUB_PERSONAS,
} from "../../src/utils/staged-compaction.js";
import type { RecordReadResult } from "../../src/types/record-read.js";
import {
  loadRecordReadFixture,
  loadRecordReadFixtures,
  syntheticHousehold,
} from "../helpers/record-read-fixtures.js";
import type { RecordSearchToolResponse } from "../../src/types/record-search.js";
import type { FulltextResult, FulltextSearchResponse } from "../../src/types/fulltext-search.js";
import type { ImageTranscribeResult } from "../../src/types/image-transcribe.js";

function fullRecordSearchResponse(): RecordSearchToolResponse {
  return {
    query: {},
    totalMatches: 2,
    paginationCappedAt: 4999,
    returned: 1,
    offset: 0,
    hasMore: true,
    results: [
      {
        id: "ark:/61903/1:1:ABCD",
        gedcomx: { persons: [] },
        collectionId: "1234",
        collectionUrl: "https://familysearch.org/search/collection/1234",
        collectionTitle: "1850 United States Census",
        treeMatches: [],
        events: [
          { type: "Census", date: "1850", place: "Ohio" },
          { type: "Census", date: "1850", place: "Ohio" },
          { type: "Residence", date: "1850", place: "Ohio" },
        ],
      },
    ],
  } as unknown as RecordSearchToolResponse;
}

describe("compactStagedRecordSearch", () => {
  it("strips, hoists and de-duplicates on a full response", () => {
    const out = compactStagedRecordSearch(fullRecordSearchResponse());
    const row = out.results![0];

    expect(row.gedcomx).toBeUndefined();
    expect(row.collectionUrl).toBeUndefined();
    expect(row.collectionTitle).toBeUndefined();
    expect(row.treeMatches).toBeUndefined();
    expect(row.events).toHaveLength(2);
    expect(out.collections).toEqual({ "1234": "1850 United States Census" });
    // Kept deliberately — rank_search_matches skips a candidate without it.
    expect(row.collectionId).toBe("1234");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = compactStagedRecordSearch(fullRecordSearchResponse());
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = compactStagedRecordSearch(once);
    expect(JSON.parse(JSON.stringify(twice))).toEqual(snapshot);
  });

  it("does not blank an existing collections map when no row carries a title", () => {
    // The shape an already-compacted fixture has: response-level `collections`,
    // no per-row `collectionTitle`. A naive re-run would overwrite it with {}.
    const alreadyCompacted = {
      query: {},
      totalMatches: 1,
      paginationCappedAt: 4999,
      returned: 1,
      offset: 0,
      hasMore: false,
      collections: { "1234": "1850 United States Census" },
      results: [{ id: "ark:/61903/1:1:ABCD", collectionId: "1234" }],
    } as unknown as RecordSearchToolResponse;

    const out = compactStagedRecordSearch(alreadyCompacted);
    expect(out.collections).toEqual({ "1234": "1850 United States Census" });
  });

  it("preserves flat top-level fields (role, relativeTerms, batchNumber) after gedcomx is stripped", () => {
    const resp = fullRecordSearchResponse();
    (resp.results[0] as any).role = "Principal";
    (resp.results[0] as any).batchNumber = "M01048-5";
    (resp.results[0] as any).relativeTerms = { father: { present: true } };

    const out = compactStagedRecordSearch(resp);
    const row = out.results[0] as any;
    expect(row.gedcomx).toBeUndefined();
    expect(row.role).toBe("Principal");
    expect(row.batchNumber).toBe("M01048-5");
    expect(row.relativeTerms).toEqual({ father: { present: true } });
  });

  describe("fields no caller reads off the answer", () => {
    const TITLE = "1850 United States Census";
    const page = (rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
      ({
        query: { surname: "Flynn" },
        totalMatches: rows.length,
        paginationCappedAt: 4999,
        returned: rows.length,
        offset: 0,
        hasMore: false,
        results: rows.map((r) => ({ collectionId: "1234", collectionTitle: TITLE, events: [], ...r })),
        ...extra,
      }) as unknown as RecordSearchToolResponse;

    it("drops primaryId, score, confidence, an empty events and paginationCappedAt", () => {
      const out = compactStagedRecordSearch(page([
        { recordId: "R1", primaryId: "p_1", score: 5.4, confidence: 4 },
        { recordId: "R2", events: [{ type: "Census", date: "1850" }] },
      ]));
      expect(out.results[0]).not.toHaveProperty("primaryId");
      expect(out.results[0]).not.toHaveProperty("score");
      expect(out.results[0]).not.toHaveProperty("confidence");
      expect(out.results[0]).not.toHaveProperty("events");
      expect(out.results[1].events).toEqual([{ type: "Census", date: "1850" }]);
      expect(out).not.toHaveProperty("paginationCappedAt");
    });

    it("drops an `Entry for <personName>` title and strips the collection from any other", () => {
      const out = compactStagedRecordSearch(page([
        { recordId: "R1", personName: "Patrick Flynn", recordTitle: `Entry for Patrick Flynn, "${TITLE}"` },
        { recordId: "R2", personName: "Mary Flynn", recordTitle: `Mary Flynn in household of Patrick Flynn, "${TITLE}"` },
        { recordId: "R3", personName: "Ann Flynn", recordTitle: `Entry for Ann Flinn, "${TITLE}"` },
        { recordId: "R4", personName: "John Flynn", recordTitle: "John Flynn in household of Thomas Flynn" },
      ]));
      expect(out.results[0]).not.toHaveProperty("recordTitle");
      expect(out.results[1].recordTitle).toBe("Mary Flynn in household of Patrick Flynn");
      // A different name in the title is information: only the collection goes.
      expect(out.results[2].recordTitle).toBe("Entry for Ann Flinn");
      expect(out.results[3].recordTitle).toBe("John Flynn in household of Thomas Flynn");
    });

    it("strips the title on a second pass from the collections map, then leaves it alone", () => {
      const out = compactStagedRecordSearch(page([
        { recordId: "R1", personName: "Mary Flynn", recordTitle: `Mary Flynn in household of Patrick Flynn, "${TITLE}"` },
      ]));
      const snapshot = JSON.parse(JSON.stringify(out));
      expect(JSON.parse(JSON.stringify(compactStagedRecordSearch(out)))).toEqual(snapshot);

      // An already-hoisted fixture: no per-row title, the map holds it.
      const hoisted = {
        collections: { "1234": TITLE },
        results: [{ recordId: "R1", collectionId: "1234", personName: "Ann Flynn", recordTitle: `Entry for Ann Flynn, "${TITLE}"` }],
      } as unknown as RecordSearchToolResponse;
      expect(compactStagedRecordSearch(hoisted).results[0]).not.toHaveProperty("recordTitle");
    });

    it("drops the query echo only from a staged answer", () => {
      const staged = compactStagedRecordSearch(page([{ recordId: "R1" }], { staged: { resultsRef: "results/.staging/a.json" } }));
      expect(staged).not.toHaveProperty("query");

      // The eval mock compacts before it attaches `staged`, so it says so.
      expect(compactStagedRecordSearch(page([{ recordId: "R1" }]), { staged: true })).not.toHaveProperty("query");

      // No project, or staging failed: the echo is the only copy of the query.
      expect(compactStagedRecordSearch(page([{ recordId: "R1" }])).query).toEqual({ surname: "Flynn" });
      expect(compactStagedRecordSearch(page([{ recordId: "R1" }], { staged: null })).query).toEqual({ surname: "Flynn" });
    });
  });

  it("leaves a nil result set alone", () => {
    const nil = {
      query: {},
      totalMatches: 0,
      paginationCappedAt: 4999,
      returned: 0,
      offset: 0,
      hasMore: false,
      results: [],
    } as unknown as RecordSearchToolResponse;

    const out = compactStagedRecordSearch(nil);
    expect(out.results).toEqual([]);
    expect(out.collections).toBeUndefined();
  });
});

describe("compactStagedFulltextSearch", () => {
  it("drops textDocument from every row", () => {
    const full = {
      query: {},
      totalResults: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      results: [
        { id: "ark:/61903/3:1:ABCD", textDocument: "x".repeat(5000), title: "Deed Book A" },
      ],
    } as unknown as FulltextSearchResponse;

    const out = compactStagedFulltextSearch(full);
    expect(out.results![0].textDocument).toBeUndefined();
    // The triage stubs survive — this is what search-full-text reads.
    expect(out.results![0].title).toBe("Deed Book A");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = compactStagedFulltextSearch({
      query: {},
      totalResults: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      results: [{ id: "ark:/61903/3:1:ABCD", textDocument: "page text" }],
    } as unknown as FulltextSearchResponse);
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = compactStagedFulltextSearch(once);
    expect(JSON.parse(JSON.stringify(twice))).toEqual(snapshot);
  });

  const page = (results: FulltextResult[]): FulltextSearchResponse => ({
    query: {},
    totalResults: results.length,
    returned: results.length,
    offset: 0,
    hasMore: false,
    results,
  });
  const nameAt = (k: number) => `Given${k} Surname${k % 97}`;

  it("caps names, places and dates at 60/15/10 with the full count beside each", () => {
    const names = Array.from({ length: 100 }, (_, k) => nameAt(k));
    names[70] = "Patrick Flynn";
    names[72] = "Mary Flynn";
    const out = compactStagedFulltextSearch(
      page([
        {
          id: "ark:/61903/3:1:LONG",
          names,
          places: Array.from({ length: 20 }, (_, k) => `Town${k}`),
          dates: Array.from({ length: 12 }, (_, k) => String(1800 + k)),
          highlightTerms: ["Patrick", "Flynn", "Flynn Patrick"],
        },
      ]),
    );
    const r = out.results[0];
    expect(r.names).toHaveLength(60);
    expect(r.namesCount).toBe(100);
    expect(r.places).toHaveLength(15);
    expect(r.placesCount).toBe(20);
    expect(r.dates).toHaveLength(10);
    expect(r.datesCount).toBe(12);
    // The matched names and the 58 nearest them, in page order: index 40..99.
    expect(r.names).toEqual(names.slice(40, 100));
    expect(r.names).toContain("Patrick Flynn");
    expect(r.names).not.toContain(nameAt(0));
  });

  it("ranks by how many highlight words a name shares, not whether it shares one", () => {
    const names = Array.from({ length: 200 }, (_, k) => `Person${k} Flynn`);
    names[150] = "Patrick Flynn";
    const r = compactStagedFulltextSearch(
      page([{ id: "ark:/61903/3:1:DIR", names, highlightTerms: ["Patrick", "Flynn"] }]),
    ).results[0];
    expect(r.names).toHaveLength(60);
    expect(r.names).toContain("Patrick Flynn");
  });

  it("keeps the page order and sets no count when nothing is over its cap", () => {
    const r = compactStagedFulltextSearch(
      page([
        {
          id: "ark:/61903/3:1:SHORT",
          names: [" Patrick  Flynn ", "Mary Flynn", "patrick flynn", "John Kelly"],
          places: ["Tipperary", "TIPPERARY"],
          highlightTerms: ["Flynn"],
        },
      ]),
    ).results[0];
    expect(r.names).toEqual(["Patrick Flynn", "Mary Flynn", "John Kelly"]);
    expect(r.places).toEqual(["Tipperary"]);
    expect(r.namesCount).toBeUndefined();
    expect(r.placesCount).toBeUndefined();
    expect(r.datesCount).toBeUndefined();
  });

  it("drops sourceUrl only where it is the FamilySearch origin plus the id", () => {
    const out = compactStagedFulltextSearch(
      page([
        { id: "ark:/61903/3:1:AAAA", sourceUrl: "https://www.familysearch.org/ark:/61903/3:1:AAAA" },
        { id: "ark:/61903/3:1:BBBB", sourceUrl: "https://www.familysearch.org/ark:/61903/3:1:BBBB?lang=es" },
      ]),
    );
    expect(out.results[0].sourceUrl).toBeUndefined();
    expect(out.results[1].sourceUrl).toBe("https://www.familysearch.org/ark:/61903/3:1:BBBB?lang=es");
  });

  it("keeps collectionTitle on each row and adds no collections map", () => {
    const out = compactStagedFulltextSearch(
      page([
        { id: "ark:/61903/3:1:A", collectionId: "111", collectionTitle: "Deeds" },
        { id: "ark:/61903/3:1:B", collectionId: "111", collectionTitle: "Deeds" },
        { id: "ark:/61903/3:1:C", collectionId: "222", collectionTitle: "Wills" },
        { id: "ark:/61903/3:1:D", collectionTitle: "No id" },
      ]),
    );
    expect("collections" in out).toBe(false);
    expect(out.results.map((r) => r.collectionTitle)).toEqual(["Deeds", "Deeds", "Wills", "No id"]);
  });

  it("keeps a 50-row page of long newspaper rows under 40,000 characters", () => {
    const row = (i: number): FulltextResult => {
      const names = Array.from({ length: 400 }, (_, k) => nameAt(k));
      names[300] = "Patrick Flynn";
      return {
        id: `ark:/61903/3:1:NEWS-${i}`,
        sourceUrl: `https://www.familysearch.org/ark:/61903/3:1:NEWS-${i}`,
        collectionId: "333",
        collectionTitle: "United States, Newspapers",
        title: "Springfield, Illinois Newspaper 1885",
        recordDate: "1885",
        recordType: "Newspaper",
        recordPlace: "Springfield, Illinois",
        textDocument: "column text ".repeat(800),
        names,
        places: Array.from({ length: 150 }, (_, k) => `Township${k}, County${k % 13}`),
        dates: Array.from({ length: 150 }, (_, k) => String(1700 + k)),
        highlightTerms: ["Patrick", "Flynn", "Flynn Patrick"],
      };
    };
    const full = page(Array.from({ length: 50 }, (_, i) => row(i)));
    expect(JSON.stringify(full).length).toBeGreaterThan(500_000);

    const out = compactStagedFulltextSearch(full);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(40_000);
    expect(out.results).toHaveLength(50);
    for (const r of out.results) {
      expect(r.namesCount).toBe(400);
      expect(r.names).toContain("Patrick Flynn");
    }
  });

  it("is idempotent on a capped row and never overwrites a count", () => {
    const once = compactStagedFulltextSearch(
      page([
        {
          id: "ark:/61903/3:1:LONG",
          collectionId: "111",
          collectionTitle: "Deeds",
          names: Array.from({ length: 100 }, (_, k) => nameAt(k)),
          highlightTerms: ["Given50"],
        },
      ]),
    );
    expect(once.results[0].namesCount).toBe(100);
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = compactStagedFulltextSearch(once);
    expect(JSON.parse(JSON.stringify(twice))).toEqual(snapshot);
  });
});

/**
 * `results` is ALWAYS present and complete; the ranking rides on the rows
 * (#1212 ruling, 2026-09-15). There is no drop decision left to make, so the
 * property each arm below holds is that nothing goes MISSING: every row
 * survives, an unscored row trails the scored ones rather than vanishing, and
 * `ranked` gives up `matches` once the scores are on the rows.
 *
 * The earlier design dropped `results` behind a positive two-part condition.
 * That is gone, and so is the failure mode worth guarding then (a length-only
 * condition silently failing the scoreable-no-match arm). Do not reinstate a
 * drop here without re-measuring the payload claim in `#1212 payload` below:
 * the drop shape was BIGGER, because its stub re-carried `collectionTitle`.
 */
describe("annotateResultsWithRanking", () => {
  const rowA = { recordId: "ark:/61903/1:1:AAAA-AA1", events: [] };
  const rowB = { recordId: "ark:/61903/1:1:BBBB-BB2", events: [] };

  const resp = (ranked?: unknown) =>
    ({ results: [rowA, rowB].map((r) => ({ ...r })), ...(ranked ? { ranked } : {}) }) as never;

  const rankedWith = (matches: unknown[], extra: Record<string, unknown> = {}) =>
    ({ subjectId: "I1", scoredCount: matches.length, returnedCount: matches.length, matches, ...extra });

  it("annotates the rows in place and returns them best first", () => {
    // B scores higher, so it comes back first — and its ORIGINAL position
    // survives on searchRank, which is what makes the re-order auditable.
    const out = annotateResultsWithRanking(
      resp(rankedWith([
        { recordId: rowB.recordId, matchRank: 1, searchRank: 2, matchScore: 0.9 },
        { recordId: rowA.recordId, matchRank: 2, searchRank: 1, matchScore: 0.2 },
      ])),
    );
    expect(out.results.map((r) => r.recordId)).toEqual([rowB.recordId, rowA.recordId]);
    expect(out.results[0]).toMatchObject({ matchRank: 1, searchRank: 2, matchScore: 0.9 });
    expect(out.results[1]).toMatchObject({ matchRank: 2, searchRank: 1, matchScore: 0.2 });
  });

  it("copies no star rating onto a row, even from a stub that carries one", () => {
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowB.recordId, matchRank: 1, searchRank: 2, matchScore: 0.9, matchConfidence: 9 }])),
    );
    expect(out.results.find((r) => r.recordId === rowB.recordId)).not.toHaveProperty("matchConfidence");
  });

  it("copies the birth-year conflict flag and gap onto the annotated row", () => {
    const out = annotateResultsWithRanking(
      resp(rankedWith([
        { recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.9, birthYearConflict: true, birthYearGap: -5 },
        { recordId: rowB.recordId, matchRank: 2, searchRank: 2, matchScore: 0.8 },
      ])),
    );
    expect(out.results[0]).toMatchObject({ birthYearConflict: true, birthYearGap: -5 });
    expect(out.results[1]).not.toHaveProperty("birthYearConflict");
    expect(out.results[1]).not.toHaveProperty("birthYearGap");
  });

  it("copies the surname-not-on-subject flag and surname onto the annotated row, and keeps the note on `ranked`", () => {
    const out = annotateResultsWithRanking(resp(rankedWith([
      { recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.9, surnameNotOnSubject: true, candidateSurname: "Fenstermaker" },
      { recordId: rowB.recordId, matchRank: 2, searchRank: 2, matchScore: 0.8 },
    ], { surnameNote: "note" })));
    expect(out.results[0]).toMatchObject({ surnameNotOnSubject: true, candidateSurname: "Fenstermaker" });
    expect(out.results[1]).not.toHaveProperty("surnameNotOnSubject");
    expect(out.results[1]).not.toHaveProperty("candidateSurname");
    expect(out.ranked).toMatchObject({ surnameNote: "note" });
  });

  describe("slim rows below the matcher floor and flags only when true (#4419)", () => {
    const FULL = {
      recordId: rowA.recordId,
      recordArk: "ark:/61903/1:2:AAAA-AA1",
      personName: "Ann Doe",
      role: "Spouse",
      sex: "Female",
      birthDate: "1850",
      birthPlace: "Ohio",
      deathDate: "1900",
      deathPlace: "Iowa",
      collectionId: "1234",
      collectionTitle: "Census",
      collectionUrl: "https://www.familysearch.org/search/collection/1234",
      recordTitle: "Entry for Ann Doe",
      primaryId: "AAAA-AA1",
      treeMatches: [{ id: "LZZZ-ZZZ", name: "Ann Doe", birth: "1850" }],
      candidateFactCount: 4,
      batchNumber: "M01",
      relativeTerms: { father: "absent" },
      events: [{ type: "Census", date: "1850" }],
    };
    const row = (extra: Record<string, unknown> = {}, id = rowA.recordId) => ({ ...FULL, ...extra, recordId: id });
    const run = (rows: unknown[], matches: unknown[], extra: Record<string, unknown> = {}) =>
      annotateResultsWithRanking({
        results: rows,
        ranked: { subjectId: "I1", scoredCount: matches.length, returnedCount: matches.length, matches, ...extra },
      } as never);

    it("keeps only the identity key set on a row at or below the floor", () => {
      const out = run(
        [row()],
        [{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.01, attachedToSubject: true, surnameNotOnSubject: true }],
      );
      expect(Object.keys(out.results[0]).sort()).toEqual(
        [
          "recordId", "recordArk", "personName", "role", "birthDate", "birthPlace", "events",
          "relativeTerms", "batchNumber", "collectionId", "matchRank", "searchRank", "matchScore",
          "attachedToSubject",
        ].sort(),
      );
    });

    it("emits no attachedTo* false, but copies a true", () => {
      const out = run(
        [row({}, rowA.recordId), row({}, rowB.recordId)],
        [
          { recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.8, attachedToSubject: false, attachedToOther: true },
          { recordId: rowB.recordId, matchRank: 2, searchRank: 2, matchScore: 0.7, attachedToSubject: false, attachedToOther: false },
        ],
      );
      expect(out.results[0]).not.toHaveProperty("attachedToSubject");
      expect(out.results[0]).toHaveProperty("attachedToOther", true);
      expect(out.results[1]).not.toHaveProperty("attachedToSubject");
      expect(out.results[1]).not.toHaveProperty("attachedToOther");
    });

    it("rounds the score to 2 decimals and slims on the UNROUNDED score", () => {
      const out = run(
        [row({}, rowA.recordId), row({}, rowB.recordId)],
        [
          { recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.012 },
          { recordId: rowB.recordId, matchRank: 2, searchRank: 2, matchScore: 0.0049 },
        ],
      );
      expect(out.results[0].matchScore).toBe(0.01);
      expect(out.results[0]).toHaveProperty("deathDate"); // 0.012 > 0.01: not slimmed
      expect(out.results[1]).not.toHaveProperty("deathDate");
    });

    it("never slims or rounds a null score", () => {
      const out = run(
        [row()],
        [{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: null }],
      );
      expect(Object.keys(out.results[0]).sort()).toEqual(
        [...Object.keys(FULL), "matchRank", "searchRank", "matchScore"].sort(),
      );
      expect(out.results[0].matchScore).toBeNull();
    });

    it("uses ranked.realNegativeFloor when present, FamilySearch's 0.01 when absent", () => {
      const stub = { recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.2 };
      expect(run([row()], [stub]).results[0]).toHaveProperty("deathDate");
      expect(run([row()], [stub], { realNegativeFloor: 0.25 }).results[0]).not.toHaveProperty("deathDate");
    });

    it("makes a 50-row all-below-floor page at least 25% smaller", () => {
      const ids = Array.from({ length: 50 }, (_, i) => `ark:/61903/1:1:ZZZZ-${String(i).padStart(3, "0")}`);
      const rows = () => ids.map((id) => row({ attachedToSubject: false }, id));
      const matches = ids.map((id, i) => ({ recordId: id, matchRank: i + 1, searchRank: i + 1, matchScore: 0 }));
      const unslimmed = JSON.stringify(rows()).length;
      const slim = JSON.stringify(run(rows(), matches).results).length;
      expect(slim).toBeLessThanOrEqual(unslimmed * 0.75);
      expect(run(rows(), matches).results).toHaveLength(50);
    });
  });

  it("gives up the duplicate row list: `ranked` keeps metadata, not matches", () => {
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    expect(out.ranked).toBeDefined();
    expect((out.ranked as { matches?: unknown }).matches).toBeUndefined();
    expect(out.ranked).toMatchObject({ subjectId: "I1", scoredCount: 1 });
  });

  it("never drops a row — results is always present and complete", () => {
    for (const ranked of [
      undefined,
      rankedWith([]),
      rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.1 }], { subjectResolvable: false }),
    ]) {
      const out = annotateResultsWithRanking(resp(ranked));
      expect(out.results).toHaveLength(2);
    }
  });

  it("keeps an unscored row, sorted after the scored ones", () => {
    // Only A was scored. B is not dropped and not promoted — it trails.
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    expect(out.results.map((r) => r.recordId)).toEqual([rowA.recordId, rowB.recordId]);
    expect(out.results[1].matchRank).toBeUndefined();
  });

  it("matches on the bare id, so a bare-vs-canonical ARK still annotates", () => {
    // Fixtures predate canonical ARKs and carry `AAAA-AA1` against
    // `ark:/61903/1:1:AAAA-AA1`. Exact matching would annotate nothing.
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: "AAAA-AA1", matchRank: 1, searchRank: 1, matchScore: 0.7 }])),
    );
    expect(out.results[0]).toMatchObject({ recordId: rowA.recordId, matchScore: 0.7 });
  });

  it("is idempotent", () => {
    const once = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    const twice = annotateResultsWithRanking({ ...once } as never);
    expect(twice.results).toEqual(once.results);
  });
});

describe("#1212 payload", () => {
  const ROWS = 50;

  /** A row as it leaves compaction: `collectionTitle` has been HOISTED into the
   *  response-level `collections` map, so the row carries only `collectionId`. */
  const row = (i: number) => ({
    recordId: `ark:/61903/1:1:ABCD-${String(i).padStart(3, "0")}`,
    primaryId: `p${i}`,
    personName: `Patrick Flynn ${i}`,
    sex: "Male",
    birthDate: "12 March 1845",
    birthPlace: "County Cork, Ireland",
    deathDate: "4 August 1912",
    deathPlace: "Philadelphia, Pennsylvania, United States",
    events: [
      { type: "Birth", date: "12 March 1845", place: "County Cork, Ireland" },
      { type: "Residence", date: "1880", place: "Philadelphia, Pennsylvania" },
    ],
    collectionId: "2000123",
    recordTitle: "Pennsylvania Deaths and Burials, 1720-1999",
    treeMatches: [{ id: `KWZZ-${i}`, name: `Patrick Flynn` }],
    recordArk: `ark:/61903/1:2:WXYZ-${String(i).padStart(3, "0")}`,
    score: 0.42,
    confidence: 3,
  });

  /** The stub the DROP shape emitted. Note `collectionTitle`: the stub put back
   *  on every scored row the exact string compaction had just hoisted out of the
   *  rows — the duplication that made the old -4.6% figure wrong. */
  const oldStub = (i: number) => {
    const { score: _s, confidence: _c, ...rest } = row(i);
    return {
      matchRank: i + 1,
      searchRank: i + 1,
      ...rest,
      collectionTitle: "Pennsylvania Deaths and Burials, 1720-1999",
      matchScore: 0.9,
      candidateFactCount: 4,
    };
  };

  /** Option B: the row itself, annotated. No second copy of anything. */
  const annotated = (i: number) => ({
    ...row(i),
    matchRank: i + 1,
    searchRank: i + 1,
    matchScore: 0.9,
    candidateFactCount: 4,
  });

  const collections = { "2000123": "Pennsylvania Deaths and Burials, 1720-1999" };

  it("is smaller than the drop shape it replaces, because nothing is duplicated", () => {
    // BEFORE — the drop shape: rows gone, every scored candidate re-emitted as a
    // stub that re-carries the hoisted collection title.
    const before = JSON.stringify({
      collections,
      ranked: {
        subjectId: "KNS4-P6W",
        scoredCount: ROWS,
        returnedCount: ROWS,
        matches: Array.from({ length: ROWS }, (_, i) => oldStub(i)),
      },
    }).length;

    // AFTER — Option B: one annotated row list, `ranked` metadata only.
    const after = JSON.stringify({
      collections,
      results: Array.from({ length: ROWS }, (_, i) => annotated(i)),
      ranked: { subjectId: "KNS4-P6W", scoredCount: ROWS, returnedCount: ROWS },
    }).length;

    // Measured on this branch at 50 rows, not quoted from the issue:
    //   before 35,956   after 34,206   delta -1,750 (-4.9%)
    //
    // The saving is STRUCTURAL: the drop shape's stub re-introduced
    // `collectionTitle` on every scored row after compaction had just hoisted it
    // into `collections`. Option B has no stub, so it cannot reintroduce
    // anything. That is also why the PR's original -4.6% was wrong — the
    // fixture it was measured on had no `collectionTitle` to duplicate, so it
    // priced a saving the real shape never had (review: about +2.7% against
    // production's shape, i.e. the drop shape was BIGGER).
    //
    // Floor is 3%, under the measured 4.9%, so a field-width edit does not red
    // this while a regression that reintroduces duplication does.
    expect(after).toBeLessThan(before);
    expect((before - after) / before).toBeGreaterThan(0.03);

    // The ABSOLUTE figures, pinned because the rank spec quotes them by name.
    // The ratio assertions above cannot hold them: widening a field moves both
    // sides together and leaves the delta at 4.9%, so the spec's "35,956 /
    // 34,206" would rot with the suite green — which is exactly how the -4.6%
    // this replaced survived the pivot to Option B. Band is +/-1%, wide enough
    // that reflowing a fixture string does not red it and narrow enough that a
    // real shape change does.
    //
    // If these fail, the fixture moved: re-measure, then update BOTH this block
    // and docs/specs/rank-search-matches-tool-spec.md, which cites the pair.
    expect(before).toBeGreaterThan(35956 * 0.99);
    expect(before).toBeLessThan(35956 * 1.01);
    expect(after).toBeGreaterThan(34206 * 0.99);
    expect(after).toBeLessThan(34206 * 1.01);
  });

  it("the ranking annotation is a small fraction of the row it rides on", () => {
    // Guards the other direction: if a future field makes the annotation heavy,
    // "annotate in place" stops being obviously the cheaper shape.
    // Measured: bare row 607 B, annotated 696 B — the ranking costs 89 B
    // (14.7%) per row. Ceiling 25% leaves room for one more score field before
    // this needs re-thinking, and reds if the annotation starts rivalling the
    // row it rides on.
    const bare = JSON.stringify(row(0)).length;
    const withScore = JSON.stringify(annotated(0)).length;
    expect(withScore - bare).toBeLessThan(bare * 0.25);
  });
});

// ─── image_transcribe ──────────────────────────────────────────────

// A register page the way the OCR draws one: a fixed-width table in a fence, a
// rule row under its header, space padding at line ends, a CRLF, a run of blank
// lines, a markdown table, and three lines that look like rules but are not only
// rules, or are too short to shorten.
const PADDED_PAGE = [
  "Register of Births, 1853   ",
  "",
  "```",
  "No.  Name                 Father               Born        ",
  "==================================================================",
  "1    Anna Weber           Peter Weber          3 Jan       ",
  "2    Johann Klein         Jakob Klein          9 Jan\t",
  "```",
  "",
  "   ",
  "",
  "",
  "| Col          | Value      |",
  "|:-------------|-----------:|",
  "| a            | b          |",
  "Signature: ____________",
  "____________",
  "---",
  "- - - -",
].join("\r\n");

const PADDED_PAGE_NORMALIZED = [
  "Register of Births, 1853",
  "",
  "```",
  "No.  Name                 Father               Born",
  "===",
  "1    Anna Weber           Peter Weber          3 Jan",
  "2    Johann Klein         Jakob Klein          9 Jan",
  "```",
  "",
  "| Col          | Value      |",
  "|:---|---:|",
  "| a            | b          |",
  "Signature: ____________",
  "___",
  "---",
  "- - - -",
].join("\n");

/** Every line that says something, with its trailing whitespace dropped. */
function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l !== "" && !/^[-=_|:+\s]+$/.test(l));
}

describe("normalizeTranscription", () => {
  it("strips trailing whitespace, shortens rule runs on rule-only lines, and collapses blank-line runs", () => {
    expect(normalizeTranscription(PADDED_PAGE)).toBe(PADDED_PAGE_NORMALIZED);
  });

  it("is lossless on meaningful text: every line with words survives, byte for byte, in order", () => {
    const out = normalizeTranscription(PADDED_PAGE);
    expect(meaningfulLines(out)).toEqual(meaningfulLines(PADDED_PAGE));
    // The inner column padding is what places a value in its column, so it stays.
    expect(out).toContain("1    Anna Weber           Peter Weber          3 Jan");
    // No rule-only line is removed, only shortened.
    const lineCount = (t: string) => t.split(/\r?\n/).filter((l) => l.trim() !== "").length;
    expect(lineCount(out)).toBe(lineCount(PADDED_PAGE));
  });

  it("leaves an ordinary page byte-identical", () => {
    const page = "Johann Schreck, b. 1801, Bayern\nAnna Schreck\n\nWitnesses: Peter Klein, Jakob Weber";
    expect(normalizeTranscription(page)).toBe(page);
  });

  it("leaves a row of column rulings as it is, so each ruling stays under its column", () => {
    const page = [
      "Name        No   Residence",
      "--------    --   --------",
      "Anna Weber  12   Alsweiler",
      "",
      "Born    Died    Buried",
      "====    =====   ======",
      "1801    1867    1867",
    ].join("\n");
    expect(normalizeTranscription(page)).toBe(page);
    // A single rule, and a markdown delimiter row, are still shortened.
    expect(normalizeTranscription("    ------------")).toBe("    ---");
    expect(normalizeTranscription("| ------- | ------- |")).toBe("| --- | --- |");
  });

  it("is linear: a line of 64k spaces before a letter takes well under 100 ms", () => {
    for (const line of [" ".repeat(65_536) + "x", "-" + " ".repeat(65_536) + "x", " \t".repeat(32_768) + "-x"]) {
      const start = performance.now();
      const out = normalizeTranscription(line);
      const ms = performance.now() - start;
      expect(out).toBe(line);
      expect(ms).toBeLessThan(100);
    }
  });

  it("is idempotent", () => {
    const once = normalizeTranscription(PADDED_PAGE);
    expect(normalizeTranscription(once)).toBe(once);
  });
});

describe("transcriptionDigest", () => {
  it("counts the text it was given and shows the page's words, not its padding, fences or rules", () => {
    const text = normalizeTranscription(PADDED_PAGE);
    const d = transcriptionDigest("004884748_02613", text);
    expect(d.id).toBe("004884748_02613");
    expect(d.chars).toBe(text.length);
    expect(d.excerpt.startsWith(
      "Register of Births, 1853\nNo. Name Father Born\n1 Anna Weber Peter Weber 3 Jan\n",
    )).toBe(true);
    expect(d.excerpt).not.toMatch(/ {2}|```|===|:---/);
    expect(Object.keys(d).sort()).toEqual(["chars", "excerpt", "id"]);
  });

  it("bounds the excerpt at DIGEST_EXCERPT_CHARS", () => {
    const d = transcriptionDigest("x", "Weber Anna farmer\n".repeat(100));
    expect(DIGEST_EXCERPT_CHARS).toBe(300);
    expect(d.excerpt.length).toBe(300);
  });

  it("never ends the excerpt on half of a surrogate pair", () => {
    const d = transcriptionDigest("x", "a" + "\u{1F600}".repeat(200));
    expect(d.excerpt.length).toBe(299);
    const last = d.excerpt.charCodeAt(d.excerpt.length - 1);
    expect(last >= 0xdc00 && last <= 0xdfff).toBe(true);
  });
});

/** A page of `chars` or more characters: register rows, one per line. */
function longPage(chars: number): string {
  const rows: string[] = [];
  let length = 0;
  for (let i = 1; length < chars; i++) {
    const row = `${String(i).padStart(4)}  Weber, Anna Maria    farmer's daughter    Alsweiler    3 Jan 1853`;
    rows.push(row);
    length += row.length + 1;
  }
  return rows.join("\n");
}

function inlineAnswer(transcription: string, extra: Partial<ImageTranscribeResult> = {}): ImageTranscribeResult {
  return {
    transcription,
    viewerUrl: "https://www.familysearch.org/search/film/004884748?i=2612",
    nameExpansion: { original: "Anna Weber", expanded: "Anna Weber (also known as Ann)", expansions: { Anna: ["Ann"] } },
    metadata: { imageId: "004884748_02613", contentType: "image/jpeg", model: "google/gemini-3.7-flash", sizeBytes: 3 },
    ...extra,
  };
}

describe("compactImageTranscribeAnswer", () => {
  it("staged: drops the text, nameExpansion and metadata; keeps the ref, digest, found, imageRef and viewerUrl", () => {
    const out = compactImageTranscribeAnswer(inlineAnswer("Anna Weber", {
      found: "FOUND",
      imageRef: "images/004884748_02613.jpg",
      staged: { resultsRef: "results/.staging/abc.json", returnedCount: 1 },
      digest: transcriptionDigest("004884748_02613", "Anna Weber"),
    }));
    expect(Object.keys(out).sort()).toEqual(["digest", "found", "imageRef", "staged", "viewerUrl"]);
  });

  it("keeps only a resolved Memories artifact url from metadata", () => {
    const url = "https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/x/dist.jpg";
    const answer = inlineAnswer("a memory");
    answer.metadata.memoryArtifactUrl = url;
    expect(compactImageTranscribeAnswer(answer).metadata).toEqual({ memoryArtifactUrl: url });
  });

  it("inline under the bound: the text is returned whole, with no notice", () => {
    const out = compactImageTranscribeAnswer(inlineAnswer("Anna Weber", { staged: null, stagingError: "EACCES" }));
    expect(out.transcription).toBe("Anna Weber");
    expect(out).not.toHaveProperty("truncationNotice");
    expect(out).not.toHaveProperty("metadata");
    expect(out).not.toHaveProperty("nameExpansion");
  });

  it("inline over the bound: cuts at a line boundary, says so, keeps found, and sets no truncated", () => {
    const page = longPage(40_000);
    const out = compactImageTranscribeAnswer(inlineAnswer(page, { found: "FOUND" }));
    const text = out.transcription!;
    expect(page.startsWith(text)).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    const escaped = JSON.stringify(text).length - 2;
    expect(escaped).toBeLessThanOrEqual(INLINE_TRANSCRIPTION_MAX_CHARS);
    expect(escaped).toBeGreaterThan(INLINE_TRANSCRIPTION_MAX_CHARS - 200);
    expect(out.truncated).toBeUndefined();
    expect(out.found).toBe("FOUND");
    expect(out.truncationNotice).toContain(
      `Only the first ${text.length.toLocaleString("en-US")} of the page's ${page.length.toLocaleString("en-US")} characters`,
    );
    expect(out.truncationNotice).toContain("`found` covers the whole page");
    expect(out.truncationNotice).toContain("projectPath");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(37_000);
  });

  it("adds the cut to the OCR's own truncation notice rather than replacing it", () => {
    const ocrNotice = "The OCR stopped at its output limit: this transcription is partial.";
    const out = compactImageTranscribeAnswer(inlineAnswer(longPage(40_000), {
      truncated: true,
      truncationNotice: ocrNotice,
    }));
    expect(out.truncated).toBe(true);
    expect(out.truncationNotice!.startsWith(`${ocrNotice} Only the first `)).toBe(true);
    expect(out.truncationNotice).not.toContain("`found`");
  });

  it("is idempotent on every leg", () => {
    const legs = [
      inlineAnswer(longPage(40_000), { found: "NOT FOUND" }),
      inlineAnswer("short", { staged: null, stagingError: "EACCES" }),
      inlineAnswer("staged", { staged: { resultsRef: "results/.staging/a.json", returnedCount: 1 } }),
    ];
    for (const leg of legs) {
      const once = compactImageTranscribeAnswer(leg);
      const snapshot = JSON.stringify(once);
      expect(JSON.stringify(compactImageTranscribeAnswer(once))).toBe(snapshot);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// compactRecordReadAnswer (issue #4415)
// ────────────────────────────────────────────────────────────────────

describe("compactRecordReadAnswer", () => {
  const fixtures = loadRecordReadFixtures();
  const size = (v: unknown) => JSON.stringify(v).length;
  const compact = (r: RecordReadResult, id: string) =>
    compactRecordReadAnswer(structuredClone(r), id) as Record<string, any>;

  it("the committed record_read fixtures compact to at most 55% of their size", () => {
    // A glob that silently matched nothing would pass the ratio vacuously.
    expect(fixtures.length).toBeGreaterThanOrEqual(91);
    let before = 0;
    let after = 0;
    for (const f of fixtures) {
      before += size(f.response);
      after += size(compact(f.response, f.recordId));
    }
    expect(after).toBeLessThanOrEqual(0.55 * before);
  });

  it("a 150-persona household compacts to at most 39,000 characters", () => {
    const out = compact(syntheticHousehold(150), "AB75-XYZ");
    expect(size(out)).toBeLessThanOrEqual(39_000);
    expect(out.persons).toHaveLength(RECORD_READ_FULL_PERSONAS + RECORD_READ_STUB_PERSONAS);
    expect(out.personsOmitted).toBe(150 - RECORD_READ_FULL_PERSONAS - RECORD_READ_STUB_PERSONAS);
    const ids = new Set(out.persons.map((p: any) => p.id));
    for (const r of out.relationships) {
      for (const e of [r.parent, r.child, r.person1, r.person2].filter(Boolean)) {
        expect(ids.has(e)).toBe(true);
      }
    }
    for (const id of Object.keys(out.birthRanges)) expect(ids.has(id)).toBe(true);
    const stubs = out.persons.filter((p: any) => p.facts === undefined);
    expect(stubs).toHaveLength(RECORD_READ_STUB_PERSONAS);
    for (const s of stubs) expect(Object.keys(s).sort()).toEqual(["ark", "gender", "id", "names"]);
  });

  it("is idempotent over every fixture and the large household", () => {
    const cases = [
      ...fixtures.map((f) => [f.response, f.recordId] as const),
      [syntheticHousehold(150), "AB75-XYZ"] as const,
    ];
    for (const [r, id] of cases) {
      const once = compact(r, id);
      const twice = compactRecordReadAnswer(structuredClone(once) as RecordReadResult, id);
      expect(twice).toEqual(once);
    }
  });

  it("cites the requested persona's own Person source, found by ark or by bare id", () => {
    const f = loadRecordReadFixture("record-read-tallman-2v7m-6qm.json");
    const edward = "Edward Tallman in entry for Orrin Tallman";
    for (const id of ["2V7M-6QM", "ark:/61903/1:1:2V7M-6QM", "p_15021461820"]) {
      expect(compact(f.response, id).citation).toContain(edward);
    }
    // Unknown persona: the Record source's citation.
    expect(compact(f.response, "ZZZZ-ZZZ").citation).toContain("Entry for Orrin Tallman and Edward Tallman");
  });

  it("flattens sources and drops ids, places and the redundant fields", () => {
    const f = loadRecordReadFixture("record-read-tallman-2v7m-6qm.json");
    const out = compact(f.response, f.recordId);
    expect(out.sources).toBeUndefined();
    expect(out.places).toBeUndefined();
    expect(out.recordUrl).toBe("https://www.familysearch.org/ark:/61903/1:2:99FF-4NZ4");
    // The citation already names the collection.
    expect(out.collectionTitle).toBeUndefined();
    expect(out.imageArk).toBe(f.response.imageArk);
    expect(out.viewerUrl).toBe(f.response.viewerUrl);
    for (const p of out.persons) {
      expect(p.id).toBeDefined();
      expect(p.ark).toBeDefined();
      expect(p.sources).toBeUndefined();
      for (const n of p.names ?? []) {
        expect(n.id).toBeUndefined();
        expect(n.type).toBeUndefined();
      }
      for (const fact of p.facts ?? []) {
        expect(fact.id).toBeUndefined();
        expect(fact.sources).toBeUndefined();
        if (fact.standard_place !== undefined) expect(fact.place).not.toBe(fact.standard_place);
      }
    }
    for (const r of out.relationships) expect(r.id).toBeUndefined();
    expect(out.persons[0].principal).toBe(true);
    expect(out.persons[0].facts[0].place).toBe("Burlington, Vermont, United States");
  });

  it("keeps a collection title the citation lacks, and a title when no source has a citation", () => {
    const withCollection = compactRecordReadAnswer(
      {
        persons: [{ id: "p1", names: [{ given: "A", surname: "B" }] }],
        sources: [
          { id: "s1", resource_type: "Record", citation: "Entry for A B.", url: "https://x/ark:/61903/1:2:Q" },
          { id: "s2", resource_type: "Collection", title: "Ohio, Deaths" },
        ],
      },
      "p1",
    );
    expect(withCollection).toMatchObject({ citation: "Entry for A B.", collectionTitle: "Ohio, Deaths" });
    const titleOnly = compactRecordReadAnswer(
      { persons: [{ id: "p1" }], sources: [{ id: "S1", title: "United States Census, 1850" }] },
      "p1",
    );
    expect(titleOnly.citation).toBeUndefined();
    expect(titleOnly.collectionTitle).toBe("United States Census, 1850");
  });

  it("strips FamilySearch's relationship-type prefix", () => {
    const out = compactRecordReadAnswer(
      {
        persons: [{ id: "a" }, { id: "b" }],
        relationships: [
          { id: "r1", type: "http://familysearch.org/types/relationships/Sibling", person1: "a", person2: "b" },
        ],
      },
      "a",
    );
    expect(out.relationships).toEqual([{ type: "Sibling", person1: "a", person2: "b" }]);
  });

  it("keeps the requested persona, its relatives and the principal whole when they sit past slot 40", () => {
    const doc = syntheticHousehold(150);
    // Persona 120 is asked for; the chain makes 119 and 121 its relatives.
    // The principal is persona 0; move the flag to persona 140.
    delete (doc.persons![0] as any).principal;
    (doc.persons![140] as any).principal = true;
    const out = compact(doc, "ark:/61903/1:1:AB120-XYZ");
    const byId = new Map(out.persons.map((p: any) => [p.id, p]));
    for (const i of [119, 120, 121, 140]) {
      const p: any = byId.get(`p_${1000 + i}`);
      expect(p, `persona ${i}`).toBeDefined();
      expect(p.facts, `persona ${i}`).toHaveLength(3);
    }
    // The remaining full slots fill in document order.
    expect((byId.get("p_1000") as any).facts).toHaveLength(3);
    expect((byId.get("p_1035") as any).facts).toHaveLength(3);
    expect((byId.get("p_1036") as any).facts).toBeUndefined();
  });

  it("leaves an answer with no persons array untouched", () => {
    const odd = { error: "x" } as unknown as RecordReadResult;
    expect(compactRecordReadAnswer(odd, "p1")).toEqual({ error: "x" });
  });
});
