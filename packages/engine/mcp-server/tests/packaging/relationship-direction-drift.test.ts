import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  subjectRoleInValue,
  RELATION_CATEGORY,
} from "../../src/tools/research-append.js";

/**
 * Cross-language drift lint for the relationship-direction rule (issue #2535).
 *
 * The rule exists twice and cannot be shared: the eval check is Python in
 * `eval/harness/validators/test_record_extraction.py`, the write-path deny is
 * TypeScript in `src/tools/research-append.ts`, and this repo has no runtime
 * bridge between the harness and the engine (CLAUDE.md, "Don't try to share
 * code at runtime"). Duplication is therefore the only option; an UNPINNED
 * duplication is not.
 *
 * Both sides assert against one table of cases, so a change to either
 * implementation that the other does not follow reds its own suite. The
 * Python half of this pact is
 * `test_validator_runner.py::test_relationship_direction_cases_match_the_shared_table`.
 *
 * `states` is what the VALUE claims about the record SUBJECT, not the verdict:
 * the verdict also needs `relationship_type`, which the callers supply.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const CASES_PATH = join(
  repoRoot,
  "eval",
  "harness",
  "validators",
  "relationship_direction_cases.json",
);

type Case = { value: string; states: string | null; why: string };

describe("relationship-direction rule — cross-language drift (#2535)", () => {
  const cases: Case[] = JSON.parse(readFileSync(CASES_PATH, "utf-8")).cases;

  it("the shared table is present and non-trivial", () => {
    // A table that shrank to nothing would make every case below vacuous, and
    // the suite would still be green.
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((c) => c.states !== null).length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.states === null).length).toBeGreaterThanOrEqual(5);
  });

  it.each(cases.map((c) => [c.value, c.states, c.why] as const))(
    "reads %j as stating %j — %s",
    (value, states) => {
      expect(subjectRoleInValue(value) ?? null).toBe(states);
    },
  );

  it("the category table matches the shared one", () => {
    // The value predicate is only half the rule. A spelling added to one
    // language's table and not the other changes what the field MEANS on
    // that side, and every case above would still pass.
    const shared: Record<string, string> = JSON.parse(
      readFileSync(CASES_PATH, "utf-8"),
    ).categories;
    expect(shared, "shared table has no 'categories'").toBeTruthy();
    expect({ ...RELATION_CATEGORY }).toEqual(shared);
  });

  it("every case carries a reason", () => {
    // The table is evidence, not a fixture dump: a case nobody can explain is
    // a case nobody will correctly update when the rule changes.
    for (const c of cases) {
      expect(c.why, `case ${JSON.stringify(c.value)} has no 'why'`).toBeTruthy();
    }
  });
});
