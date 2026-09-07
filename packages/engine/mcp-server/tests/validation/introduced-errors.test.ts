/**
 * Unit tests for `validateIntroduced` (issue #1572): a writer must block only on
 * the errors its own call introduced, tolerating pre-existing schema drift as a
 * warning.
 *
 * The load-bearing case is reindexing. The tree/merge/forget tools rebuild their
 * arrays with `.filter`, so a pre-existing error at `persons[1]` becomes
 * `persons[0]` after an earlier element is removed. A naive `{path, message}`
 * diff reads the reindexed error as new and false-blocks — the exact bug this
 * fix exists to kill. These tests fail against such a naive diff and pass only
 * because the identity is keyed on the object's stable `.id`.
 */

import { describe, it, expect } from "vitest";
import { validateIntroduced } from "../../src/validation/introduced-errors.js";
import { validateParsed } from "../../src/validation/validator.js";

const minimalResearch = {
  project: {
    id: "rp_001",
    objective: "Test project",
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

function validPerson(id: string, given: string, surname: string) {
  return {
    id,
    gender: "Male",
    names: [{ id: `${id}-n`, given, surname }],
  };
}

/** A valid person carrying one legacy drift key — an `additionalProperties`
 *  violation on an id-bearing object, the shape #1572 is about. */
function driftedPerson(id: string, given: string, surname: string) {
  return { ...validPerson(id, given, surname), legacy_field: "x" };
}

function tree(persons: unknown[]) {
  return { persons, relationships: [], sources: [] };
}

describe("validateIntroduced", () => {
  it("tolerates pre-existing drift that reindexes when an earlier element is removed", async () => {
    // Drift sits on I2 at persons[1]. Removing I1 slides I2 to persons[0].
    const before = tree([
      validPerson("I1", "Ann", "Smith"),
      driftedPerson("I2", "Bob", "Jones"),
      validPerson("I3", "Cara", "Lee"),
    ]);
    const after = tree([
      driftedPerson("I2", "Bob", "Jones"),
      validPerson("I3", "Cara", "Lee"),
    ]);

    const result = await validateIntroduced(
      { research: minimalResearch, tree: before },
      { research: minimalResearch, tree: after },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Demoted to a single summary warning (count + pointer), not one per error.
    expect(
      result.warnings.some((w) => /pre-existing schema error/.test(w.message)),
    ).toBe(true);
  });

  it("blocks on drift the call itself introduces", async () => {
    const before = tree([validPerson("I1", "Ann", "Smith")]);
    const after = tree([
      validPerson("I1", "Ann", "Smith"),
      driftedPerson("I2", "Bob", "Jones"),
    ]);

    const result = await validateIntroduced(
      { research: minimalResearch, tree: before },
      { research: minimalResearch, tree: after },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /legacy_field/.test(e.message))).toBe(true);
  });

  it("blocks a new error even while a like-shaped pre-existing one rides along", async () => {
    // I2's drift is pre-existing; I3's identical-shaped drift is new. The new
    // one must still block — a message-only diff would mask it behind I2.
    const before = tree([
      validPerson("I1", "Ann", "Smith"),
      driftedPerson("I2", "Bob", "Jones"),
    ]);
    const after = tree([
      driftedPerson("I2", "Bob", "Jones"),
      driftedPerson("I3", "Cara", "Lee"),
    ]);

    const result = await validateIntroduced(
      { research: minimalResearch, tree: before },
      { research: minimalResearch, tree: after },
    );

    expect(result.valid).toBe(false);
    // I3 (persons[1] in the after-tree) is the introduced one; I2 is demoted.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toMatch(/persons\[1\]/);
    expect(result.warnings.some((w) => /pre-existing/.test(w.message))).toBe(true);
  });

  /**
   * The empty-plan check has to land on ONE side of the demotion line: a plan
   * the call created blocks, a plan that was already empty rides along as a
   * warning. Nothing else in the repo asserts that split for a nested array's
   * own error, and getting it wrong in either direction is invisible — too
   * strict freezes every legacy project on a write it did not cause, too loose
   * re-opens the corruption path the check exists to close.
   */
  const planItem = (id: string) => ({
    id,
    sequence: 1,
    record_type: "census",
    jurisdiction: "Schuylkill County, Pennsylvania",
    date_range: "1850-1860",
    repository: "FamilySearch",
    rationale: "Household reconstruction",
    fallback_for: null,
    status: "planned",
  });
  const plan = (id: string, items: unknown[]) => ({
    id,
    question_id: "q_001",
    status: "active",
    created: "2026-01-01",
    items,
  });
  const question = () => ({
    id: "q_001",
    question: "Who were the parents of John Smith?",
    rationale: "Timeline gap",
    selection_basis: "timeline_gap",
    priority: "high",
    status: "open",
    depends_on: [],
    unblocks: [],
    created: "2026-01-01",
    resolved: null,
    resolution_assertion_ids: [],
    exhaustive_declaration: { declared: false, log_entry_ids: [], justification: null, stop_criteria: null },
  });

  it("tolerates a plan that was ALREADY empty before the call", async () => {
    const before = { ...minimalResearch, questions: [question()], plans: [plan("pl_001", [])] };
    // The call appended an unrelated hypothesis; pl_001 is untouched.
    const after = {
      ...before,
      hypotheses: [
        {
          id: "h_001",
          claim: "Same man",
          status: "active",
          supporting_assertion_ids: [],
          contradicting_assertion_ids: [],
          ruled_out: false,
          ruled_out_reason: null,
          notes: null,
          related_question_ids: ["q_001"],
        },
      ],
    };
    const t = tree([validPerson("I1", "John", "Smith")]);
    const res = await validateIntroduced({ research: before, tree: t }, { research: after, tree: t });
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.message.includes("pre-existing schema error"))).toBe(true);
  });

  it("blocks a plan the call itself created empty", async () => {
    const before = { ...minimalResearch, questions: [question()], plans: [] };
    const after = { ...before, plans: [plan("pl_001", [])] };
    const t = tree([validPerson("I1", "John", "Smith")]);
    const res = await validateIntroduced({ research: before, tree: t }, { research: after, tree: t });
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => `${e.path} ${e.message}`).join(" | ")).toMatch(
      /plans\[0\]\/items is empty/,
    );
  });

  it("blocks only the newly-created empty plan when a legacy one rides along", async () => {
    // The load-bearing pair: one plan was already empty, one was created empty
    // by this call. Exactly one error, naming the new plan.
    const before = { ...minimalResearch, questions: [question()], plans: [plan("pl_001", [])] };
    const after = {
      ...before,
      plans: [plan("pl_001", []), { ...plan("pl_002", []), status: "superseded" }],
    };
    const t = tree([validPerson("I1", "John", "Smith")]);
    const res = await validateIntroduced({ research: before, tree: t }, { research: after, tree: t });
    expect(res.valid).toBe(false);
    const items = res.errors.filter((e) => e.path.endsWith("/items"));
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("research.json/plans[1]/items");
  });

  it("still demotes the legacy empty plan when the call REINDEXES it", async () => {
    // pl_001 is empty and sits at plans[1]. The call inserts nothing but
    // removes plans[0], sliding the drifted plan to plans[0] — the reindexing
    // case the id-keyed diff exists for, now exercised on a nested array error.
    const before = {
      ...minimalResearch,
      questions: [question()],
      plans: [plan("pl_000", [planItem("pli_001")]), plan("pl_001", [])],
    };
    const after = { ...before, plans: [plan("pl_001", [])] };
    const t = tree([validPerson("I1", "John", "Smith")]);
    const res = await validateIntroduced({ research: before, tree: t }, { research: after, tree: t });
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
    // The name says "demotes", so assert the demotion rather than only the
    // silence: an empty error list is also what a check that never ran returns.
    expect(res.warnings.some((w) => w.message.includes("pre-existing schema error"))).toBe(true);
  });

  it("is byte-identical to validateParsed on a project with no pre-existing drift", async () => {
    const clean = tree([validPerson("I1", "Ann", "Smith")]);

    const introduced = await validateIntroduced(
      { research: minimalResearch, tree: clean },
      { research: minimalResearch, tree: clean },
    );
    const direct = await validateParsed(minimalResearch, clean);

    expect(introduced).toEqual(direct);
  });
});
