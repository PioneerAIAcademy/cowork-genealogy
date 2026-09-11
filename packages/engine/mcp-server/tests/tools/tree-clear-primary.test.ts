import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { treeEdit } from "../../src/tools/tree-edit.js";
import { treeCorrect } from "../../src/tools/tree-correct.js";
import { validateGedcomx } from "../../src/validation/validator.js";
import { createReport } from "../../src/validation/types.js";

/**
 * `primary: false` clears the flag; it is never stored.
 *
 * The persisted schema pins `primary` to `const: true` — omit-when-false, for
 * token count (simplified-gedcomx-spec §6) — and the document validator's own
 * message says "omit it rather than setting false". Until this existed, no op
 * could follow that advice: `clearPrimaryOfType` fires only as a side effect of
 * designating a REPLACEMENT primary, so the flag could move but never retire.
 *
 * **The state that needs it is ordinary, not contrived.** `materialize_facts`
 * never sets `primary` and surfaces a conflict when a second fact of a vital
 * type lands, so the routine "two records disagree about a birth date" sequence
 * leaves the older fact asserting a concluded value while the conflict is open.
 * Measured 2026-09-10 over the committed corpus: 10 such persons across 9 e2e
 * final trees (6 Birth, 4 Death) on real FamilySearch ids — `MNFL-T24` carries
 * four conflicting Birth facts with one still primary — and 0 across the 97
 * scenario fixtures, which is why only a constructed test had ever reached it.
 */

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

/** One person, one Birth fact, already primary — the shape a merge or a second
 *  record walks into. */
const onePrimaryBirth = () => ({
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Smith", preferred: true }],
      facts: [
        { id: "F1", type: "Birth", date: "1850", primary: true, sources: [{ ref: "S1" }] },
        { id: "F2", type: "Birth", date: "1852", sources: [{ ref: "S1" }] },
      ],
    },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "A source" }],
});

/** Two unrelated persons — the shape `add_relationship` needs. */
const twoPersons = () => ({
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Smith", preferred: true }],
      facts: [],
    },
    {
      id: "I2",
      gender: "Female",
      names: [{ id: "N2", given: "Mary", surname: "Jones", preferred: true }],
      facts: [],
    },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "A source" }],
});

