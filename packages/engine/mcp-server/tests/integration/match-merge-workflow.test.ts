// Integration test for the match + merge workflow (spec §3, §13).
//
// Exercises the full deterministic chain at the tool layer:
//   coherence gate (merge_warnings) -> merge (merge_record_into_tree)
// on the canonical census-household scenario, plus a planted-impossibility
// variant that the gate must block. No network — fully controlled inputs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { mergeWarnings } from "../../src/tools/merge-warnings.js";
import { mergeRecordIntoTree } from "../../src/tools/merge-record-into-tree.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

// Tree: John (I1) + Susan (I2, spouse) + William (I3, child), plus the stub
// Mary (I4) person-evidence created (always-pair, stub-first) — she has no
// facts yet, only a name. This is the pre-merge state proof-conclusion holds.
const startingTree: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Bell" }],
      facts: [
        { id: "F1", type: "Birth", date: "1840", standard_date: "1840" },
        { id: "F2", type: "Death", date: "1905", standard_date: "1905" },
      ],
    },
    {
      id: "I2",
      gender: "Female",
      names: [{ id: "N2", given: "Susan", surname: "Bell" }],
      facts: [{ id: "F3", type: "Birth", date: "1845", standard_date: "1845" }],
    },
    {
      id: "I3",
      gender: "Male",
      names: [{ id: "N4", given: "William", surname: "Bell" }],
      facts: [{ id: "F4", type: "Birth", date: "1865", standard_date: "1865" }],
    },
    // Mary's stub (always-pair): name only, no facts yet.
    { id: "I4", gender: "Female", names: [{ id: "N5", given: "Mary", surname: "Bell" }] },
  ],
  relationships: [
    { id: "R1", type: "Couple", person1: "I1", person2: "I2" },
    { id: "R2", type: "ParentChild", parent: "I1", child: "I3" },
    { id: "R3", type: "ParentChild", parent: "I2", child: "I3" },
  ],
  sources: [],
};

// 1880 census listing John, Susan, Bill (= William, nickname), and Mary.
const censusCandidate: SimplifiedGedcomX = {
  persons: [
    {
      id: "C1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Bell" }],
      facts: [
        { id: "F1", type: "Census", date: "1880", standard_date: "1880", sources: [{ ref: "S1" }] },
      ],
    },
    {
      id: "C2",
      gender: "Female",
      names: [{ id: "N1", given: "Susan", surname: "Bell" }],
      facts: [
        { id: "F1", type: "Census", date: "1880", standard_date: "1880", sources: [{ ref: "S1" }] },
      ],
    },
    {
      id: "C3",
      gender: "Male",
      names: [{ id: "N1", given: "Bill", surname: "Bell" }],
      facts: [
        { id: "F1", type: "Census", date: "1880", standard_date: "1880", sources: [{ ref: "S1" }] },
      ],
    },
    {
      id: "C4",
      gender: "Female",
      names: [{ id: "N1", given: "Mary", surname: "Bell" }],
      facts: [
        { id: "F1", type: "Birth", date: "1878", standard_date: "1878" },
        { id: "F2", type: "Census", date: "1880", standard_date: "1880", sources: [{ ref: "S1" }] },
      ],
    },
  ],
  relationships: [
    { id: "R1", type: "Couple", person1: "C1", person2: "C2" },
    { id: "R2", type: "ParentChild", parent: "C1", child: "C3" },
    { id: "R3", type: "ParentChild", parent: "C1", child: "C4" },
  ],
  sources: [{ id: "S1", title: "United States Census, 1880" }],
};

const minimalResearch = {
  project: {
    id: "rp_001",
    objective: "Test",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
    subject_person_ids: ["I1", "I2", "I3", "I4"],
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

// The always-paired merge set (Mary's stub I4 is the survivor for census Mary).
const merges: Array<[string, string]> = [
  ["I1", "C1"],
  ["I2", "C2"],
  ["I3", "C3"],
  ["I4", "C4"],
];

describe("match + merge workflow (integration)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "match-merge-int-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: SimplifiedGedcomX) {
    await writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readTree = async (): Promise<SimplifiedGedcomX> =>
    JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));

  it("clean household: gate passes, then the merge adds Mary once and updates John/Susan/William", async () => {
    await writeProject(startingTree);

    // 1. Coherence gate (dry-run) — no blocking errors on a coherent household.
    const gate = await mergeWarnings({ projectPath: dir, candidateGedcomx: censusCandidate, merges });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.warnings.filter((w) => w.severity === "error")).toEqual([]);

    // 2. Execute the same merge.
    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: censusCandidate,
      merges,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tree = await readTree();
    const byId = new Map((tree.persons ?? []).map((p) => [p.id, p]));

    // Mary appears exactly once (her stub I4 received the census facts — not a
    // duplicate new person).
    const marys = (tree.persons ?? []).filter((p) =>
      (p.names ?? []).some((n) => n.given === "Mary"),
    );
    expect(marys).toHaveLength(1);
    expect(marys[0].id).toBe("I4");
    expect((marys[0].facts ?? []).some((f) => f.type === "Census")).toBe(true);

    // John / Susan / William each gained the census fact (survivors updated).
    for (const id of ["I1", "I2", "I3"]) {
      const facts = byId.get(id)?.facts ?? [];
      expect(facts.some((f) => f.type === "Census" && f.standard_date === "1880")).toBe(true);
    }

    // No census persona carried in as a stray new person — person count is the
    // original 4 (the four pairs all folded into existing tree persons).
    expect((tree.persons ?? []).length).toBe(4);
  });

  it("planted impossibility: a census after John's death blocks at the gate", async () => {
    await writeProject(startingTree);

    // John (I1) died 1905; plant a 1920 census on census-John (C1).
    const badCandidate: SimplifiedGedcomX = JSON.parse(JSON.stringify(censusCandidate));
    badCandidate.persons![0].facts = [
      { id: "F1", type: "Census", date: "1920", standard_date: "1920", sources: [{ ref: "S1" }] },
    ];

    const gate = await mergeWarnings({ projectPath: dir, candidateGedcomx: badCandidate, merges });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const errors = gate.warnings.filter((w) => w.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(gate.warnings.map((w) => w.issueType)).toContain("hasEventsOutsideLifespanFar");
  });

  it("re-merge: a census already attached to the tree is flagged by hasSameCensus", async () => {
    // Tree already carries the 1880 census on John (a prior run attached it).
    const treeWithCensus: SimplifiedGedcomX = JSON.parse(JSON.stringify(startingTree));
    treeWithCensus.persons![0].facts!.push({
      id: "F9",
      type: "Census",
      date: "1880",
      standard_date: "1880",
      sources: [{ ref: "S1" }],
    });
    treeWithCensus.sources = [{ id: "S1", title: "United States Census, 1880" }];
    await writeProject(treeWithCensus);

    const gate = await mergeWarnings({
      projectPath: dir,
      candidateGedcomx: censusCandidate,
      merges: [["I1", "C1"]],
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const sameCensus = gate.warnings.find((w) => w.issueType === "hasSameCensus");
    expect(sameCensus?.severity).toBe("error");
  });
});
