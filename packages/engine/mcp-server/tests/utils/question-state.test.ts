import { describe, it, expect } from "vitest";
import { questionStatus, questionStates } from "../../src/utils/question-state.js";

/**
 * Vectors for the advisory per-question state.
 *
 * This is the highest-consequence *new* predicate in the enforcement design —
 * one wrong rung blocks or misdirects work everywhere it is consumed — so every
 * rung of the ladder and every next-step branch gets a case. The equivalent
 * predicates were first written in Python and replayed over 154 committed e2e
 * runs, where they reproduced an independent count of the completion gate's
 * population to within two runs.
 */

const Q = "q_001";
const question = (extra: Record<string, unknown> = {}) => ({ id: Q, status: "open", ...extra });

const doc = (extra: Record<string, unknown> = {}) => ({
  questions: [question()],
  plans: [],
  log: [],
  assertions: [],
  conflicts: [],
  proof_summaries: [],
  evaluations: [],
  ...extra,
});

describe("questionStatus — the state ladder", () => {
  it("framed: a question with no plan", () => {
    const s = questionStatus(doc(), question());
    expect(s.state).toBe("framed");
    expect(s.nextStep).toBe("research-plan");
  });

  it("planned: a plan exists for this question", () => {
    const d = doc({ plans: [{ id: "pl_1", question_id: Q, items: [{ id: "pli_1" }] }] });
    expect(questionStatus(d, question()).state).toBe("planned");
    expect(questionStatus(d, question()).nextStep).toBe("search-records");
  });

  it("searching: a log entry against one of this question's plan items", () => {
    const d = doc({
      plans: [{ id: "pl_1", question_id: Q, items: [{ id: "pli_1" }] }],
      log: [{ id: "log_1", plan_item_id: "pli_1" }],
    });
    expect(questionStatus(d, question()).state).toBe("searching");
  });

  it("a plan belonging to ANOTHER question does not count", () => {
    const d = doc({ plans: [{ id: "pl_1", question_id: "q_999", items: [{ id: "pli_1" }] }] });
    expect(questionStatus(d, question()).state).toBe("framed");
  });

  it("evidence-gathered: an assertion extracted for this question", () => {
    const d = doc({ assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }] });
    const s = questionStatus(d, question());
    expect(s.state).toBe("evidence-gathered");
    expect(s.nextStep).toMatch(/research-exhaustiveness/);
  });

  it("concluded: a proof summary exists but carries no critique", () => {
    const d = doc({ proof_summaries: [{ id: "ps_001", question_id: Q }] });
    const s = questionStatus(d, question());
    expect(s.state).toBe("concluded");
    expect(s.nextStep).toMatch(/gps-mentor.*ps_001/);
  });

  it("critiqued: every summary carries a live proof-critique verdict", () => {
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      evaluations: [{ id: "ev_1", focus: "proof-critique", target_id: "ps_001", superseded_by: null }],
    });
    const s = questionStatus(d, question());
    expect(s.state).toBe("critiqued");
    // Critiqued is the last rung, not the end of the work: the `resolved` write
    // is still outstanding, and it is the transition no skill body claims.
    expect(s.nextStep).toMatch(/mark the question resolved/);
  });

  it("critiqued AND resolved is the only state with nothing outstanding", () => {
    const d = doc({
      questions: [question({ status: "resolved" })],
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      evaluations: [{ id: "ev_1", focus: "proof-critique", target_id: "ps_001", superseded_by: null }],
    });
    const s = questionStatus(d, question({ status: "resolved" }));
    expect(s.state).toBe("critiqued");
    expect(s.nextStep).toBeNull();
  });

  it("a superseded verdict does not advance the state", () => {
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      evaluations: [{ id: "ev_1", focus: "proof-critique", target_id: "ps_001", superseded_by: "ev_2" }],
    });
    expect(questionStatus(d, question()).state).toBe("concluded");
  });

  it("a non-critique evaluation does not count", () => {
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      evaluations: [{ id: "ev_1", focus: "on-demand", target_id: "ps_001", superseded_by: null }],
    });
    expect(questionStatus(d, question()).state).toBe("concluded");
  });
});

