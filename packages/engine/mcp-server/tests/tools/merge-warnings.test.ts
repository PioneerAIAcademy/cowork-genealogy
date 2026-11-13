import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  calculateWarnings,
  hasSameCensus,
  hasEventsOutsideLifespan,
  hasSameMarriageDate,
  birthRangeGreaterThan,
} from "../../src/tools/person-warnings.js";
import { Mob } from "../../src/utils/mob.js";
import { mergeWarnings } from "../../src/tools/merge-warnings.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { RecordReadResult } from "../../src/types/record-read.js";
import { compactRecordReadAnswer } from "../../src/utils/staged-compaction.js";
import { loadRecordReadFixture, syntheticHousehold } from "../helpers/record-read-fixtures.js";

// ────────────────────────────────────────────────────────────────────
// hasSameCensus — census collection titles from sources[].title
// ────────────────────────────────────────────────────────────────────

const censusDoc = (
  id: string,
  title: string | null,
  refOnFact = true,
): SimplifiedGedcomX => ({
  persons: [
    {
      id,
      gender: "Female",
      names: [{ given: "Mary", surname: "Flynn" }],
      facts: [
        {
          id: "F1",
          type: "Census",
          date: "1900",
          standard_date: "1900",
          ...(refOnFact && title ? { sources: [{ ref: "S1" }] } : {}),
        },
      ],
      ...(!refOnFact && title ? { sources: [{ ref: "S1" }] } : {}),
    },
  ],
  ...(title ? { sources: [{ id: "S1", title }] } : {}),
});

