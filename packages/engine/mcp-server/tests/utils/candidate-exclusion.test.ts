import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getProjectStore } from "../../src/store/project-store.js";
import {
  CANDIDATE_PAGE_MAX,
  candidateExclusionRefusal,
  excludedCandidates,
} from "../../src/utils/candidate-exclusion.js";

const ANTOINE = {
  recordId: "ark:/61903/1:1:MFLB-F5N",
  personName: "Antoine Tyler",
  sex: "Female",
  birthDate: "1833",
  collectionId: "1438024",
};

function research(log: unknown[], extra: Record<string, unknown> = {}) {
  return {
    project: { id: "proj_test", title: "t", created: "2026-11-23" },
    questions: [],
    plans: [],
    log,
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

const logEntry = (id: string) => ({
  id,
  plan_item_id: "pli_002",
  performed: "2026-11-23",
  tool: "record_search",
  query: {},
  outcome: "positive",
  results_examined: 1,
  results_ref: `results/${id}.json`,
  external_site: null,
});

const sidecar = (id: string, subjectId: string | null, results: unknown[], query: Record<string, unknown> = {}) => ({
  log_id: id,
  tool: "record_search",
  retrieved: "2026-11-23T00:00:00Z",
  returned_count: results.length,
  payload: { query: { surname: "Tyler", collectionId: "1438024", ...query, ...(subjectId ? { subjectId } : {}) }, results },
});

describe("candidateExclusionRefusal (issue #4580)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "candidate-exclusion-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(
    rows: unknown[],
    subjectId: string | null = "I1",
    extra: Record<string, unknown> = {},
    query: Record<string, unknown> = {},
  ) {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001")], extra));
    await getProjectStore().writeJson(dir, "results/log_001.json", sidecar("log_001", subjectId, rows, query));
  }

  it("refuses a birthYearFrom above an earlier candidate's birth year, naming it and the years to include", async () => {
    await seed([ANTOINE]);
    const refusal = await candidateExclusionRefusal({
      projectPath: dir,
      subjectId: "I1",
      birthYearFrom: 1848,
      birthYearTo: 1858,
    });
    expect(refusal).toContain("Antoine Tyler (ark:/61903/1:1:MFLB-F5N), born 1833, from log_001");
    expect(refusal).toContain("includes 1833");
  });

  it("refuses a birthYearTo below the candidate's birth year, with no lower bound", async () => {
    await seed([{ ...ANTOINE, birthDate: "1870" }]);
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", birthYearTo: 1860 })).not.toBeNull();
  });

  it("allows a range that includes the candidate, and a search with no range", async () => {
    await seed([ANTOINE]);
    expect(
      await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", birthYearFrom: 1830, birthYearTo: 1858 }),
    ).toBeNull();
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1" })).toBeNull();
  });

  it("allows the range when the earlier search was for another subject, or named none", async () => {
    await seed([ANTOINE], "I2");
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
    await seed([ANTOINE], null);
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
  });

  it("allows narrowing a long page: its rows are a pool, not candidates", async () => {
    const pool = Array.from({ length: CANDIDATE_PAGE_MAX + 1 }, (_, i) => ({
      ...ANTOINE,
      recordId: `ark:/61903/1:1:POOL-${i}`,
    }));
    await seed(pool);
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
  });

  it("allows the range once the researcher rejected that record for the subject", async () => {
    await seed([ANTOINE], "I1", {
      assertions: [{ id: "a_1", record_id: "https://familysearch.org/ark:/61903/1:1:MFLB-F5N" }],
      rejected_links: [{ id: "rj_1", assertion_id: "a_1", person_id: "I1", created: "2026-11-23" }],
    });
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
  });

  it("ignores a row with no birth date, and allows the search when there is no project or no subject", async () => {
    await seed([{ ...ANTOINE, birthDate: undefined }]);
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
    expect(await excludedCandidates({ projectPath: join(dir, "nope"), subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
    expect(await excludedCandidates({ projectPath: dir, birthYearFrom: 1848 })).toEqual([]);
  });

  it("lists a candidate once though two logged searches returned it", async () => {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001"), logEntry("log_002")]));
    await getProjectStore().writeJson(dir, "results/log_001.json", sidecar("log_001", "I1", [ANTOINE]));
    await getProjectStore().writeJson(dir, "results/log_002.json", sidecar("log_002", "I1", [ANTOINE]));
    const excluded = await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 });
    expect(excluded.map((c) => c.logId)).toEqual(["log_001"]);
  });

  describe("the row must be a hit for the given name that search asked for", () => {
    const ranged = { projectPath: "", subjectId: "I1", birthYearFrom: 1848, birthYearTo: 1858 };

    it("a wildcard the row's given name matches makes it a candidate (An* → Antoine)", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: "An*" });
      expect(await excludedCandidates({ ...ranged, projectPath: dir })).toHaveLength(1);
    });

    it("a spelling variant matches without a wildcard (Hermann → Herman)", async () => {
      await seed([{ ...ANTOINE, personName: "Herman Goetjen" }], "I1", {}, { givenName: "Hermann" });
      expect(await excludedCandidates({ ...ranged, projectPath: dir })).toHaveLength(1);
    });

    it("givenNameAlt counts too", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: "Mary", givenNameAlt: "Antoine" });
      expect(await excludedCandidates({ ...ranged, projectPath: dir })).toHaveLength(1);
    });

    it("rows of a search for someone else under the subject's id are not candidates (Amelia → Louis, Edward)", async () => {
      await seed(
        [
          { ...ANTOINE, recordId: "ark:/61903/1:1:M66G-SLL", personName: "Louis A. Grotjan", birthDate: "1876" },
          { ...ANTOINE, recordId: "ark:/61903/1:1:M66G-4BJ", personName: "Edward A. Grotjan", birthDate: "1854" },
        ],
        "I1",
        {},
        { givenName: "Amelia" },
      );
      expect(await excludedCandidates({ ...ranged, projectPath: dir, birthYearFrom: 1880 })).toEqual([]);
    });
  });

  it("allows the range once the record is recorded as a namesake of the subject", async () => {
    await seed([ANTOINE], "I1", {
      namesakes: [
        { id: "ns_001", person_id: "I1", name: "Antoine Tyler", place: "Fluvanna", record_ids: ["ark:/61903/1:1:MFLB-F5N"], created: "2026-11-23" },
      ],
    });
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848 })).toEqual([]);
  });
});
