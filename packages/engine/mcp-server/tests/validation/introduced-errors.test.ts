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
