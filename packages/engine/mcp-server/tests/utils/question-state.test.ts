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
    // is still outstanding, and proof-conclusion owns it (#1399).
    // Anchored at the start deliberately — a tail-only match passes for any
    // skill name, which is how the stale `question-selection` hint survived.
    expect(s.nextStep).toMatch(/^proof-conclusion — .*mark the question resolved/);
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
      plans: [{ id: "pl_1", question_id: "q_002", items: [] }],
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
});
