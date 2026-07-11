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
    expect(w?.severity).toBe("error");
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
    const errors = result.warnings.filter((w) => w.severity === "error");
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
    expect(sameCensus?.severity).toBe("error");
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
    expect(result.warnings.filter((w) => w.severity === "error")).toEqual([]);
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