describe("questionStatus — conflicts outrank everything", () => {
  it("a conflict blocking this question is the next step", () => {
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      conflicts: [{ id: "c_001", status: "unresolved", blocks_question_ids: [Q] }],
    });
    const s = questionStatus(d, question());
    expect(s.openConflictIds).toEqual(["c_001"]);
    expect(s.nextStep).toMatch(/conflict-resolution.*c_001/);
  });

  it("a conflict over one of this question's assertions also counts", () => {
    const d = doc({
      assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }],
      conflicts: [{ id: "c_002", status: "unresolved", competing_assertion_ids: ["a_1", "a_9"] }],
    });
    expect(questionStatus(d, question()).openConflictIds).toEqual(["c_002"]);
  });

  it("a resolved conflict does not block", () => {
    const d = doc({ conflicts: [{ id: "c_001", status: "resolved", blocks_question_ids: [Q] }] });
    expect(questionStatus(d, question()).openConflictIds).toEqual([]);
  });

  it("an unrelated conflict does not block", () => {
    const d = doc({ conflicts: [{ id: "c_003", status: "unresolved", blocks_question_ids: ["q_999"] }] });
    expect(questionStatus(d, question()).openConflictIds).toEqual([]);
  });

  it("a conflict over another question's assertion does not block this one", () => {
    // The scope guard. `conflictBlocksQuestion` is shared with the completion
    // gate, which passes the PROJECT-WIDE tied-assertion set; this ladder must
    // pass only THIS question's. Both are `Set<string>`, so TypeScript cannot
    // tell them apart and every other vector here passes either way — hand the
    // wrong set in and `openConflictIds` reports every open conflict in the
    // project against every question, which is what `project_context` renders.
    const d = doc({
      assertions: [{ id: "a_1", extracted_for_question_ids: ["q_999"] }],
      conflicts: [{ id: "c_004", status: "unresolved", competing_assertion_ids: ["a_1"] }],
    });
    const s = questionStatus(d, question());
    expect(s.openConflictIds).toEqual([]);
    expect(s.nextStep).not.toMatch(/conflict-resolution/);
  });
});

describe("questionStatus — the resolved-with-no-summary case", () => {
  it("is surfaced as a prompt, not treated as complete", () => {
    // The completion gate lets this pass vacuously on purpose. Advising on it
    // is the right half of that split: prompt, never refuse.
    const d = doc({ questions: [question({ status: "resolved" })] });
    const s = questionStatus(d, question({ status: "resolved" }));
    expect(s.nextStep).toMatch(/proof-conclusion/);
  });
});

describe("questionStates", () => {
  it("returns one entry per question, in document order", () => {
    const d = {
      ...doc(),
      questions: [{ id: "q_001", status: "open" }, { id: "q_002", status: "open" }, { bad: true }],
      // A one-item plan, because a plan with an empty `items` is invalid.
      // `questionStates` never validates, so this fixture cannot fail on it —
      // which is exactly why it is worth not teaching the shape here.
      plans: [{ id: "pl_1", question_id: "q_002", items: [{ id: "pli_001" }] }],
    };
    const all = questionStates(d);
    expect(all.map((s) => s.id)).toEqual(["q_001", "q_002"]);
    expect(all[0].state).toBe("framed");
    expect(all[1].state).toBe("planned");
  });

  it("tolerates a document with no questions at all", () => {
    expect(questionStates({})).toEqual([]);
    expect(questionStates(null)).toEqual([]);
  });

  // storedStatus (#2108 / #2031). `state` is DERIVED from the documents,
  // `storedStatus` is REPORTED from the question. The pair disagreeing is the
  // case the field exists for, so the first test is the one that matters.
  it("storedStatus reports questions[].status even when state disagrees with it", () => {
    const d = doc({ proof_summaries: [{ id: "ps_001", question_id: Q }] });
    const s = questionStatus(d, question({ status: "in_progress" }));
    // Derived from the summary...
    expect(s.state).toBe("concluded");
    // ...while the question itself still says otherwise. Both are correct.
    expect(s.storedStatus).toBe("in_progress");
  });

  it("storedStatus is null when the question carries no status key", () => {
    // A literal, NOT the `question()` helper: the helper always sets
    // `status: "open"`, and spreading `{ status: undefined }` over it leaves the
    // key present, which is the not-a-string case below rather than this one.
    expect(questionStatus(doc(), { id: Q }).storedStatus).toBeNull();
  });

  it("storedStatus is null when status is present but not a string", () => {
    expect(questionStatus(doc(), question({ status: 42 })).storedStatus).toBeNull();
    expect(questionStatus(doc(), question({ status: {} })).storedStatus).toBeNull();
    expect(questionStatus(doc(), question({ status: null })).storedStatus).toBeNull();
  });

  it("storedStatus is present on a resolved question, not only open ones", () => {
    const s = questionStatus(doc(), question({ status: "resolved" }));
    expect(s.storedStatus).toBe("resolved");
  });
});

