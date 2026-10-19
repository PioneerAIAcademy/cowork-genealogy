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
    search_stop: { stopped_because: null, log_entry_ids: [], justification: null, stop_criteria: null, not_reached: [] },
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

// --- issue #1972 V5 ---------------------------------------------------------
//
// V5 added a referential error to a WHOLE-DOCUMENT validator, so without this
// module a project already citing an open conflict could never be written to
// again. These three tests are what make that claim true rather than assumed —
// and the second is the one an adversarial plan review produced, because the
// first two on their own pass while the real freeze happens.
describe("validateIntroduced — proof_summaries resolved_conflict_ids (V5)", () => {
  const t = { persons: [], relationships: [], sources: [] };

  // `questions: [q_001]` is load-bearing, not scenery. `minimalResearch` ships
  // `questions: []`, so a proof summary's `question_id: "q_001"` is a DANGLING
  // REFERENCE — and that error alone supplies the `valid: true`, the
  // `errors: []` and the pre-existing warning these tests assert. Measured:
  // with `questions: []` and the whole V5 block deleted from `validator.ts`,
  // only the third test below reds; the first two pass on the dangling
  // reference. Supplying the question makes every assertion here specific to
  // V5, and TWO of the three then red on that deletion. The third —
  // `unresolved -> moot` — asserts a NON-blocking property, so it is
  // trivially true when no rule exists and no structure could make it red
  // that way; its falsifiability runs the other direction, recorded on the
  // test itself. (An earlier version of this line said "all three", inside
  // the comment that exists to correct a false claim.)
  const q_001 = {
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
    search_stop: {
      stopped_because: null, log_entry_ids: [], justification: null, stop_criteria: null, not_reached: [],
    },
  };

  function state(conflictStatus: string, refs: string[]) {
    return {
      ...minimalResearch,
      questions: [q_001],
      conflicts: [
        {
          id: "c_001",
          conflict_type: "fact",
          description: "Birth year conflict",
          competing_assertion_ids: ["a_001", "a_002"],
          status: conflictStatus,
          blocks_question_ids: [],
          disputed_attribute: "birth_date",
        },
      ],
      proof_summaries: [
        {
          id: "ps_001",
          question_id: "q_001",
          tier: "probable",
          vehicle: "summary",
          supporting_assertion_ids: [],
          resolved_conflict_ids: refs,
          exhaustive_search_summary: "Test",
          narrative_markdown: "Test",
        },
      ],
    };
  }

  it("does not block a write on a pre-existing violation", async () => {
    // The whole reason V5 can be an error rather than a warning.
    const before = state("unresolved", ["c_001"]);
    const after = JSON.parse(JSON.stringify(before));
    after.project.updated = "2026-02-02";

    const res = await validateIntroduced(
      { research: before, tree: t },
      { research: after, tree: t }
    );
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.message.includes("pre-existing schema error"))).toBe(true);
  });

  it("still does not block when the cited conflict moves unresolved -> moot", async () => {
    // The trap. `errorKey` is the normalized path PLUS the message text, so an
    // error message naming the conflict's LIVE STATUS would produce a different
    // key here, read as newly introduced, and REFUSE the write — while the
    // defect is unchanged and the agent is doing exactly what the engine told
    // it to (research-append.ts:1478-1479 says set the status to 'resolved' or
    // 'moot'). Since `moot` is accepted by V5 the error clears outright, and
    // because the message never embedded the status this also survives a fourth
    // conflict_status value being added later.
    //
    // The same-before-state test above passes regardless, which is why this one
    // is separate. It reds under the two-mutation combination "status in the
    // message" + "moot rejected" (the dive's literal rule), which is the
    // behavioural proof that the freeze is real and not merely reasoned about.
    const before = state("unresolved", ["c_001"]);
    const after = state("moot", ["c_001"]);

    const res = await validateIntroduced(
      { research: before, tree: t },
      { research: after, tree: t }
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("blocks a write that introduces the violation", async () => {
    // The prevention half: without this the guard tolerates everything.
    const before = state("unresolved", []);
    const after = state("unresolved", ["c_001"]);

    const res = await validateIntroduced(
      { research: before, tree: t },
      { research: after, tree: t }
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.message.includes("not settled"))).toBe(true);
  });
});

// --- #2934: validate the form that will be PERSISTED, not the in-memory one ---
//
// The store writes `JSON.stringify(obj)`, which drops a key whose value is
// `undefined`; `checkRequired` tests `field in obj`, which `{field: undefined}`
// satisfies. So a writer could report valid on an object that fails the moment
// it is read back, and every later call would then count that error as
// pre-existing — somebody else's problem.
//
// Six cases, and each one names the piece of the fix it rules out, because the
// obvious test set pins only half of it: an `after`-only round-trip passes (a),
// (c), (e) while causing a FALSE BLOCK, and a research-only round-trip leaves
// the tree side — five of the seven writer files — unprotected.

const logEntry = (over: Record<string, unknown> = {}) => ({
  id: "log_001",
  plan_item_id: null,
  performed: "2026-09-28",
  tool: "record_search",
  query: { surname: "Edwards" },
  outcome: "negative",
  results_examined: 0,
  external_site: null,
  ...over,
});

