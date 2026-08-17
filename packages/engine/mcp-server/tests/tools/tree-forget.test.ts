import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { treeForget, RESTORE_FILE } from "../../src/tools/tree-forget.js";

const minimalResearch = {
  project: {
    id: "rp_001",
    objective: "Test",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
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

/**
 * A subject (I1) with two parents (I2/I3), a sibling (I4), a spouse (I5), and a
 * child (I6). I2+I3 are also a Couple with a Marriage fact, which is what makes
 * the cascade interesting: removing I2 takes the marriage and the sibling link
 * with it.
 */
const family = () => ({
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "Patrick", surname: "Ryan", preferred: true }],
      facts: [
        { id: "F1", type: "Birth", date: "1850", place: "Cork, Ireland", primary: true },
        { id: "F2", type: "Death", date: "1910", primary: true },
        { id: "F3", type: "Residence", date: "1880" },
      ],
    },
    { id: "I2", gender: "Male", names: [{ id: "N2", given: "Michael", surname: "Ryan", preferred: true }] },
    { id: "I3", gender: "Female", names: [{ id: "N3", given: "Mary", surname: "Doyle", preferred: true }] },
    { id: "I4", gender: "Female", names: [{ id: "N4", given: "Bridget", surname: "Ryan", preferred: true }] },
    { id: "I5", gender: "Female", names: [{ id: "N5", given: "Ellen", surname: "Walsh", preferred: true }] },
    { id: "I6", gender: "Male", names: [{ id: "N6", given: "John", surname: "Ryan", preferred: true }] },
  ],
  relationships: [
    { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
    { id: "R2", type: "ParentChild", parent: "I3", child: "I1" },
    { id: "R3", type: "ParentChild", parent: "I2", child: "I4" },
    { id: "R4", type: "ParentChild", parent: "I3", child: "I4" },
    {
      id: "R5",
      type: "Couple",
      person1: "I2",
      person2: "I3",
      facts: [{ id: "F4", type: "Marriage", date: "1845" }],
    },
    { id: "R6", type: "Couple", person1: "I1", person2: "I5" },
    { id: "R7", type: "ParentChild", parent: "I1", child: "I6" },
  ],
  sources: [],
});