describe("primary: false clears the flag", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clear-primary-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readTree = async () =>
    JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const factsOf = (tree: any) => tree.persons[0].facts as any[];
  const byId = (tree: any, id: string) => factsOf(tree).find((f) => f.id === id);

  it("update_fact removes the key rather than storing false", async () => {
    await writeProject(onePrimaryBirth());
    const res = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { primary: false },
    });
    expect(res.ok).toBe(true);
    const tree = await readTree();
    expect("primary" in byId(tree, "F1")).toBe(false);
    expect(byId(tree, "F1").date).toBe("1850"); // nothing else touched
  });

  it("leaves the vital type with NO primary at all — the point of the change", async () => {
    await writeProject(onePrimaryBirth());
    await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { primary: false },
    });
    const tree = await readTree();
    const births = factsOf(tree).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(2);
    expect(births.filter((f) => f.primary === true)).toHaveLength(0);
  });

  it("the result still validates — the persisted schema never sees a false", async () => {
    await writeProject(onePrimaryBirth());
    await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { primary: false },
    });
    const report = createReport();
    validateGedcomx(await readTree(), report);
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
  });

  it("works through tree_correct, which is the tool a stale flag is corrected with", async () => {
    await writeProject(onePrimaryBirth());
    const res = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { primary: false },
    });
    expect(res.ok).toBe(true);
    expect("primary" in byId(await readTree(), "F1")).toBe(false);
  });

  it("add_fact adds without a primary and leaves an existing one alone", async () => {
    await writeProject(onePrimaryBirth());
    const addRes = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      fact: { type: "Birth", date: "1851", primary: false, sources: [{ ref: "S1" }] },
    });
    expect(addRes, JSON.stringify(addRes)).toMatchObject({ ok: true });
    const tree = await readTree();
    const births = factsOf(tree).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(3);
    // The pre-existing primary is untouched: `false` says "not me", never
    // "clear everyone".
    expect(byId(tree, "F1").primary).toBe(true);
    const added = births.find((f) => f.date === "1851");
    expect("primary" in added).toBe(false);
  });

  // ── the other direction: nothing else moved ──────────────────────────────

  it("primary: true still moves the flag, as before", async () => {
    await writeProject(onePrimaryBirth());
    await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F2",
      fact: { primary: true },
    });
    const tree = await readTree();
    expect(byId(tree, "F2").primary).toBe(true);
    expect("primary" in byId(tree, "F1")).toBe(false); // swapped, not duplicated
  });

  it("omitting primary changes nothing about it", async () => {
    await writeProject(onePrimaryBirth());
    await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { date: "1850 or 1851" },
    });
    const tree = await readTree();
    expect(byId(tree, "F1").primary).toBe(true);
  });

  it("clears THIS fact, never the whole type — a sibling's primary survives", async () => {
    // The discriminating case. F2 is already unflagged and F1 legitimately holds
    // the primary, so "clear this fact" and "clear every fact of this type" only
    // differ here: the second wrongly strips F1. Without this assertion an
    // implementation calling clearPrimaryOfType(holder, type, undefined) passes
    // the whole file (measured 2026-09-10 — it did).
    await writeProject(onePrimaryBirth());
    const res = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F2",
      fact: { primary: false },
    });
    expect(res.ok).toBe(true);
    const tree = await readTree();
    expect("primary" in byId(tree, "F2")).toBe(false);
    expect(byId(tree, "F1").primary).toBe(true);
  });

  it("a stored false is still rejected by the document validator", async () => {
    // The guarantee this change rests on: the schema is unmoved, so anything
    // that DID persist a false is still caught. If this ever goes green the
    // tool-boundary translation has stopped being load-bearing.
    const tree = onePrimaryBirth();
    (tree.persons[0].facts[0] as any).primary = false;
    const report = createReport();
    validateGedcomx(tree, report);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(report.errors)).toContain("primary");
  });

  // ─── the other two fact-write paths, and the near-miss spellings ───

  it("add_person clears the flag on its inline facts", async () => {
    // The strip lived only on add_fact/update_fact, so the two ops that write
    // inline facts failed the whole batch on the document validator's "omit it
    // rather than setting false" — advice that leaves a stale flag exactly
    // where it was, from a tool description promising `primary: false` works.
    await writeProject(onePrimaryBirth());
    const res: any = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: {
        gender: "Female",
        names: [{ given: "Mary", surname: "Smith", preferred: true }],
        facts: [{ type: "Birth", date: "1852", primary: false, sources: [{ ref: "S1" }] }],
      },
    } as never);
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
    const tree = await readTree();
    expect(tree.persons.at(-1).facts[0]).not.toHaveProperty("primary");
    const report = createReport();
    validateGedcomx(tree, report);
    expect(report.errors).toEqual([]);
  });

  it("add_relationship clears the flag on its Couple facts", async () => {
    await writeProject(twoPersons());
    const res: any = await treeEdit({
      projectPath: dir,
      operation: "add_relationship",
      relationship: {
        type: "Couple",
        person1: "I1",
        person2: "I2",
        sources: [{ ref: "S1" }],
        facts: [{ type: "Marriage", date: "1870", primary: false, sources: [{ ref: "S1" }] }],
      },
    } as never);
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
    const tree = await readTree();
    expect(tree.relationships.at(-1).facts[0]).not.toHaveProperty("primary");
    const report = createReport();
    validateGedcomx(tree, report);
    expect(report.errors).toEqual([]);
  });

  it.each([
    ["the string \"false\"", "false"],
    ["null", null],
    ["the number 0", 0],
  ])("refuses primary given as %s, naming the boolean", async (_label, value) => {
    // These fell past the `=== false` arm, were assigned to the fact, and died
    // at the document validator saying "omit it rather than setting false" —
    // the one instruction that does NOT retire a stale flag. The error must
    // name the fix instead.
    await writeProject(onePrimaryBirth());
    const res: any = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      fact: { type: "Death", date: "1900", primary: value, sources: [{ ref: "S1" }] },
    } as never).catch((e: Error) => ({ ok: false, errors: [e.message] }));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/`primary` must be the boolean true or false/);
  });
});