describe("questionStatus — unregistered disagreements route to conflict-resolution", () => {
  const birthplace = (id: string, place: string, extra: Record<string, unknown> = {}) => ({
    id, fact_type: "birthplace", place, extracted_for_question_ids: [Q], ...extra,
  });
  const linked = (...ids: string[]) => ids.map((id) => ({ assertion_id: id, person_id: "I2" }));

  it("two linked birthplaces that disagree, with conflicts[] empty, are the next step", () => {
    const d = doc({
      assertions: [birthplace("a_1", "England"), birthplace("a_2", "Alabama"), birthplace("a_3", "Alabama")],
      person_evidence: linked("a_1", "a_2", "a_3"),
    });
    const s = questionStatus(d, question());
    expect(s.unregisteredDisagreements).toEqual([
      { personId: "I2", fact: "birth place", assertionIds: ["a_1", "a_2", "a_3"] },
    ]);
    expect(s.nextStep).toMatch(/^conflict-resolution — unregistered disagreement: I2 birth place/);
  });

  it("a birth's place and a birthplace assertion compare as one fact", () => {
    const d = doc({
      assertions: [
        { id: "a_1", fact_type: "birth", place: "Ireland", date: "~1845", extracted_for_question_ids: [Q] },
        birthplace("a_2", "Pennsylvania"),
      ],
      person_evidence: linked("a_1", "a_2"),
    });
    expect(questionStatus(d, question()).unregisteredDisagreements[0]?.fact).toBe("birth place");
  });

  it("a conflict of any status naming the pair covers it", () => {
    for (const status of ["unresolved", "resolved", "moot"]) {
      const d = doc({
        assertions: [birthplace("a_1", "England"), birthplace("a_2", "Alabama")],
        person_evidence: linked("a_1", "a_2"),
        conflicts: [{ id: "c_1", status, competing_assertion_ids: ["a_1", "a_2"] }],
      });
      expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
    }
  });

  it("a conflict naming only one side of the pair does not cover it", () => {
    const d = doc({
      assertions: [birthplace("a_1", "England"), birthplace("a_2", "Alabama")],
      person_evidence: linked("a_1", "a_2"),
      conflicts: [{ id: "c_1", status: "resolved", competing_assertion_ids: ["a_1", "a_9"] }],
    });
    expect(questionStatus(d, question()).unregisteredDisagreements).toHaveLength(1);
  });

  it("a less specific place that the other contains is agreement, not a conflict", () => {
    const d = doc({
      assertions: [
        birthplace("a_1", "England"),
        birthplace("a_2", "x", { standard_place: "England, United Kingdom" }),
        birthplace("a_3", "Mississippi, United States"),
        birthplace("a_4", "Jasper, Mississippi, United States"),
      ],
      person_evidence: [
        ...linked("a_1", "a_2"),
        { assertion_id: "a_3", person_id: "I4" },
        { assertion_id: "a_4", person_id: "I4" },
      ],
    });
    expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
  });

  it("standardization renames and omitted countries are not disagreements", () => {
    const d = doc({
      assertions: [
        birthplace("a_1", "Dundee, Forfarshire, Scotland", { standard_place: "Dundee, Forfarshire, Scotland, United Kingdom" }),
        birthplace("a_2", "Forfarshire, Scotland", { standard_place: "Angus, Scotland, United Kingdom" }),
        birthplace("a_3", "Russia", { standard_place: "Russia" }),
        birthplace("a_4", "Selz, near Odessa, Russia (now Ukraine)", { standard_place: "Selz, Odessa, Kherson, Russian Empire" }),
      ],
      person_evidence: [
        ...linked("a_1", "a_2"),
        { assertion_id: "a_3", person_id: "I5" },
        { assertion_id: "a_4", person_id: "I5" },
      ],
    });
    expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
  });

  it("birth years within the census tolerance agree; beyond it they disagree", () => {
    const birth = (id: string, date: string) => ({ id, fact_type: "birth", date, extracted_for_question_ids: [Q] });
    const near = doc({
      assertions: [birth("a_1", "1819"), birth("a_2", "1821"), birth("a_3", "about 1820")],
      person_evidence: linked("a_1", "a_2", "a_3"),
    });
    expect(questionStatus(near, question()).unregisteredDisagreements).toEqual([]);
    const far = doc({
      assertions: [birth("a_1", "1819"), birth("a_2", "1811")],
      person_evidence: linked("a_1", "a_2"),
    });
    expect(questionStatus(far, question()).unregisteredDisagreements).toEqual([
      { personId: "I2", fact: "birth year", assertionIds: ["a_1", "a_2"] },
    ]);
  });

  it("assertions linked to different persons, or not vital facts, never disagree", () => {
    const d = doc({
      assertions: [
        birthplace("a_1", "England"),
        birthplace("a_2", "Alabama"),
        { id: "a_3", fact_type: "residence", place: "Jasper", extracted_for_question_ids: [Q] },
        { id: "a_4", fact_type: "residence", place: "Smith", extracted_for_question_ids: [Q] },
      ],
      person_evidence: [
        { assertion_id: "a_1", person_id: "I2" },
        { assertion_id: "a_2", person_id: "I3" },
        { assertion_id: "a_3", person_id: "I1" },
        { assertion_id: "a_4", person_id: "I1" },
      ],
    });
    expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
  });

  it("a disagreement wholly within another question's assertions does not route this one", () => {
    const d = doc({
      assertions: [
        birthplace("a_1", "England", { extracted_for_question_ids: ["q_999"] }),
        birthplace("a_2", "Alabama", { extracted_for_question_ids: ["q_999"] }),
      ],
      person_evidence: linked("a_1", "a_2"),
    });
    expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
  });

  it("a registered unresolved conflict still outranks an unregistered one", () => {
    const d = doc({
      assertions: [birthplace("a_1", "England"), birthplace("a_2", "Alabama")],
      person_evidence: linked("a_1", "a_2"),
      conflicts: [{ id: "c_9", status: "unresolved", blocks_question_ids: [Q] }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/unresolved c_9/);
  });
});

describe("questionStatus — competing parent sets route to hypothesis-tracking", () => {
  const tree = {
    persons: [],
    relationships: ["I2", "I3", "I4", "I5"].map((p) => ({ type: "ParentChild", parent: p, child: "I1" })),
  };
  const withSubject = (extra: Record<string, unknown> = {}) =>
    doc({ project: { subject_person_ids: ["I1"] }, assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }], ...extra });

  it("a subject with four parents and no hypotheses is the next step", () => {
    const s = questionStatus(withSubject(), question(), tree);
    expect(s.competingParentSets).toEqual([{ personId: "I1", parentIds: ["I2", "I3", "I4", "I5"] }]);
    expect(s.nextStep).toMatch(/^hypothesis-tracking — competing parent sets: I1/);
  });

  it("two hypotheses related to the question clear it", () => {
    const hyps = [
      { id: "h_1", related_question_ids: [Q] },
      { id: "h_2", related_question_ids: [Q] },
    ];
    expect(questionStatus(withSubject({ hypotheses: hyps }), question(), tree).competingParentSets).toEqual([]);
  });

  it("one parent couple is not competing", () => {
    const t = { relationships: tree.relationships.slice(0, 2) };
    expect(questionStatus(withSubject(), question(), t).competingParentSets).toEqual([]);
  });

  it("a person outside the question's scope is not reported", () => {
    const d = doc({ assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }] });
    expect(questionStatus(d, question(), tree).competingParentSets).toEqual([]);
  });

  it("without a tree it reports nothing", () => {
    expect(questionStatus(withSubject(), question()).competingParentSets).toEqual([]);
  });
});