describe("tree_forget", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-forget-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any, research: any = minimalResearch) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf-8");
  }
  const readTree = async () =>
    JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (rel: string) =>
    access(join(dir, rel)).then(
      () => true,
      () => false,
    );

  // ─── selectors ─────────────────────────────────────────────────────────────

  it("parents-of removes both parents and cascades their other relationships", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // I2 and I3 go; R1/R2 named directly; R3/R4 (sibling links) and R5 (their
    // marriage) cascade off the removed persons.
    expect(r.removed.persons).toBe(2);
    expect(r.removed.relationships).toBe(5);
    expect(r.removed.relationshipsCascaded).toBe(3);
    expect(r.remaining).toEqual({ persons: 4, relationships: 2 });

    const tree = await readTree();
    expect(tree.persons.map((p: any) => p.id)).toEqual(["I1", "I4", "I5", "I6"]);
    expect(tree.relationships.map((x: any) => x.id)).toEqual(["R6", "R7"]);
  });

  it("parents-of also strips the subject's own `Parents` documentary fact", async () => {
    // FamilySearch carries parentage twice — as ParentChild links AND as a
    // `Parents` fact on the child's record (issue #1314). This is a real FS
    // person-level fact type, not a fixture invention: confirmed in the
    // feedback-2026-08-03T15-36-45 session log, in a `person_read` RESULT (so
    // upstream output, not a value the agent wrote) carrying an FS-native UUID
    // fact id — `{ type: "Parents", value: "Geo[illegible] Wilcox - Caroline E
    // Woodruff" }` on GRNX-DFF, and the same type on GRN6-4MQ. The zip is not
    // in the repo, so that log is the only place this can be re-checked; the
    // committed corpus has zero `Parents` facts.
    // Add that fact to I1.
    const tree: any = family();
    tree.persons[0].facts.push({
      id: "FP",
      type: "Parents",
      date: "1850",
      value: "Michael Ryan - Mary Doyle",
    } as any);
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The relationships still go as before, and the `Parents` fact goes too.
    expect(r.removed.persons).toBe(2);
    expect(r.removed.factsByType).toEqual({ Parents: 1 });

    const after = await readTree();
    const i1 = after.persons.find((p: any) => p.id === "I1");
    expect(i1.facts.map((f: any) => f.type)).not.toContain("Parents");
    // No parent name leaked into the redacted result.
    expect(JSON.stringify(r)).not.toContain("Michael");
    expect(JSON.stringify(r)).not.toContain("Doyle");
  });

  it("parents-of succeeds on a `Parents` fact alone, with no parent relationship", async () => {
    // The reported case: the established parents were never added as tree
    // persons — the parentage survives ONLY as a `Parents` fact. parents-of
    // must still succeed here rather than erroring "matched nothing" (#1314).
    const tree: any = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N1", given: "Caroline", surname: "Wilcox", preferred: true }],
          facts: [
            { id: "F1", type: "Birth", date: "1839", primary: true },
            { id: "FP", type: "Parents", date: "1839", value: "Geo Wilcox - Caroline Woodruff" },
          ],
        },
      ],
      relationships: [],
      sources: [],
    };
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toMatchObject({ persons: 0, relationships: 0, factsByType: { Parents: 1 } });

    const i1 = (await readTree()).persons.find((p: any) => p.id === "I1");
    expect(i1.facts.map((f: any) => f.id)).toEqual(["F1"]);
  });

  it("parents-of still errors when there is neither a parent link nor a `Parents` fact", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      // I5 is only a spouse: no parent links, no `Parents` fact.
      forget: [{ selector: "parents-of", personId: "I5" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("children-of removes the child and its link", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "children-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.persons).toBe(1);
    expect((await readTree()).persons.map((p: any) => p.id)).not.toContain("I6");
  });

  it("spouses-of removes the spouse and the couple relationship", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "spouses-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.persons).toBe(1);
    const tree = await readTree();
    expect(tree.persons.map((p: any) => p.id)).not.toContain("I5");
    expect(tree.relationships.map((x: any) => x.id)).not.toContain("R6");
  });

  it("spouses-of also strips the subject's own person-level `Marriage` fact", async () => {
    // FamilySearch carries a marriage twice — as the Couple relationship's own
    // facts AND as a `Marriage` fact on the subject's record (issue #1417).
    // Both present here: I1 has the Couple link to I5 and a person-level fact.
    const tree: any = family();
    tree.persons[0].facts.push({ id: "FM", type: "Marriage", date: "1875", place: "Cork" } as any);
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "spouses-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The spouse and couple relationship still go, and the person-level
    // `Marriage` fact goes too.
    expect(r.removed.persons).toBe(1);
    expect(r.removed.factsByType).toEqual({ Marriage: 1 });

    const after = await readTree();
    expect(after.persons.map((p: any) => p.id)).not.toContain("I5");
    const i1 = after.persons.find((p: any) => p.id === "I1");
    expect(i1.facts.map((f: any) => f.type)).not.toContain("Marriage");
    // No spouse name or marriage value leaked into the redacted result.
    expect(JSON.stringify(r)).not.toContain("Ellen");
    expect(JSON.stringify(r)).not.toContain("Walsh");
    expect(JSON.stringify(r)).not.toContain("1875");
  });

  it("spouses-of succeeds on a person-level `Marriage` fact alone, with no couple relationship", async () => {
    // The reported case: the spouse was never added as a tree person — the
    // marriage survives ONLY as a `Marriage` fact on the subject. spouses-of
    // must still succeed here rather than erroring "matched nothing" (#1417).
    const tree: any = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "Patrick", surname: "Ryan", preferred: true }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", primary: true },
            { id: "FM", type: "Marriage", date: "1875", value: "Ellen Walsh" },
          ],
        },
      ],
      relationships: [],
      sources: [],
    };
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "spouses-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toMatchObject({ persons: 0, relationships: 0, factsByType: { Marriage: 1 } });

    const i1 = (await readTree()).persons.find((p: any) => p.id === "I1");
    expect(i1.facts.map((f: any) => f.id)).toEqual(["F1"]);
  });

  it("spouses-of also sweeps person-level `Divorce` and `Annulment` facts", async () => {
    const tree: any = family();
    tree.persons[0].facts.push(
      { id: "FD", type: "Divorce", date: "1890" } as any,
      { id: "FA", type: "Annulment", date: "1892" } as any,
    );
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "spouses-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Divorce: 1, Annulment: 1 });

    const i1 = (await readTree()).persons.find((p: any) => p.id === "I1");
    expect(i1.facts.map((f: any) => f.type)).not.toContain("Divorce");
    expect(i1.facts.map((f: any) => f.type)).not.toContain("Annulment");
  });

  it("spouses-of still errors when there is neither a spouse link nor a marriage-class fact", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      // I4 is a sibling only: no couple relationship, no Marriage/Divorce/Annulment fact.
      forget: [{ selector: "spouses-of", personId: "I4" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("birth-of removes only the Birth fact and never cascades", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "birth-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toMatchObject({
      persons: 0,
      relationships: 0,
      relationshipsCascaded: 0,
      factsByType: { Birth: 1 },
    });
    const tree = await readTree();
    expect(tree.persons[0].facts.map((f: any) => f.id)).toEqual(["F2", "F3"]);
  });

  it("facts-of matches the fact type case-insensitively", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-of", personId: "I1", factType: "residence" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Residence: 1 });
  });

  it("fact removes a fact that lives on a Couple relationship", async () => {
    await writeProject(family());
    const r = await treeForget({ projectPath: dir, forget: [{ selector: "fact", factId: "F4" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Marriage: 1 });
    const tree = await readTree();
    expect(tree.relationships.find((x: any) => x.id === "R5").facts).toEqual([]);
  });

  it("person cascades every relationship touching them", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "person", personId: "I2" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.persons).toBe(1);
    // R1 (to I1), R3 (to I4), R5 (marriage to I3) — all cascaded, none named.
    expect(r.removed.relationships).toBe(3);
    expect(r.removed.relationshipsCascaded).toBe(3);
  });

  it("relationship removes the link but keeps both people", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "relationship", relationshipId: "R1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toMatchObject({ persons: 0, relationships: 1, relationshipsCascaded: 0 });
    expect((await readTree()).persons).toHaveLength(6);
  });

  it("applies several selectors in one all-or-nothing write", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "birth-of", personId: "I1" },
        { selector: "death-of", personId: "I1" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Birth: 1, Death: 1 });
  });

  it("recovers a `forget` array the model serialized as a JSON string", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: JSON.stringify([{ selector: "birth-of", personId: "I1" }]) as any,
    });
    expect(r.ok).toBe(true);
  });

  // ─── owner-scoped fact removal (#1574) ──────────────────────────────────────
  // FamilySearch does not guarantee a fact id is unique across persons — the
  // real case that motivated this: six distinct people sharing one literal
  // Birth fact id. Removal must be scoped to the owner a selector actually
  // resolved, never to every kept person/relationship that happens to carry
  // a fact with that id.

  const collidingFacts = () => ({
    persons: [
      {
        id: "C1",
        gender: "Male",
        names: [{ id: "N1", given: "Daniel", surname: "Cook", preferred: true }],
        facts: [{ id: "SHARED1", type: "Birth", date: "1798" }],
      },
      {
        id: "C2",
        gender: "Male",
        names: [{ id: "N2", given: "David", surname: "Cook", preferred: true }],
        facts: [
          { id: "SHARED1", type: "Birth", date: "1828" },
          { id: "OWN1", type: "Residence", date: "1850" },
        ],
      },
    ],
    relationships: [],
    sources: [],
  });

  it("birth-of removes only the target person's fact, even when another person shares the literal fact id", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "birth-of", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Birth: 1 });
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "C1").facts).toEqual([]);
    // The bug this guards against: C2's same-id Birth fact must survive.
    expect(tree.persons.find((p: any) => p.id === "C2").facts.map((f: any) => f.id)).toEqual([
      "SHARED1",
      "OWN1",
    ]);
  });

  it("facts-of removes only the target person's fact of that type, even when another person shares the literal fact id", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-of", personId: "C1", factType: "Birth" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "C1").facts).toEqual([]);
    expect(
      tree.persons.find((p: any) => p.id === "C2").facts.map((f: any) => f.id),
    ).toContain("SHARED1");
  });

  it("birth-of warns when the removed fact id also exists on another owner, without treating it as an error", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "birth-of", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Birth fact 'SHARED1' also exists on: C2/),
    ]);
  });

  it("facts-of warns when the removed fact id also exists on another owner", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-of", personId: "C1", factType: "Birth" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Birth fact 'SHARED1' also exists on: C2/),
    ]);
  });

  it("parents-of warns when the swept `Parents` fact id also exists on another owner", async () => {
    // Same heads-up as birth-of/facts-of, extended to the redundant-fact
    // sweep (#1314/#1417 merged alongside #1574's owner-scoping fix): the
    // swept fact's own id is not guaranteed unique either.
    const tree: any = {
      persons: [
        {
          id: "C1",
          gender: "Female",
          names: [{ id: "N1", given: "Caroline", surname: "Wilcox", preferred: true }],
          facts: [
            { id: "SHARED1", type: "Parents", date: "1839", value: "Geo Wilcox - Caroline Woodruff" },
          ],
        },
        {
          id: "C2",
          gender: "Male",
          names: [{ id: "N2", given: "David", surname: "Cook", preferred: true }],
          facts: [{ id: "SHARED1", type: "Birth", date: "1828" }],
        },
      ],
      relationships: [],
      sources: [],
    };
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Parents: 1 });
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Parents fact 'SHARED1' also exists on: C2/),
    ]);
    // C2's own same-id fact survives untouched.
    const c2 = (await readTree()).persons.find((p: any) => p.id === "C2");
    expect(c2.facts.map((f: any) => f.id)).toEqual(["SHARED1"]);
  });

  it("spouses-of warns when the swept `Marriage` fact id also exists on another owner", async () => {
    const tree: any = {
      persons: [
        {
          id: "C1",
          gender: "Male",
          names: [{ id: "N1", given: "Patrick", surname: "Ryan", preferred: true }],
          facts: [{ id: "SHARED2", type: "Marriage", date: "1875", value: "Ellen Walsh" }],
        },
        {
          id: "C2",
          gender: "Male",
          names: [{ id: "N2", given: "David", surname: "Cook", preferred: true }],
          facts: [{ id: "SHARED2", type: "Residence", date: "1850" }],
        },
      ],
      relationships: [],
      sources: [],
    };
    await writeProject(tree);

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "spouses-of", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Marriage: 1 });
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Marriage\/Divorce\/Annulment fact 'SHARED2' also exists on: C2/),
    ]);
    const c2 = (await readTree()).persons.find((p: any) => p.id === "C2");
    expect(c2.facts.map((f: any) => f.id)).toEqual(["SHARED2"]);
  });

  it("birth-of does not warn when the fact id is genuinely unique", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "birth-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.validation.warnings).toEqual([]);
  });

  it("fact selector errors when the bare id exists on more than one owner, instead of guessing", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "fact", factId: "SHARED1" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/more than one owner/);
    expect(r.errors[0]).toContain("C1");
    expect(r.errors[0]).toContain("C2");
    // Nothing written on the ambiguity path.
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "C1").facts).toEqual([
      { id: "SHARED1", type: "Birth", date: "1798" },
    ]);
  });

  it("fact selector with personId removes only that owner's copy of a shared fact id", async () => {
    await writeProject(collidingFacts());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "fact", factId: "SHARED1", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "C1").facts).toEqual([]);
    expect(
      tree.persons.find((p: any) => p.id === "C2").facts.map((f: any) => f.id),
    ).toContain("SHARED1");
  });

  it("fact selector with a personId that doesn't own that fact id is an error, not a silent no-op", async () => {
    await writeProject(collidingFacts());
    // OWN1 belongs only to C2 — naming C1 forces a genuine mismatch.
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "fact", factId: "OWN1", personId: "C1" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/does not belong to person/);
  });

  it("a person's fact and a relationship's fact sharing the same literal id are pruned independently", async () => {
    await writeProject({
      persons: [
        {
          id: "P1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "X1", type: "Residence", date: "1900" }],
        },
        {
          id: "P2",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
        },
      ],
      relationships: [
        {
          id: "R1",
          type: "Couple",
          person1: "P1",
          person2: "P2",
          facts: [{ id: "X1", type: "Marriage", date: "1920" }],
        },
      ],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-of", personId: "P1", factType: "Residence" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "P1").facts).toEqual([]);
    // R1's same-id Marriage fact is a different owner — must survive.
    expect(tree.relationships.find((x: any) => x.id === "R1").facts.map((f: any) => f.id)).toEqual(
      ["X1"],
    );
  });

  it("death-of removes only the target person's fact, even when another person shares the literal fact id", async () => {
    const tree = collidingFacts();
    tree.persons[0].facts.push({ id: "SHARED_DEATH", type: "Death", date: "1850" });
    tree.persons[1].facts.push({ id: "SHARED_DEATH", type: "Death", date: "1900" });
    await writeProject(tree);
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "death-of", personId: "C1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = await readTree();
    expect(
      t.persons.find((p: any) => p.id === "C1").facts.some((f: any) => f.id === "SHARED_DEATH"),
    ).toBe(false);
    expect(
      t.persons.find((p: any) => p.id === "C2").facts.some((f: any) => f.id === "SHARED_DEATH"),
    ).toBe(true);
  });

  it("a person and a relationship sharing the same literal id are scoped independently, even when their facts also share an id", async () => {
    await writeProject({
      persons: [
        {
          id: "X",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "F4", type: "Residence", date: "1900" }],
        },
        {
          id: "Y",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
        },
      ],
      relationships: [
        {
          id: "X", // deliberately the same literal id as the person above
          type: "Couple",
          person1: "X",
          person2: "Y",
          facts: [{ id: "F4", type: "Marriage", date: "1920" }],
        },
      ],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "fact", factId: "F4", personId: "X" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Residence: 1 });
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "X").facts).toEqual([]);
    // The relationship (also id "X") is a different owner — its same-id
    // Marriage fact must survive.
    expect(
      tree.relationships.find((x: any) => x.id === "X").facts.map((f: any) => f.id),
    ).toEqual(["F4"]);
  });

  // ─── a fact selector alongside a selector removing its own owner ───────────
  // pruneFacts only visits KEPT owners, so a fact selector targeting a fact
  // whose owner is ALSO being wholesale-removed in the same call must be
  // recognized as already satisfied, not reported as missing.

  it("fact + person removing that fact's own owner is satisfied by the removal, not an error", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "person", personId: "I1" },
        { selector: "fact", factId: "F1" }, // I1's own Birth fact
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.persons.map((p: any) => p.id)).not.toContain("I1");
  });

  it("fact + a relative selector that cascades the fact's owning relationship is satisfied by the cascade", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "parents-of", personId: "I1" }, // cascades R5 (I2+I3's marriage)
        { selector: "fact", factId: "F4" }, // F4 lives on R5
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.relationships.map((x: any) => x.id)).not.toContain("R5");
  });

  it("fact + relationship removing that fact's own owning relationship is satisfied by the removal", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "relationship", relationshipId: "R5" },
        { selector: "fact", factId: "F4" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.relationships.map((x: any) => x.id)).not.toContain("R5");
  });

  // ─── dry run ───────────────────────────────────────────────────────────────

  it("dryRun reports the identical summary and writes nothing", async () => {
    await writeProject(family());
    const before = await readTree();

    const dry = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.dryRun).toBe(true);
    expect(dry.filesWritten).toEqual([]);
    expect(dry.restoreFile).toBeNull();
    expect(await readTree()).toEqual(before);
    expect(await exists(RESTORE_FILE)).toBe(false);

    const wet = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(wet.ok).toBe(true);
    if (!wet.ok) return;
    expect(wet.removed).toEqual(dry.removed);
    expect(wet.remaining).toEqual(dry.remaining);
  });

  // ─── the restore file ──────────────────────────────────────────────────────

  it("writes the dot-prefixed restore file and no .bak", async () => {
    await writeProject(family());
    const before = await readTree();

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.restoreFile).toBe(RESTORE_FILE);
    expect(RESTORE_FILE.startsWith(".")).toBe(true);

    // The restore file is the pre-removal tree, byte-for-byte in content.
    expect(JSON.parse(await readFile(join(dir, RESTORE_FILE), "utf-8"))).toEqual(before);

    // A `.bak` would be a readable (non-dot-prefixed) copy of the answer.
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("never overwrites an existing restore file, so it keeps the ORIGINAL tree", async () => {
    await writeProject(family());
    const original = await readTree();

    await treeForget({ projectPath: dir, forget: [{ selector: "birth-of", personId: "I1" }] });
    await treeForget({ projectPath: dir, forget: [{ selector: "death-of", personId: "I1" }] });

    const restored = JSON.parse(await readFile(join(dir, RESTORE_FILE), "utf-8"));
    expect(restored).toEqual(original);
    // Both slices are gone from the live tree — forgetting is additive.
    expect((await readTree()).persons[0].facts.map((f: any) => f.id)).toEqual(["F3"]);
  });

  // ─── redaction ─────────────────────────────────────────────────────────────

  it("leaks no name, date, or place into the result", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "parents-of", personId: "I1" },
        { selector: "birth-of", personId: "I1" },
      ],
    });
    expect(r.ok).toBe(true);

    const serialized = JSON.stringify(r);
    for (const value of [
      "Patrick", "Ryan", "Michael", "Mary", "Doyle", "Bridget", "Ellen", "Walsh", "John",
      "1850", "1910", "1880", "1845", "Cork", "Ireland",
    ]) {
      expect(serialized).not.toContain(value);
    }
    // Fact TYPE names are kinds, not values, and are expected to survive.
    expect(serialized).toContain("Birth");
  });

  // ─── errors ────────────────────────────────────────────────────────────────

  it("treats a selector that matches nothing as an error, not a no-op", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      // I5 is in the tree, but only as a spouse — she has no parent links.
      forget: [{ selector: "parents-of", personId: "I5" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("reports the same error under dryRun, so a dry run is a full rehearsal", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "death-of", personId: "I2" }],
      dryRun: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("distinguishes an unknown person id from a FamilySearch PID", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "person", personId: "KWZL-123" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/FamilySearch PID/);
  });

  it("rejects an unknown fact id and writes nothing", async () => {
    await writeProject(family());
    const before = await readTree();
    const r = await treeForget({ projectPath: dir, forget: [{ selector: "fact", factId: "F99" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/not in the tree/);
    expect(await readTree()).toEqual(before);
    expect(await exists(RESTORE_FILE)).toBe(false);
  });

  it("rejects an unknown selector kind", async () => {
    await writeProject(family());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "grandparents-of", personId: "I1" } as any],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/unknown selector/);
  });

  it("rejects an empty or missing forget array", async () => {
    await writeProject(family());
    for (const forget of [[], undefined]) {
      const r = await treeForget({ projectPath: dir, forget: forget as any });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/non-empty array/);
    }
  });

  it("reports a missing project file without throwing", async () => {
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "person", personId: "I1" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/tree\.gedcomx\.json not found/);
  });

  // ─── validate before persist ───────────────────────────────────────────────

  it("refuses the write when research.json still references a removed person", async () => {
    const research = {
      ...minimalResearch,
      person_evidence: [
        {
          id: "pe_001",
          person_id: "I2",
          label: "Michael Ryan",
          summary: "Father of the subject.",
          evidence: [],
        },
      ],
    };
    await writeProject(family(), research);
    const before = await readTree();

    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "parents-of", personId: "I1" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("I2");
    // Nothing written — not the tree, not the restore file.
    expect(await readTree()).toEqual(before);
    expect(await exists(RESTORE_FILE)).toBe(false);
  });

  // ─── date-range selectors: facts-before / facts-after / facts-between ─────
  // (#1574's date-range half.) `standard_date` is set directly in these
  // fixtures rather than relying on the free-text `date` parser — these
  // tests are about tree-forget's own before/after/between logic, not about
  // stdDate()'s text parsing, which is already covered elsewhere.

  const datedFixture = () => ({
    persons: [
      {
        id: "D1",
        gender: "Male",
        names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
        facts: [
          { id: "DF1", type: "Residence", standard_date: "1840" },
          { id: "DF2", type: "Residence", standard_date: "1860" },
          { id: "DF3", type: "Residence" }, // no date field at all: unparseable
          { id: "DF4", type: "Residence", standard_date: "Bet 1845 and 1855" },
          // Open-ended on one side: "Aft 1855" has no true upper bound (could
          // be any later year), "Bef 1845" has no true lower bound. Only the
          // closed side of each is a real bound (found by review).
          { id: "DF6", type: "Residence", standard_date: "Aft 1855" },
          { id: "DF7", type: "Residence", standard_date: "Bef 1845" },
        ],
      },
      {
        id: "D2",
        gender: "Female",
        names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
        facts: [{ id: "DF5", type: "Residence", standard_date: "1830" }],
      },
    ],
    relationships: [],
    sources: [],
  });

  it("facts-before removes only facts confidently before the year, skips unparseable and straddling ones", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "D1", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // DF1 (1840) is confidently before 1850. DF2 (1860) is not. DF4
    // ("Bet 1845 and 1855") straddles 1850 — its latest possible year, 1855,
    // is not before 1850, so it must NOT be swept. DF7 ("Bef 1845") has no
    // true lower bound but its real upper bound, 1845, is before 1850, so
    // it IS confidently before and must be swept. DF6 ("Aft 1855") has no
    // true upper bound at all, so it must NOT be swept (found by review).
    expect(r.removed.factsByType).toEqual({ Residence: 2 });
    const tree = await readTree();
    const d1 = tree.persons.find((p: any) => p.id === "D1");
    expect(d1.facts.map((f: any) => f.id)).toEqual(["DF2", "DF3", "DF4", "DF6"]);
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/1 fact\(s\).*no parseable date.*facts-before/),
    ]);
  });

  it("facts-after removes only facts confidently after the year", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-after", personId: "D1", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // DF6 ("Aft 1855") has no true upper bound but its real lower bound,
    // 1855, is after 1850, so it IS confidently after and must be swept.
    // DF7 ("Bef 1845") has no true upper bound at all, so it must NOT be
    // swept (found by review).
    expect(r.removed.factsByType).toEqual({ Residence: 2 });
    const tree = await readTree();
    expect(
      tree.persons.find((p: any) => p.id === "D1").facts.map((f: any) => f.id),
    ).toEqual(["DF1", "DF3", "DF4", "DF7"]);
  });

  it("facts-between removes only facts fully contained in the range, not merely overlapping it", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-between", personId: "D1", fromYear: 1830, toYear: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // DF1 (1840) is fully inside [1830, 1850]. DF4 ("Bet 1845 and 1855")
    // overlaps but is not fully contained (1855 > 1850), so it survives.
    // DF6/DF7 are each open-ended on one side, so neither can ever be
    // confidently "fully contained" in any finite range.
    expect(r.removed.factsByType).toEqual({ Residence: 1 });
    const tree = await readTree();
    expect(
      tree.persons.find((p: any) => p.id === "D1").facts.map((f: any) => f.id),
    ).toEqual(["DF2", "DF3", "DF4", "DF6", "DF7"]);
  });

  it("facts-between removes a straddling fact once the range is wide enough to fully contain it", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-between", personId: "D1", fromYear: 1840, toYear: 1860 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Now [1840, 1860] fully contains DF1 (1840), DF2 (1860), and DF4
    // (1845..1855). DF3 (unparseable) and the open-ended DF6/DF7 all survive.
    expect(r.removed.factsByType).toEqual({ Residence: 3 });
    const tree = await readTree();
    expect(
      tree.persons.find((p: any) => p.id === "D1").facts.map((f: any) => f.id),
    ).toEqual(["DF3", "DF6", "DF7"]);
  });

  it("facts-before never sweeps an Aft fact merely because the threshold clears its warning-check fudge", async () => {
    // "Aft 1850" has no true upper bound at all. date-helpers' FUDGE gives
    // it a +10-year latest for the warning checks (a heuristic, not a real
    // bound), so a threshold past that fudged year, but nowhere near an
    // actual later occurrence, must still refuse rather than guess (found
    // by review; this is the shape the fixture-level tests above do not
    // exercise, since their threshold sits below the fact's own year).
    await writeProject({
      persons: [
        {
          id: "P1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "PF1", type: "Residence", standard_date: "Aft 1850" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "P1", year: 1870 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("facts-after never sweeps a Bef fact merely because the threshold clears its warning-check fudge", async () => {
    // Mirror case: "Bef 1900" has no true lower bound at all.
    await writeProject({
      persons: [
        {
          id: "P2",
          gender: "Male",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
          facts: [{ id: "PF2", type: "Residence", standard_date: "Bef 1900" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-after", personId: "P2", year: 1885 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("facts-between rejects fromYear > toYear", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-between", personId: "D1", fromYear: 1860, toYear: 1840 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/fromYear <= toYear/);
  });

  it("facts-before requires a numeric year", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "D1", year: "1850" as any }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/requires a numeric year/);
  });

  it("facts-before with no personId matches tree-wide, across more than one person", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // D1's DF1 (1840) and DF7 ("Bef 1845", real upper bound 1845) and D2's
    // DF5 (1830) are all confidently before 1850.
    expect(r.removed.factsByType).toEqual({ Residence: 3 });
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "D2").facts).toEqual([]);
  });

  it("a date-range selector is an error, not a no-op, when nothing qualifies", async () => {
    await writeProject(datedFixture());
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "D2", year: 1800 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("a person-scoped date-range selector still scopes removal to the correct owner when a fact id collides", async () => {
    await writeProject({
      persons: [
        {
          id: "E1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1840" }],
        },
        {
          id: "E2",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1841" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "E1", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "E1").facts).toEqual([]);
    // E2's same-id, also-qualifying fact must survive — this selector only
    // resolved E1 in scope (personId was given), so E2 was never a target.
    expect(
      tree.persons.find((p: any) => p.id === "E2").facts.map((f: any) => f.id),
    ).toEqual(["SHARED"]);
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Residence fact 'SHARED' also exists on: E2/),
    ]);
  });

  it("a genuinely tree-wide date-range selector (no personId) removes each qualifying owner's own copy of a shared fact id", async () => {
    await writeProject({
      persons: [
        {
          id: "E1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1840" }],
        },
        {
          id: "E2",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1841" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // No personId: both E1's and E2's copy of "SHARED" confidently qualify,
    // and each is removed from its own owner — not double-counted, not
    // conflated by the shared literal id.
    expect(r.removed.factsByType).toEqual({ Residence: 2 });
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "E1").facts).toEqual([]);
    expect(tree.persons.find((p: any) => p.id === "E2").facts).toEqual([]);
    // Neither should warn "also exists on" the other: both copies are gone
    // by the end of this same call, so there is no untouched owner left to
    // name (found by review — checking only the pre-removal tree would name
    // each as the other's still-there copy, when both are actually leaving).
    expect(r.validation.warnings).toEqual([]);
  });

  it("still warns when the other owner sharing a fact id genuinely survives the call", async () => {
    // Same shape as above, but E3's copy is dated after the threshold, so it
    // does not qualify and is never touched. The suppression above must not
    // over-reach and silence a real, still-true warning.
    await writeProject({
      persons: [
        {
          id: "E1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1840" }],
        },
        {
          id: "E3",
          gender: "Female",
          names: [{ id: "N3", given: "E", surname: "F", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1900" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Residence: 1 });
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Residence fact 'SHARED' also exists on: E3/),
    ]);
    const e3 = (await readTree()).persons.find((p: any) => p.id === "E3");
    expect(e3.facts.map((f: any) => f.id)).toEqual(["SHARED"]);
  });

  it("a person-scoped date-range selector also reaches a Couple relationship the person is party to", async () => {
    // A marriage date normally lives on the Couple relationship, not on
    // either spouse's own record. A person-scoped facts-before must still
    // catch it, or the tool reports success while the marriage date and
    // place are still sitting in the tree, readable (found by review).
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "Patrick", surname: "Ryan", preferred: true }],
          facts: [{ id: "BF1", type: "Birth", standard_date: "1820" }],
        },
        {
          id: "I5",
          gender: "Female",
          names: [{ id: "N2", given: "Ellen", surname: "Walsh", preferred: true }],
        },
      ],
      relationships: [
        {
          id: "R6",
          type: "Couple",
          person1: "I1",
          person2: "I5",
          facts: [{ id: "MF1", type: "Marriage", standard_date: "1845", place: "Cork, Ireland" }],
        },
      ],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "I1", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Birth: 1, Marriage: 1 });
    const tree = await readTree();
    expect(tree.persons.find((p: any) => p.id === "I1").facts).toEqual([]);
    expect(tree.relationships.find((x: any) => x.id === "R6").facts).toEqual([]);
    // I5 was never a target of this call, only their shared relationship's
    // own fact.
    expect(tree.persons.find((p: any) => p.id === "I5")).toBeDefined();
  });

  it("does not warn twice when two selectors in the same call both reach the same shared Couple-relationship fact", async () => {
    // E1 and E2 share Couple relationship R1. A person-scoped date selector
    // for EACH spouse independently resolves to the SAME relationship fact
    // (the Couple-relationship reach above), so the pending notice for that
    // fact is recorded twice in one call. E3's own fact, sharing the same
    // literal id but dated too late to be swept, is the genuine "also
    // exists on" — it must be named once, not once per selector that
    // rediscovered it (found by review).
    await writeProject({
      persons: [
        { id: "E1", gender: "Male", names: [{ id: "N1", given: "A", surname: "B", preferred: true }] },
        { id: "E2", gender: "Female", names: [{ id: "N2", given: "C", surname: "D", preferred: true }] },
        {
          id: "E3",
          gender: "Male",
          names: [{ id: "N3", given: "E", surname: "F", preferred: true }],
          facts: [{ id: "MF1", type: "Marriage", standard_date: "1990" }],
        },
      ],
      relationships: [
        {
          id: "R1",
          type: "Couple",
          person1: "E1",
          person2: "E2",
          facts: [{ id: "MF1", type: "Marriage", standard_date: "1800" }],
        },
      ],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [
        { selector: "facts-before", personId: "E1", year: 1850 },
        { selector: "facts-before", personId: "E2", year: 1850 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Marriage: 1 });
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Marriage fact 'MF1' also exists on: E3/),
    ]);
  });

  it("does not warn twice when one tree-wide sweep independently removes two owners' copies of the same shared id", async () => {
    // Same "don't repeat the sentence" concern as above, triggered a
    // different way: ONE selector matching multiple owners in one pass,
    // rather than two different selectors rediscovering one fact.
    await writeProject({
      persons: [
        {
          id: "E1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1800" }],
        },
        {
          id: "E2",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1820" }],
        },
        {
          id: "E3",
          gender: "Male",
          names: [{ id: "N3", given: "E", surname: "F", preferred: true }],
          facts: [{ id: "SHARED", type: "Residence", standard_date: "1900" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Residence: 2 });
    expect(r.validation.warnings).toEqual([
      expect.stringMatching(/Residence fact 'SHARED' also exists on: E3/),
    ]);
  });

  it("a tree-wide date-range selector matches a fact that lives only on a Couple relationship", async () => {
    await writeProject({
      persons: [
        {
          id: "E1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
        },
        {
          id: "E2",
          gender: "Female",
          names: [{ id: "N2", given: "C", surname: "D", preferred: true }],
        },
      ],
      relationships: [
        {
          id: "RE1",
          type: "Couple",
          person1: "E1",
          person2: "E2",
          facts: [{ id: "MF1", type: "Marriage", standard_date: "1845" }],
        },
      ],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", year: 1850 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.factsByType).toEqual({ Marriage: 1 });
    const tree = await readTree();
    expect(tree.relationships.find((x: any) => x.id === "RE1").facts).toEqual([]);
  });

  it("facts-before does not remove a fact dated exactly on the threshold year", async () => {
    await writeProject({
      persons: [
        {
          id: "B1",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "ONYEAR", type: "Residence", standard_date: "1850" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "B1", year: 1850 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("facts-after does not remove a fact dated exactly on the threshold year", async () => {
    await writeProject({
      persons: [
        {
          id: "B2",
          gender: "Male",
          names: [{ id: "N1", given: "A", surname: "B", preferred: true }],
          facts: [{ id: "ONYEAR", type: "Residence", standard_date: "1850" }],
        },
      ],
      relationships: [],
      sources: [],
    });
    const r = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-after", personId: "B2", year: 1850 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/matched nothing/);
  });

  it("a date-range selector reports the same result under dryRun as for real", async () => {
    await writeProject(datedFixture());
    const dry = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "D1", year: 1850 }],
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.filesWritten).toEqual([]);
    const wet = await treeForget({
      projectPath: dir,
      forget: [{ selector: "facts-before", personId: "D1", year: 1850 }],
    });
    expect(wet.ok).toBe(true);
    if (!wet.ok) return;
    expect(wet.removed).toEqual(dry.removed);
    expect(wet.validation.warnings).toEqual(dry.validation.warnings);
  });

  // ─── personId: "" must error, never silently mean "omitted" ───────────────
  // A destructive tool where an empty personId falls through to "no owner
  // given" would turn a plausible caller bug (an empty string from bad
  // templating) into a much bigger, silent deletion than requested.

  it.each([
    ["facts-before", { selector: "facts-before", personId: "", year: 1850 }],
    ["facts-after", { selector: "facts-after", personId: "", year: 1850 }],
    ["facts-between", { selector: "facts-between", personId: "", fromYear: 1840, toYear: 1860 }],
    ["fact", { selector: "fact", personId: "", factId: "DF1" }],
  ] as const)("%s treats personId: \"\" as an error, not as omitted", async (_label, selector) => {
    await writeProject(datedFixture());
    const r = await treeForget({ projectPath: dir, forget: [selector as any] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/requires personId/);
  });
});
