// The upgrade-compat contract: a project tree written before the validator
// tightening (preferred:false from the old mergeNames, person-level sources,
// top-level places, invented fact keys) must not brick the project. The tools
// heal it at read; the first successful tree write persists the healed
// document (a one-shot migration); research_append validates against the
// healed shape without touching the file.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { treeEdit } from "../../src/tools/tree-edit.js";
import { researchAppend } from "../../src/tools/research-append.js";

const minimalResearch = {
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [], sources: [], assertions: [],
  person_evidence: [], conflicts: [], hypotheses: [], timelines: [],
  proof_summaries: [], evaluations: [],
};

// What a real pre-tightening project tree looks like (shapes taken from the
// repo's own runlog final trees): the old merge wrote preferred:false, the
// old spec carried places[], the open-shape validator let invented keys and
// person-level sources persist.
const legacyTree = () => ({
  persons: [
    {
      id: "I1",
      living: false,
      gender: "Male",
      sources: [{ ref: "S1" }],
      names: [
        { id: "N1", preferred: true, given: "John", surname: "Smith" },
        { id: "N2", preferred: false, given: "Jack", surname: "Smith" },
      ],
      facts: [{ id: "F1", type: "Birth", date: "1900", date_certainty: "high" }],
    },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "1900 Census" }],
  places: [{ id: "P1", name: "Ogden, Utah" }],
});

describe("tree_edit on a legacy (pre-tightening) tree", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-edit-legacy-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(legacyTree(), null, 2));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("heals the tree, persists the healed document, and narrates the repairs", async () => {
    const result: any = await treeEdit({
      operation: "update_person",
      projectPath: dir,
      personId: "I1",
      gender: "Male",
    });
    expect(result.ok).toBe(true);
    expect(result.validation.warnings.some((w: string) => w.includes("'preferred: false'"))).toBe(true);
    expect(result.validation.warnings.some((w: string) => w.includes("places section"))).toBe(true);

    const persisted = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    expect(persisted.places).toBeUndefined();
    expect(persisted.persons[0].sources).toBeUndefined();
    expect("preferred" in persisted.persons[0].names[1]).toBe(false);
    expect("date_certainty" in persisted.persons[0].facts[0]).toBe(false);
    expect(persisted.persons[0].names[0].preferred).toBe(true); // the true flag survives
  });

  it("does not brick research_append, and leaves the tree file untouched", async () => {
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const result: any = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: {
        gedcomx_source_description_id: "S1",
        citation: "1900 U.S. Census, Weber County, Utah",
        citation_detail: {
          who: "John Smith household",
          what: "census enumeration",
          when_created: "1900-06-01",
          when_accessed: "2026-07-10",
          where: "Weber County, Utah",
          where_within: "dwelling 84",
        },
        source_classification: "original",
        repository: "NARA",
        access_date: "2026-07-10",
      },
    });
    expect(result.ok).toBe(true);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before);
  });
});