describe("hasSameCensus", () => {
  it("fires when both mobs cite the same census collection title (ref on a fact)", () => {
    const t = new Mob(censusDoc("I1", "United States Census, 1900"), "I1");
    const c = new Mob(censusDoc("C1", "United States Census, 1900"), "C1");
    expect(hasSameCensus(t, c)).toBe(true);
  });

  it("fires when the ref is on the person rather than a fact", () => {
    const t = new Mob(censusDoc("I1", "United States Census, 1900", false), "I1");
    const c = new Mob(censusDoc("C1", "United States Census, 1900", false), "C1");
    expect(hasSameCensus(t, c)).toBe(true);
  });

  it("does not fire for different census titles", () => {
    const t = new Mob(censusDoc("I1", "United States Census, 1900"), "I1");
    const c = new Mob(censusDoc("C1", "United States Census, 1910"), "C1");
    expect(hasSameCensus(t, c)).toBe(false);
  });

  it("does not fire for a matching title that is not a census", () => {
    const t = new Mob(censusDoc("I1", "Pennsylvania Death Certificates"), "I1");
    const c = new Mob(censusDoc("C1", "Pennsylvania Death Certificates"), "C1");
    expect(hasSameCensus(t, c)).toBe(false);
  });

  it("degrades to false (never throws) when a side has no sources", () => {
    const t = new Mob(censusDoc("I1", "United States Census, 1900"), "I1");
    const c = new Mob(censusDoc("C1", null), "C1");
    expect(hasSameCensus(t, c)).toBe(false);
  });

  // #4503: tree census titles are per-person or `Entry for …`, never the bare
  // collection title a compacted record_read answer is rebuilt with.
  const shapes = [
    'Henry Gaetjen, "United States Census, 1900"',
    'Entry for John Becker and Louisa Becker, "United States, Census, 1900"',
    "United States Census, 1900",
  ];
  for (const a of shapes) {
    for (const b of shapes) {
      it(`matches the collection across title shapes: ${a} ~ ${b}`, () => {
        const t = new Mob(censusDoc("I1", a), "I1");
        const c = new Mob(censusDoc("C1", b), "C1");
        expect(hasSameCensus(t, c)).toBe(true);
      });
    }
  }

  it("does not match two census years in the per-person and Entry-for shapes", () => {
    const t = new Mob(censusDoc("I1", 'Henry Gaetjen, "United States Census, 1900"'), "I1");
    const c = new Mob(censusDoc("C1", 'Entry for Henry Gaetjen, "United States, Census, 1910"'), "C1");
    expect(hasSameCensus(t, c)).toBe(false);
  });

  it("a tree person citing no source does not read another tree person's census", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        { id: "A", gender: "Male", names: [{ given: "Jimmie", surname: "Neal" }], facts: [] },
        {
          id: "B",
          gender: "Female",
          names: [{ given: "Martha", surname: "Hamby" }],
          facts: [{ id: "F1", type: "Census", date: "1900", sources: [{ ref: "S1" }] }],
        },
      ],
      sources: [{ id: "S1", title: 'Martha J Hamby, "United States, Census, 1900"' }],
    };
    const c = new Mob(censusDoc("C1", "United States Census, 1900"), "C1");
    expect(hasSameCensus(new Mob(tree, "B"), c)).toBe(true);
    expect(hasSameCensus(new Mob(tree, "A"), c)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasEventsOutsideLifespan — two-mob lifespan comparison
// ────────────────────────────────────────────────────────────────────

const lifespanDoc = (
  id: string,
  facts: Array<{ type: string; date: string }>,
): SimplifiedGedcomX => ({
  persons: [
    {
      id,
      gender: "Male",
      names: [{ given: "John", surname: "Smith" }],
      facts: facts.map((f, i) => ({
        id: `F${i}`,
        type: f.type,
        date: f.date,
        standard_date: f.date,
      })),
    },
  ],
});

describe("hasEventsOutsideLifespan", () => {
  it("returns 'far' when an event is well past the other mob's death", () => {
    const target = new Mob(lifespanDoc("I1", [{ type: "Census", date: "1910" }]), "I1");
    const candidate = new Mob(
      lifespanDoc("C1", [
        { type: "Birth", date: "1830" },
        { type: "Death", date: "1900" },
      ]),
      "C1",
    );
    expect(hasEventsOutsideLifespan(target, candidate)).toBe("far");
  });

  it("returns 'none' when events sit inside the other mob's lifespan", () => {
    const target = new Mob(lifespanDoc("I1", [{ type: "Residence", date: "1870" }]), "I1");
    const candidate = new Mob(
      lifespanDoc("C1", [
        { type: "Birth", date: "1830" },
        { type: "Death", date: "1900" },
      ]),
      "C1",
    );
    expect(hasEventsOutsideLifespan(target, candidate)).toBe("none");
  });

  it("short-circuits to 'none' when target and candidate are the same mob (single-anchor mode)", () => {
    // Census-after-death on a single record is caught by hasEventAfterDeath, not
    // this two-mob check — so single-anchor mode must not flag it.
    const mob = new Mob(
      lifespanDoc("I1", [
        { type: "Birth", date: "1830" },
        { type: "Death", date: "1900" },
        { type: "Census", date: "1910" },
      ]),
      "I1",
    );
    expect(hasEventsOutsideLifespan(mob, mob)).toBe("none");
  });
});

// ────────────────────────────────────────────────────────────────────
// hasSameMarriageDate + birthRangeGreaterThan
// ────────────────────────────────────────────────────────────────────

const marriageDoc = (id: string, marriageDate: string | null): SimplifiedGedcomX => ({
  persons: [
    {
      id,
      gender: "Male",
      names: [{ given: "John", surname: "Smith" }],
      facts: marriageDate
        ? [{ id: "M1", type: "Marriage", date: marriageDate, standard_date: marriageDate }]
        : [],
    },
  ],
});

describe("hasSameMarriageDate", () => {
  it("fires when both mobs share a perfect (full-DMY) marriage date", () => {
    const a = new Mob(marriageDoc("I1", "15 Jun 1855"), "I1");
    const b = new Mob(marriageDoc("C1", "15 Jun 1855"), "C1");
    expect(hasSameMarriageDate(a, b)).toBe(true);
  });

  it("does not fire for different marriage dates", () => {
    const a = new Mob(marriageDoc("I1", "15 Jun 1855"), "I1");
    const b = new Mob(marriageDoc("C1", "20 Jul 1860"), "C1");
    expect(hasSameMarriageDate(a, b)).toBe(false);
  });

  it("does not count year-only marriage dates (Java onlyPerfect=true)", () => {
    const a = new Mob(marriageDoc("I1", "1855"), "I1");
    const b = new Mob(marriageDoc("C1", "1855"), "C1");
    expect(hasSameMarriageDate(a, b)).toBe(false);
  });

  it("does not fire when a side has no marriage fact", () => {
    const a = new Mob(marriageDoc("I1", "15 Jun 1855"), "I1");
    const b = new Mob(marriageDoc("C1", null), "C1");
    expect(hasSameMarriageDate(a, b)).toBe(false);
  });
});

describe("birthRangeGreaterThan", () => {
  const birthDoc = (dates: string[]): SimplifiedGedcomX => ({
    persons: [
      {
        id: "I1",
        gender: "Male",
        names: [{ given: "John", surname: "Smith" }],
        facts: dates.map((d, i) => ({
          id: `F${i}`,
          type: "Birth",
          date: d,
          standard_date: d,
        })),
      },
    ],
  });

  it("fires when two perfect Birth dates span more than the threshold years", () => {
    const mob = new Mob(birthDoc(["1 Jan 1850", "1 Jan 1856"]), "I1");
    expect(birthRangeGreaterThan(mob, 3)).toBe(true);
    expect(birthRangeGreaterThan(mob, 8)).toBe(false);
  });

  it("does not fire on year-only births (perfect dates only, ≥2 required)", () => {
    const mob = new Mob(birthDoc(["1850", "1860"]), "I1");
    expect(birthRangeGreaterThan(mob, 3)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// calculateWarnings — merge mode with two distinct mobs
// ────────────────────────────────────────────────────────────────────

describe("calculateWarnings (merge mode, distinct mobs)", () => {
  // The impossibility checks run in the final-warnings block, which merge mode
  // runs too, so a merge that joins a birth to an earlier death returns a
  // `contradiction` — the severity the merge agent treats as a block.
  it("returns hasDeathBeforeBirth as a contradiction when a merge joins a birth to an earlier death", () => {
    const one = (facts: object[]): SimplifiedGedcomX => ({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N", given: "Jan", surname: "Kos" }], facts }],
      relationships: [],
    } as SimplifiedGedcomX);
    const birth = { id: "B", type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" };
    const death = { id: "D", type: "Death", date: "1 Jan 1840", standard_date: "1 Jan 1840" };
    const target = new Mob(one([birth]), "I1");
    const candidate = new Mob(one([death]), "I1");
    const merged = new Mob(one([birth, death]), "I1");

    const w = calculateWarnings(target, candidate, merged, false).find(
      (x) => x.issueType === "hasDeathBeforeBirth",
    );
    expect(w?.severity).toBe("contradiction");
    expect(
      calculateWarnings(target, target, target, false).map((x) => x.issueType),
    ).not.toContain("hasDeathBeforeBirth");
  });

  it("emits hasSameCensus (error) in merge mode but never in final mode", () => {
    const targetDoc = censusDoc("I1", "1900 U.S. Federal Census");
    const candDoc = censusDoc("C1", "1900 U.S. Federal Census");
    const target = new Mob(targetDoc, "I1");
    const candidate = new Mob(candDoc, "C1");
    // merged mob shape doesn't matter for hasSameCensus — reuse target.
    const merged = new Mob(targetDoc, "I1");

    const mergeTags = calculateWarnings(target, candidate, merged, false).map(
      (w) => w.issueType,
    );
    expect(mergeTags).toContain("hasSameCensus");

    // Final mode (single anchor) never runs the merge-only bucket.
    const finalTags = calculateWarnings(target, target, target, true).map(
      (w) => w.issueType,
    );
    expect(finalTags).not.toContain("hasSameCensus");
  });

  it("the hasSameCensus warning is a blocking error with mobRole candidate", () => {
    const target = new Mob(censusDoc("I1", "United States Census, 1880"), "I1");
    const candidate = new Mob(censusDoc("C1", "United States Census, 1880"), "C1");
    const w = calculateWarnings(target, candidate, target, false).find(
      (x) => x.issueType === "hasSameCensus",
    );
    expect(w?.severity).toBe("contradiction");
    expect(w?.mobRole).toBe("candidate");
    expect(w?.relatedPersonId).toBe("C1");
  });

  it("birthLikeRangeGreaterThan8 fires in merge mode (distinct mobs, no shared marriage) but is silent single-anchor", () => {
    const person = (id: string, births: string[]): SimplifiedGedcomX => ({
      persons: [
        {
          id,
          gender: "Male",
          names: [{ given: "John", surname: "Smith" }],
          facts: births.map((d, i) => ({
            id: `F${i}`,
            type: "Birth",
            date: d,
            standard_date: d,
          })),
        },
      ],
    });
    const target = new Mob(person("I1", ["1850"]), "I1");
    const candidate = new Mob(person("C1", ["1862"]), "C1");
    // merged mob carries the union — birth-like span 12y > 8.
    const merged = new Mob(person("M1", ["1850", "1862"]), "M1");

    const mergeTags = calculateWarnings(target, candidate, merged, false).map(
      (w) => w.issueType,
    );
    expect(mergeTags).toContain("birthLikeRangeGreaterThan8");

    // Single-anchor mode: short-circuits (target === candidate) → silent, even
    // though the mob has a wide birth-like range and no marriage date.
    const finalTags = calculateWarnings(merged, merged, merged, true).map(
      (w) => w.issueType,
    );
    expect(finalTags).not.toContain("birthLikeRangeGreaterThan8");
    expect(finalTags).not.toContain("birthRangeGreaterThan3");
  });

  it("the birth-range guard suppresses when target and candidate share a perfect marriage date", () => {
    const person = (id: string, birth: string): SimplifiedGedcomX => ({
      persons: [
        {
          id,
          gender: "Male",
          names: [{ given: "John", surname: "Smith" }],
          facts: [
            { id: "F0", type: "Birth", date: birth, standard_date: birth },
            { id: "M0", type: "Marriage", date: "15 Jun 1880", standard_date: "15 Jun 1880" },
          ],
        },
      ],
    });
    const target = new Mob(person("I1", "1850"), "I1");
    const candidate = new Mob(person("C1", "1862"), "C1");
    const merged = new Mob(
      {
        persons: [
          {
            id: "M1",
            gender: "Male",
            names: [{ given: "John", surname: "Smith" }],
            facts: [
              { id: "F0", type: "Birth", date: "1850", standard_date: "1850" },
              { id: "F1", type: "Birth", date: "1862", standard_date: "1862" },
              { id: "M0", type: "Marriage", date: "15 Jun 1880", standard_date: "15 Jun 1880" },
            ],
          },
        ],
      },
      "M1",
    );
    const tags = calculateWarnings(target, candidate, merged, false).map(
      (w) => w.issueType,
    );
    expect(tags).not.toContain("birthLikeRangeGreaterThan8");
  });
});

// ────────────────────────────────────────────────────────────────────
// merge_warnings tool — end-to-end dry-run against a temp project
// ────────────────────────────────────────────────────────────────────

const minimalResearch = {
  project: {
    id: "rp_001",
    objective: "Test",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
    subject_person_ids: ["I1"],
  },
  questions: [],
  plans: [],
  log: [],
  sources: [],
  assertions: [],
  person_evidence: [],
  conflicts: [],
  hypotheses: [],
  timelines: [],
  proof_summaries: [],
  evaluations: [],
};

describe("merge_warnings tool", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-warnings-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any, research: any = minimalResearch) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const exists = async (name: string) =>
    access(join(dir, name)).then(() => true, () => false);

  it("a drift-only project does not make the dry-run report a rejection (#1572 flip)", async () => {
    // The project carries a pre-existing additionalProperties drift on `project`;
    // the proposed merge itself is valid. Before #1572 the dry-run returned
    // { ok: false } — reading the pre-existing drift as "a real merge would be
    // rejected here". Now the merge is clean, so it returns { ok: true }: the
    // drift is not the merge's fault. merge_warnings' { ok: false } is an answer
    // ("would be rejected"), not a tool failure, so the flip is the point.
    const research = { ...minimalResearch, project: { ...minimalResearch.project, legacy_field: "x" } };
    await writeProject(
      {
        persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
        relationships: [],
        sources: [],
      },
      research,
    );

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [{ id: "C1", gender: "Male", names: [{ id: "NC", given: "John", surname: "Smith" }] }],
        relationships: [],
        sources: [],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
  });

  it("blocks a planted impossibility: a census event after the tree person's death", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
          facts: [
            { id: "F1", type: "Birth", date: "1830", standard_date: "1830" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
          ],
        },
      ],
      relationships: [],
      sources: [],
    });

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          {
            id: "C1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Smith" }],
            facts: [
              { id: "F1", type: "Census", date: "1910", standard_date: "1910" },
            ],
          },
        ],
        relationships: [],
        sources: [],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const errors = result.warnings.filter((w) => w.severity === "contradiction");
    expect(errors.length).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.issueType)).toContain(
      "hasEventsOutsideLifespanFar",
    );
    // read-only — nothing written.
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("flags hasSameCensus when tree and candidate cite the same census", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N1", given: "Mary", surname: "Flynn" }],
          facts: [
            {
              id: "F1",
              type: "Census",
              date: "1900",
              standard_date: "1900",
              sources: [{ ref: "S1" }],
            },
          ],
        },
      ],
      relationships: [],
      sources: [{ id: "S1", title: "United States Census, 1900" }],
    });

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          {
            id: "C1",
            gender: "Female",
            names: [{ id: "N1", given: "Mary", surname: "Flynn" }],
            facts: [
              {
                id: "F1",
                type: "Census",
                date: "1900",
                standard_date: "1900",
                sources: [{ ref: "S1" }],
              },
            ],
          },
        ],
        relationships: [],
        sources: [{ id: "S1", title: "United States Census, 1900" }],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sameCensus = result.warnings.find((w) => w.issueType === "hasSameCensus");
    expect(sameCensus).toBeDefined();
    expect(sameCensus?.severity).toBe("contradiction");
  });

  it("returns a clean result for a coherent merge", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
          facts: [
            { id: "F1", type: "Birth", date: "1830", standard_date: "1830" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
          ],
        },
      ],
      relationships: [],
      sources: [],
    });

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          {
            id: "C1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Smith" }],
            facts: [
              { id: "F1", type: "Residence", date: "1870", standard_date: "1870" },
            ],
          },
        ],
        relationships: [],
        sources: [],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.filter((w) => w.severity === "contradiction")).toEqual([]);
  });

  it("returns { ok: false, errors } for a malformed merge (unknown id)", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
        },
      ],
      relationships: [],
      sources: [],
    });

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          { id: "C1", gender: "Male", names: [{ id: "N1", given: "J", surname: "Smith" }] },
        ],
        relationships: [],
        sources: [],
      },
      merges: [["NOPE", "C1"]],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/NOPE not found in target/);
    expect(result.errors.join(" ")).toContain("tree ids: I1");
    expect(result.errors.join(" ")).toContain("leave a new person's persona out of merges");
  });

  // Issue #4345: the interleaved-children tag is `implausible`, which is advisory
  // in merge_warnings; only `contradiction` blocks a merge there.
  it("reports hasInterleavedChildrenIgnoreSimilarSpouses as implausible, not a block", async () => {
    const birth = (id: string, date: string) => ({ id, type: "Birth", date, standard_date: date });
    await writeProject({
      persons: [
        { id: "H", gender: "Male", names: [{ id: "NH", given: "Henry", surname: "Ward" }] },
        { id: "A", gender: "Female", names: [{ id: "NA", given: "Agnes", surname: "Brown" }] },
        { id: "A1", gender: "Male", names: [{ id: "NA1", given: "Albert", surname: "Ward" }], facts: [birth("A1B", "1850")] },
        { id: "A2", gender: "Male", names: [{ id: "NA2", given: "Arthur", surname: "Ward" }], facts: [birth("A2B", "1860")] },
      ],
      relationships: [
        { id: "R1", type: "Couple", person1: "H", person2: "A" },
        { id: "R2", type: "ParentChild", parent: "H", child: "A1" },
        { id: "R3", type: "ParentChild", parent: "A", child: "A1" },
        { id: "R4", type: "ParentChild", parent: "H", child: "A2" },
        { id: "R5", type: "ParentChild", parent: "A", child: "A2" },
      ],
      sources: [],
    });

    // The record: Henry with a second wife, Bertha, and their son born 1855.
    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          { id: "C1", gender: "Male", names: [{ id: "N1", given: "Henry", surname: "Ward" }] },
          { id: "C2", gender: "Female", names: [{ id: "N2", given: "Bertha", surname: "Clark" }] },
          { id: "C3", gender: "Male", names: [{ id: "N3", given: "Xavier", surname: "Ward" }], facts: [birth("XB", "1855")] },
        ],
        relationships: [
          { id: "CR1", type: "Couple", person1: "C1", person2: "C2" },
          { id: "CR2", type: "ParentChild", parent: "C1", child: "C3" },
          { id: "CR3", type: "ParentChild", parent: "C2", child: "C3" },
        ],
        sources: [],
      },
      merges: [["H", "C1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.warnings.filter((w) => w.issueType === "hasInterleavedChildrenIgnoreSimilarSpouses");
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe("implausible");
    expect(result.warnings.filter((w) => w.severity === "contradiction")).toEqual([]);
  });

  it("candidate with one paired and one unpaired persona returns ok: true", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
        },
      ],
      relationships: [],
      sources: [],
    });

    const result = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          { id: "C1", gender: "Male", names: [{ id: "N1", given: "J", surname: "Smith" }] },
          { id: "C2", gender: "Female", names: [{ id: "N2", given: "Jane", surname: "Smith" }] },
        ],
        relationships: [],
        sources: [],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// sanitize parity — the dry-run must merge the same document the writer
