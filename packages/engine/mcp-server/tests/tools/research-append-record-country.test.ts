import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// The real resolver and the bundled one-word list, offline: only FamilySearch's
// place search is stubbed, so the record's country research_append derives for
// a full-text or an image record is what decides the answer.
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(async () => []),
  getPlaceById: vi.fn(async () => null),
  getPlaceRepIds: vi.fn(async () => []),
  getPlaceCandidateNames: vi.fn(async () => []),
}));

import { searchPlace } from "../../src/utils/place-api.js";
import { researchAppend } from "../../src/tools/research-append.js";
import { __clearPlaceResolverCachesForTests } from "../../src/utils/place-resolver.js";

const FULLTEXT_ID = "ark:/61903/3:1:3Q9M-CSNL-S98H-M";

const research = (tool: string) => ({
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [],
  plans: [],
  log: [
    {
      id: "log_001",
      plan_item_id: null,
      performed: "2026-01-01T00:00:00Z",
      tool,
      query: {},
      outcome: "positive",
      results_examined: 1,
      external_site: null,
      results_ref: "results/log_001.json",
    },
  ],
  sources: [
    {
      id: "src_001",
      gedcomx_source_description_id: "SD-001",
      citation: "A deed",
      citation_detail: {
        who: "the parties",
        what: "a deed",
        when_created: "1890",
        when_accessed: "2026-01-01",
        where: "FamilySearch",
        where_within: "page 1",
      },
      source_classification: "original",
      repository: "FamilySearch",
      access_date: "2026-01-01",
    },
  ],
  assertions: [],
  person_evidence: [],
  conflicts: [],
  hypotheses: [],
  timelines: [],
  proof_summaries: [],
  evaluations: [],
});

const tree = {
  persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
  relationships: [],
  sources: [{ id: "SD-001", title: "A deed" }],
};

/** A full-text record in `recordPlace`, or a page whose film covers `place`. */
const fulltext = (recordPlace: string) => ({ tool: "fulltext_search", result: { id: FULLTEXT_ID, recordPlace }, recordId: FULLTEXT_ID });
const page = (place: string) => ({
  tool: "image_transcribe",
  result: {
    id: "004884748_02613",
    source: { imageId: "004884748_02613", place },
    content_type: "image/jpeg",
    size_bytes: 1,
    model: "m",
    transcription: "Deed of sale",
  },
  recordId: "capture:deed-1890",
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "research-append-record-country-"));
  __clearPlaceResolverCachesForTests();
  vi.mocked(searchPlace).mockReset();
  vi.mocked(searchPlace).mockResolvedValue([]);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The standard_place research_append writes for `place` in `record`. */
async function standardized(record: { tool: string; result: unknown; recordId: string }, place: string) {
  await writeFile(join(dir, "research.json"), JSON.stringify(research(record.tool)));
  await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
  await mkdir(join(dir, "results"), { recursive: true });
  await writeFile(
    join(dir, "results", "log_001.json"),
    JSON.stringify({
      log_id: "log_001",
      tool: record.tool,
      retrieved: "2026-01-01T00:00:00Z",
      returned_count: 1,
      payload: { results: [record.result] },
    }),
  );
  const r = await researchAppend({
    projectPath: dir,
    ops: [
      {
        section: "assertions",
        op: "append",
        entry: {
          source_id: "src_001",
          record_id: record.recordId,
          record_role: "principal",
          fact_type: "residence",
          value: "resided",
          place,
          information_quality: "primary",
          informant: "self",
          informant_proximity: "self",
          record_basis: "stated",
          log_entry_id: "log_001",
          extracted_for_question_ids: [],
        },
      },
    ],
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const saved = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  return saved.assertions.at(-1).standard_place ?? null;
}

const hit = (fullName: string, score: number, placeId: string) =>
  ({ name: fullName.split(",")[0], fullName, type: "City", score, placeId, placeRepId: `r${placeId}` }) as any;

describe("research_append: the record country of a full-text or an image record", () => {
  it("applies a one-country list entry only to a record of that country", async () => {
    expect(await standardized(fulltext("Bullock, Alabama, United States"), "Texas")).toBe("Texas, United States");
    expect(await standardized(fulltext("Saltillo, Coahuila, Mexico"), "Texas")).toBeNull();
    expect(await standardized(page("Trumbull, Ohio, United States"), "Boston")).toBe(
      "Boston, Suffolk, Massachusetts, United States",
    );
    expect(await standardized(page("Saltillo, Coahuila, Mexico"), "Boston")).toBeNull();
  });

  it("keeps FamilySearch's untied top hit only in a record of the hit's country", async () => {
    vi.mocked(searchPlace).mockResolvedValue([
      hit("Tillamook, Oregon, United States", 95, "1"),
      hit("Tillamook, Tillamook, Oregon, United States", 80, "2"),
    ]);
    expect(await standardized(fulltext("Tillamook, Oregon, United States"), "Tillamook")).toBe(
      "Tillamook, Oregon, United States",
    );
    expect(await standardized(page("Columbia, Oregon, United States"), "Tillamook")).toBe(
      "Tillamook, Oregon, United States",
    );
    expect(await standardized(fulltext("Lima, Peru"), "Tillamook")).toBeNull();
    expect(await standardized(page("Lima, Peru"), "Tillamook")).toBeNull();
  });

  it("withholds an entry withheld in British records from a Scottish or a World one, and gives it elsewhere", async () => {
    expect(await standardized(fulltext("Campbeltown, Argyll, Scotland"), "Louth")).toBeNull();
    expect(await standardized(fulltext("World"), "Louth")).toBeNull();
    expect(await standardized(page("World"), "Louth")).toBeNull();
    expect(await standardized(fulltext("Dublin, Ireland"), "Louth")).toBe("County Louth, Ireland");
    expect(await standardized(page("Boston, Suffolk, Massachusetts, United States"), "Louth")).toBe(
      "County Louth, Ireland",
    );
  });
});