const withLog = (entries: unknown[]) => ({ ...minimalResearch, log: entries });
const emptyTree = () => tree([]);

/** The premise every field-based case rests on: the chosen shape must pass
 *  validation as a live object and fail as the bytes the store would write. If
 *  a future type check closes the field, this fails loudly and names why,
 *  instead of the regression test quietly passing for a new reason. */
async function assertExercisesTheGap(research: unknown, treeDoc: unknown) {
  const raw = await validateParsed(research as any, treeDoc as any, {});
  const round = await validateParsed(
    JSON.parse(JSON.stringify(research)),
    JSON.parse(JSON.stringify(treeDoc)),
    {},
  );
  expect(raw.valid, "premise: the raw object must be VALID, or this proves nothing").toBe(true);
  expect(round.valid, "premise: the serialized form must be INVALID").toBe(false);
}

describe("validateIntroduced validates the serialized form (#2934)", () => {
  it("(a) blocks on a required key the call appended as undefined", async () => {
    const after = withLog([logEntry({ external_site: undefined })]);
    await assertExercisesTheGap(after, emptyTree());

    const result = await validateIntroduced(
      { research: minimalResearch, tree: emptyTree() },
      { research: after, tree: emptyTree() },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.message)).toContain("missing required field 'external_site'");
    // Reverting: the `after.research` round-trip.
  });

  it("(b) still tolerates that same shape when it was already there", async () => {
    // The case an `after`-only round-trip gets WRONG: it would report the
    // pre-existing error as introduced and block a legitimate write — the
    // #1572 false-deny this module exists to kill. (a)'s `before` is empty, so
    // `preExistingCount` is 0 there and the warning assertion is vacuous; this
    // is the non-vacuous version.
    const drifted = logEntry({ id: "log_001", external_site: undefined });
    const before = withLog([drifted]);
    const after = withLog([drifted, logEntry({ id: "log_002" })]);
    await assertExercisesTheGap(before, emptyTree());

    const result = await validateIntroduced(
      { research: before, tree: emptyTree() },
      { research: after, tree: emptyTree() },
    );
    expect(result.valid, "a pre-existing serialized-form error must not block").toBe(true);
    expect(result.warnings.map((w) => w.message).join(" ")).toMatch(/1 pre-existing schema error/);
    // Reverting: the `before.research` round-trip.
  });

  it("(c) blocks on the TREE side too", async () => {
    // Five of the seven writer files pass a tree as the mutated document, so a
    // research-only fix would leave most call sites unprotected.
    const person: any = { ...validPerson("I1", "Thomas", "Edwards"), id: undefined };
    await assertExercisesTheGap(minimalResearch, tree([person]));

    const result = await validateIntroduced(
      { research: minimalResearch, tree: emptyTree() },
      { research: minimalResearch, tree: tree([person]) },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.message)).toContain("missing required field 'id'");
    // Reverting: the `after.tree` round-trip.
  });

  it("(d) never throws on an unserializable document", async () => {
    // `JSON.parse(JSON.stringify(undefined))` is a SyntaxError and a circular
    // reference is a TypeError. A throw here would skip `cleanupSidecars` in
    // research-log-append and orphan a sidecar with no recovery.
    const undefinedTree = await validateIntroduced(
      { research: minimalResearch, tree: undefined },
      { research: minimalResearch, tree: undefined },
    );
    expect(undefinedTree.valid).toBeDefined();

    const circular: any = { ...minimalResearch };
    circular.self = circular;
    const circularDoc = await validateIntroduced(
      { research: circular, tree: emptyTree() },
      { research: circular, tree: emptyTree() },
    );
    expect(circularDoc.valid).toBeDefined();
    // Reverting: the `catch`. (A separate `x === undefined` fast path was
    // dropped — the catch makes it unobservable, so no test could pin it.)
  });

  it("(e) is not specific to one field", async () => {
    const after = withLog([logEntry({ query: undefined })]);
    await assertExercisesTheGap(after, emptyTree());

    const result = await validateIntroduced(
      { research: minimalResearch, tree: emptyTree() },
      { research: after, tree: emptyTree() },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.message)).toContain("missing required field 'query'");
  });

  it("(f) tolerates pre-existing tree drift when before and after share the tree", async () => {
    // The ONLY case that reds when the `before.tree` round-trip is reverted,
    // and it is not hypothetical: research-log-append passes the same `tree`
    // reference as both before and after
    // (`{ research: beforeResearch, tree }, { research, tree }`), so without
    // this every call on a tree-drifted project would hard-fail on an error it
    // did not introduce.
    const shared = tree([{ ...validPerson("I1", "Thomas", "Edwards"), id: undefined } as any]);
    await assertExercisesTheGap(minimalResearch, shared);

    const result = await validateIntroduced(
      { research: minimalResearch, tree: shared },
      { research: withLog([logEntry()]), tree: shared },
    );
    expect(result.valid, "a pre-existing TREE error must not block a research write").toBe(true);
    expect(result.warnings.map((w) => w.message).join(" ")).toMatch(/1 pre-existing schema error/);
    // Reverting: the `before.tree` round-trip.
  });
});