// would, and must surface what sanitation dropped BEFORE the write decision
// ────────────────────────────────────────────────────────────────────

describe("mergeWarnings sanitize parity", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-warnings-sanitize-"));
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        questions: [], plans: [], log: [], sources: [], assertions: [],
        person_evidence: [], conflicts: [], hypotheses: [], timelines: [],
        proof_summaries: [], evaluations: [],
      }),
    );
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [
          {
            id: "I1",
            gender: "Male",
            names: [{ id: "N1", preferred: false, given: "John", surname: "Smith" }],
          },
        ],
        relationships: [],
        sources: [],
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a record_read-shaped candidate (person sources + places) and surfaces the drops", async () => {
    const candidate: any = {
      persons: [
        {
          id: "p1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
          sources: [{ ref: "#S9" }],
        },
      ],
      places: [{ id: "P1", name: "Ogden, Utah" }],
    };
    const result: any = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: candidate,
      merges: [["I1", "p1"]],
    });
    expect(result.ok).toBe(true);
    expect(result.sanitizeWarnings.some((w: string) => w.includes("place"))).toBe(true);
    expect(result.sanitizeWarnings.some((w: string) => w.includes("person-level source"))).toBe(true);
    // The legacy preferred:false on the on-disk tree is healed in memory too.
    expect(result.sanitizeWarnings.some((w: string) => w.includes("'preferred: false'"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// a record_read answer as candidateGedcomx, full or compacted (#4415)
// ────────────────────────────────────────────────────────────────────

describe("merge_warnings takes a record_read answer, full or compacted", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-warnings-record-read-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeTree = (tree: unknown) =>
    writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
  const compacted = (r: unknown, id: string) =>
    compactRecordReadAnswer(structuredClone(r) as RecordReadResult, id);
  const warningKeys = (ws: Array<Record<string, unknown>>) =>
    ws
      .map((w) => JSON.stringify([w.issueType, w.personId, w.relatedPersonId, w.severity, w.mobRole]))
      .sort();

  it("a compacted Tallman answer gives the same warnings as the full one, and both are ok", async () => {
    // Orrin Tallman dies in 1930 on the record; the tree has him dead in 1900.
    await writeTree({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "Orrin", surname: "Tallman" }],
          facts: [
            { id: "F1", type: "Birth", date: "1878", standard_date: "1878" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
          ],
        },
      ],
      relationships: [],
      sources: [],
    });
    const f = loadRecordReadFixture("record-read-tallman-2v7m-6qm.json");
    const merges: Array<[string, string]> = [["I1", "p_15021461819"]];

    const full: any = await mergeWarnings({ projectPath: dir, candidateGedcomx: structuredClone(f.response), merges });
    const small: any = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: compacted(f.response, f.recordId),
      merges,
    });
    expect(full.ok, JSON.stringify(full.errors)).toBe(true);
    expect(small.ok, JSON.stringify(small.errors)).toBe(true);
    expect(full.warnings.length).toBeGreaterThan(0);
    expect(warningKeys(small.warnings)).toEqual(warningKeys(full.warnings));
  });

  it("hasSameCensus fires on a compacted census answer through the source rebuilt from its citation", async () => {
    await writeTree({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Becker" }],
          facts: [{ id: "F1", type: "Census", date: "1900", standard_date: "1900", sources: [{ ref: "S9" }] }],
        },
      ],
      relationships: [],
      sources: [{ id: "S9", title: "United States, Census, 1900" }],
    });
    const f = loadRecordReadFixture("record-read-becker-1900-mm8c-43q.json");
    const result: any = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: compacted(f.response, f.recordId),
      merges: [["I1", "p_1"]],
    });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.warnings.map((w: any) => w.issueType)).toContain("hasSameCensus");
    expect(result.sanitizeWarnings.some((w: string) => w.includes("built source S1"))).toBe(true);
  });

  it("a compacted 150-persona answer with stubs and omissions is ok", async () => {
    await writeTree({
      persons: [{ id: "I1", gender: "Female", names: [{ id: "N1", given: "Given0", surname: "Householder" }] }],
      relationships: [],
      sources: [],
    });
    const answer = compacted(syntheticHousehold(150), "AB00-XYZ");
    expect(answer.personsOmitted).toBeGreaterThan(0);
    const result: any = await mergeWarnings({ projectPath: dir, candidateGedcomx: answer, merges: [["I1", "p_1000"]] });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("a live-shaped answer with a Sibling relationship is ok, and the drop is reported", async () => {
    await writeTree({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "A", surname: "B" }] }],
      relationships: [],
      sources: [],
    });
    const answer = {
      persons: [
        { id: "a", names: [{ given: "A", surname: "B" }], facts: [{ type: "Birth", date: "1850" }] },
        { id: "b", gender: "Female", names: [{ given: "C" }] },
      ],
      relationships: [
        { id: "r1", type: "http://familysearch.org/types/relationships/Sibling", person1: "a", person2: "b" },
      ],
      sources: [{ id: "sd_da1", resource_type: "DigitalArtifact", url: "https://x/ark:/61903/3:1:Q" }],
    };
    const result: any = await mergeWarnings({ projectPath: dir, candidateGedcomx: answer, merges: [["I1", "a"]] });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.sanitizeWarnings.some((w: string) => w.includes("not ParentChild or Couple"))).toBe(true);
    expect(result.sanitizeWarnings.some((w: string) => w.includes("with no title"))).toBe(true);
  });

  it("a compacted hand-written fixture with no Record source is ok", async () => {
    await writeTree({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "George", surname: "Ackerman" }] }],
      relationships: [],
      sources: [],
    });
    const f = loadRecordReadFixture("record-read-ackerman-1860-m7qz-8kd.json");
    const answer = compacted(f.response, f.recordId);
    expect(answer.recordUrl).toBeUndefined();
    const result: any = await mergeWarnings({ projectPath: dir, candidateGedcomx: answer, merges: [["I1", "p1"]] });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  // #4503: the 1870 Horace Stevens household, 11 personas each with its own
  // `1:1:` ark, Record url `1:2:M4TT-9LP`. The tree's Edward Tallman cites one
  // 1870 census source, titled per person; only its url varies.
  const EDWARD = "p_280302831"; // ark:/61903/1:1:M8N9-JJL
  const sameCensusOnTallman = async (url: string): Promise<boolean> => {
    await writeTree({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "Edward", surname: "Tallman" }],
          facts: [{ id: "F1", type: "Census", date: "1870", standard_date: "1870", sources: [{ ref: "S9" }] }],
        },
      ],
      relationships: [],
      sources: [{ id: "S9", title: 'Edward Tallman, "United States, Census, 1870"', url }],
    });
    const f = loadRecordReadFixture("record-read-tallman-m8n9-jjl.json");
    const result: any = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: compacted(f.response, f.recordId),
      merges: [["I1", EDWARD]],
    });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    return result.warnings.some((w: any) => w.issueType === "hasSameCensus");
  };

  it("hasSameCensus skips a tree source on the paired persona's own ark, written as a resolver url", async () => {
    expect(await sameCensusOnTallman("https://familysearch.org/ark:/61903/1:1:M8N9-JJL")).toBe(false);
  });

  it("hasSameCensus skips a tree source on the candidate's record ark", async () => {
    expect(await sameCensusOnTallman("https://familysearch.org/ark:/61903/1:2:M4TT-9LP")).toBe(false);
  });

  it("hasSameCensus fires on household member X's ark paired with persona Y of the same record", async () => {
    // Horace Stevens' persona ark, paired with Edward Tallman.
    expect(await sameCensusOnTallman("https://www.familysearch.org/ark:/61903/1:1:M8N9-JJN")).toBe(true);
  });

  it("hasSameCensus fires on a different record's ark in the same census collection", async () => {
    expect(await sameCensusOnTallman("https://www.familysearch.org/ark:/61903/1:1:ZZZZ-999")).toBe(true);
  });
});
