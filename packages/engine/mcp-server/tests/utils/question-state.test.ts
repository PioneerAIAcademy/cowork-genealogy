import { describe, it, expect } from "vitest";
import { questionStatus, questionStates } from "../../src/utils/question-state.js";
import { ATTACHMENT_LINK_RATIONALE, countsForProofGate, isAttachmentLink } from "../../src/utils/tree-person.js";
import { unlinkedProofInvariants } from "../../src/tools/research-append.js";

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
    const d = doc({
      plans: [{ id: "pl_1", question_id: Q, items: [{ id: "pli_1", status: "planned", repository: "FamilySearch" }] }],
    });
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

  describe("the search step is picked by the next item's repository (issue #1851)", () => {
    const plan = (items: Record<string, unknown>[], status = "active") => ({
      id: "pl_1",
      question_id: Q,
      status,
      items,
    });

    it("a non-FamilySearch item routes to search-external-sites, naming the item", () => {
      const d = doc({ plans: [plan([{ id: "pli_1", sequence: 1, status: "planned", repository: "MyHeritage" }])] });
      expect(questionStatus(d, question()).nextStep).toBe("search-external-sites — pli_1 (MyHeritage)");
    });

    it("the lowest-sequence unexecuted item decides, skipping completed ones", () => {
      const d = doc({
        plans: [
          plan([
            { id: "pli_2", sequence: 2, status: "planned", repository: "Ancestry" },
            { id: "pli_1", sequence: 1, status: "completed", repository: "Ancestry" },
            { id: "pli_3", sequence: 3, status: "planned", repository: "FamilySearch" },
          ]),
        ],
      });
      expect(questionStatus(d, question()).nextStep).toBe("search-external-sites — pli_2 (Ancestry)");
    });

    it("any repository naming FamilySearch stays search-records", () => {
      const d = doc({
        plans: [plan([{ id: "pli_1", sequence: 1, status: "planned", repository: "FamilySearch (full-text)" }])],
      });
      expect(questionStatus(d, question()).nextStep).toBe("search-records");
    });

    it("an item on a superseded plan is never dispatched", () => {
      const d = doc({
        plans: [
          plan([{ id: "pli_1", sequence: 1, status: "planned", repository: "MyHeritage" }], "superseded"),
          { ...plan([{ id: "pli_2", sequence: 1, status: "planned", repository: "FamilySearch" }]), id: "pl_2" },
        ],
      });
      expect(questionStatus(d, question()).nextStep).toBe("search-records");
    });

    it("searching with only negative entries is not an extraction step", () => {
      const d = doc({
        plans: [
          plan([
            { id: "pli_1", sequence: 1, status: "completed", repository: "FamilySearch" },
            { id: "pli_2", sequence: 2, status: "planned", repository: "FamilySearch" },
          ]),
        ],
        log: [{ id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "negative" }],
      });
      const s = questionStatus(d, question());
      expect(s.state).toBe("searching");
      expect(s.nextStep).toBe("search-records");
    });

    it("every item done and nothing found goes to research-exhaustiveness", () => {
      const d = doc({
        plans: [plan([{ id: "pli_1", sequence: 1, status: "completed", repository: "FamilySearch" }])],
        log: [{ id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "negative" }],
      });
      expect(questionStatus(d, question()).nextStep).toMatch(/^research-exhaustiveness/);
    });

    it("an uncited positive entry is extraction, whatever is left on the plan", () => {
      const d = doc({
        plans: [
          plan([
            { id: "pli_1", sequence: 1, status: "completed", repository: "FamilySearch" },
            { id: "pli_2", sequence: 2, status: "planned", repository: "MyHeritage" },
          ]),
        ],
        log: [{ id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" }],
      });
      expect(questionStatus(d, question()).nextStep).toMatch(/^extraction/);
    });

    it("once evidence exists an uncited entry does not hold the question on extraction", () => {
      const d = doc({
        plans: [plan([{ id: "pli_1", sequence: 1, status: "completed", repository: "FamilySearch" }])],
        log: [
          { id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" },
          { id: "log_2", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" },
        ],
        assertions: [{ id: "a_1", log_entry_id: "log_1", extracted_for_question_ids: [Q] }],
        person_evidence: [{ assertion_id: "a_1", person_id: "I1" }],
      });
      const s = questionStatus(d, question());
      expect(s.state).toBe("evidence-gathered");
      expect(s.nextStep).toMatch(/^research-exhaustiveness/);
    });

    it("an external-site hand-off whose capture has not come back is not extraction", () => {
      const d = doc({
        plans: [plan([{ id: "pli_1", sequence: 1, status: "in_progress", repository: "MyHeritage" }])],
        log: [
          {
            id: "log_1",
            plan_item_id: "pli_1",
            tool: "external_site",
            outcome: "partial",
            external_site: { capture_received: false },
          },
        ],
      });
      expect(questionStatus(d, question()).nextStep).toBe("search-external-sites — pli_1 (MyHeritage)");
    });

    it("a returned external-site capture is extraction", () => {
      const d = doc({
        plans: [plan([{ id: "pli_1", sequence: 1, status: "completed", repository: "MyHeritage" }])],
        log: [
          {
            id: "log_1",
            plan_item_id: "pli_1",
            tool: "external_site",
            outcome: "positive",
            external_site: { capture_received: true },
          },
        ],
      });
      expect(questionStatus(d, question()).nextStep).toMatch(/^extraction/);
    });
  });

  it("a plan belonging to ANOTHER question does not count", () => {
    const d = doc({ plans: [{ id: "pl_1", question_id: "q_999", items: [{ id: "pli_1" }] }] });
    expect(questionStatus(d, question()).state).toBe("framed");
  });

  it("evidence-gathered: an assertion extracted for this question", () => {
    const d = doc({
      assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }],
      person_evidence: [{ assertion_id: "a_1", person_id: "I1" }],
    });
    const s = questionStatus(d, question());
    expect(s.state).toBe("evidence-gathered");
    expect(s.nextStep).toMatch(/research-exhaustiveness/);
  });

  it("concluded, uncritiqued, unresolved: the next step is re-concluding with proof-conclusion", () => {
    // gps-mentor runs only on request (issue #2951), so an uncritiqued summary
    // is not a step. A summary on an open question was written while blocked,
    // and the resolve belongs to proof-conclusion, not question-selection.
    const d = doc({ proof_summaries: [{ id: "ps_001", question_id: Q }] });
    const s = questionStatus(d, question());
    expect(s.state).toBe("concluded");
    expect(s.nextStep).toBe("proof-conclusion — concluded while blocked: re-conclude ps_001");
    expect(s.nextStep).not.toMatch(/gps-mentor/);
  });

  it("concluded AND resolved, with no critique, has nothing outstanding", () => {
    const d = doc({
      questions: [question({ status: "resolved" })],
      proof_summaries: [{ id: "ps_001", question_id: Q }],
    });
    const s = questionStatus(d, question({ status: "resolved" }));
    expect(s.state).toBe("concluded");
    expect(s.nextStep).toBeNull();
  });

  it("critiqued: every summary carries a live proof-critique verdict", () => {
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q }],
      evaluations: [{ id: "ev_1", focus: "proof-critique", target_id: "ps_001", superseded_by: null }],
    });
    const s = questionStatus(d, question());
    expect(s.state).toBe("critiqued");
    // An on-demand critique does not change what is outstanding: concluding
    // again, which proof-conclusion owns.
    expect(s.nextStep).toBe("proof-conclusion — concluded while blocked: re-conclude ps_001");
  });

  it("critiqued AND resolved has nothing outstanding", () => {
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
  it("a not_proved summary blocked by an open conflict routes to conflict-resolution, not back to proof-conclusion", () => {
    // The re-conclude arm sits below the conflict arm, so a question concluded
    // while blocked cannot loop between proof-conclusion and the router.
    const d = doc({
      proof_summaries: [{ id: "ps_001", question_id: Q, tier: "not_proved" }],
      conflicts: [{ id: "c_001", status: "unresolved", blocks_question_ids: [Q] }],
    });
    const s = questionStatus(d, question());
    expect(s.nextStep).toMatch(/^conflict-resolution — unresolved c_001/);
    expect(s.nextStep).not.toMatch(/proof-conclusion/);
  });

  it("the latest summary is the one named when a question was concluded twice while blocked", () => {
    const d = doc({
      proof_summaries: [
        { id: "ps_001", question_id: Q, tier: "not_proved" },
        { id: "ps_004", question_id: Q, tier: "not_proved" },
      ],
    });
    expect(questionStatus(d, question()).nextStep).toBe(
      "proof-conclusion — concluded while blocked: re-conclude ps_004",
    );
  });

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

describe("questionStatus — a question with no linked assertion routes to person-evidence", () => {
  const extracted = (...ids: string[]) => ids.map((id) => ({ id, extracted_for_question_ids: [Q] }));

  it("extracted assertions and no person_evidence at all are the next step", () => {
    // LZJF-J13 (issue #3177): 15 assertions, 0 links, and the router went on to
    // exhaustiveness and a Probable proof.
    const s = questionStatus(doc({ assertions: extracted("a_1", "a_2", "a_3") }), question());
    expect(s.state).toBe("evidence-gathered");
    expect(s.nextStep).toBe("person-evidence — none of this question's 3 assertions is linked to a person");
  });

  const link = (rationale: string, extra: Record<string, unknown> = {}) => ({
    id: "pe_1", assertion_id: "a_1", person_id: "I1", confidence: "speculative", match_score: null, rationale, superseded_by: null, ...extra,
  });

  it("an unchecked attachment link still counts as none; a speculative link the researcher confirmed does not (#3516)", () => {
    const attachment = questionStatus(doc({ assertions: extracted("a_1"), person_evidence: [link(ATTACHMENT_LINK_RATIONALE)] }), question());
    expect(attachment.nextStep).toMatch(/^person-evidence/);
    const confirmed = questionStatus(
      doc({ assertions: extracted("a_1"), person_evidence: [link("The researcher confirmed this weak match.")] }),
      question(),
    );
    expect(confirmed.nextStep ?? "").not.toMatch(/^person-evidence/);
  });

  it("the researcher-confirmed speculative link satisfies the rung and not the proof gate; the rationale alone is not an attachment", () => {
    const confirmed = link("The researcher confirmed this weak match.");
    expect(countsForProofGate(confirmed)).toBe(false);
    expect(isAttachmentLink(link(ATTACHMENT_LINK_RATIONALE))).toBe(true);
    expect(isAttachmentLink(link(ATTACHMENT_LINK_RATIONALE, { confidence: "probable" }))).toBe(false);
    expect(isAttachmentLink(link(ATTACHMENT_LINK_RATIONALE, { match_score: 0.8 }))).toBe(false);
  });

  it("the unlinked-proof gate refuses a proof resting only on speculative links, and accepts one link that is not", () => {
    const research = (pe: any[]) => ({ assertions: [{ id: "a_1" }], person_evidence: pe });
    const proof = { id: "ps_001", tier: "probable", supporting_assertion_ids: ["a_1"] };
    expect(unlinkedProofInvariants(proof, research([link(ATTACHMENT_LINK_RATIONALE)])).join(" ")).toMatch(/not speculative/);
    expect(unlinkedProofInvariants(proof, research([link("checked", { confidence: "probable", match_score: 0.9 })]))).toEqual([]);
  });

  it("one linked assertion clears it, though its household members stay unlinked", () => {
    const d = doc({
      assertions: extracted("a_1", "a_2", "a_3"),
      person_evidence: [{ assertion_id: "a_1", person_id: "I1" }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^research-exhaustiveness/);
  });

  it("a link to another question's assertion does not clear this one", () => {
    const d = doc({
      assertions: [...extracted("a_1"), { id: "a_9", extracted_for_question_ids: ["q_999"] }],
      person_evidence: [{ assertion_id: "a_9", person_id: "I1" }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^person-evidence/);
  });

  it("a superseded link does not count as a link", () => {
    const d = doc({
      assertions: extracted("a_1"),
      person_evidence: [{ id: "pe_1", assertion_id: "a_1", person_id: "I1", superseded_by: "pe_2" }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^person-evidence/);
  });

  it("a registered unresolved conflict still outranks it", () => {
    const d = doc({
      assertions: extracted("a_1"),
      conflicts: [{ id: "c_1", status: "unresolved", competing_assertion_ids: ["a_1"] }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^conflict-resolution — unresolved c_1/);
  });

  it("it outranks competing parent sets, which the routing table lists after it", () => {
    const tree = {
      relationships: ["I2", "I3", "I4"].map((p) => ({ type: "ParentChild", parent: p, child: "I1" })),
    };
    const d = doc({ project: { subject_person_ids: ["I1"] }, assertions: extracted("a_1") });
    const s = questionStatus(d, question(), tree);
    expect(s.competingParentSets).toHaveLength(1);
    expect(s.nextStep).toMatch(/^person-evidence/);
  });

  it("once a proof summary exists it is no longer the next step", () => {
    // The proof write is where an unlinked conclusion is refused; re-opening a
    // concluded question from the ladder would be advice nobody can act on.
    const d = doc({
      assertions: extracted("a_1"),
      proof_summaries: [{ id: "ps_001", question_id: Q }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^proof-conclusion — concluded while blocked/);
  });

  it("a question with no assertions yet is not affected", () => {
    expect(questionStatus(doc(), question()).nextStep).toBe("research-plan");
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

  it("a bounded date is a span: a year inside it agrees, one beyond its far end disagrees", () => {
    const birth = (id: string, standard_date: string) =>
      ({ id, fact_type: "birth", date: "x", standard_date, extracted_for_question_ids: [Q] });
    for (const other of ["1847", "Bef 1845", "Abt 1849"]) {
      const inside = doc({
        assertions: [birth("a_1", "Bet 1836 and 1848"), birth("a_2", other)],
        person_evidence: linked("a_1", "a_2"),
      });
      expect(questionStatus(inside, question()).unregisteredDisagreements).toEqual([]);
    }
    const beyond = doc({
      assertions: [birth("a_1", "Bet 1836 and 1848"), birth("a_2", "1851")],
      person_evidence: linked("a_1", "a_2"),
    });
    expect(questionStatus(beyond, question()).unregisteredDisagreements).toEqual([
      { personId: "I2", fact: "birth year", assertionIds: ["a_1", "a_2"] },
    ]);
  });

  it("Edmond's three bounded dates do not disagree with a year inside their bounds", () => {
    const birth = (id: string, date: string, standard_date?: string) =>
      ({ id, fact_type: "birth", date, ...(standard_date ? { standard_date } : {}), extracted_for_question_ids: [Q] });
    const cases: Array<[ReturnType<typeof birth>, string]> = [
      [birth("a_1", "between 1836 and 1848"), "1845"],
      [birth("a_1", "after 1870, before 1880"), "1878"],
      [birth("a_1", "Bef 1880", "Bef 1880"), "1876"],
    ];
    for (const [bounded, year] of cases) {
      const d = doc({ assertions: [bounded, birth("a_2", year)], person_evidence: linked("a_1", "a_2") });
      expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
    }
  });

  it("a one-sided date does not disagree on its open side", () => {
    const birth = (id: string, standard_date: string) =>
      ({ id, fact_type: "birth", date: "x", standard_date, extracted_for_question_ids: [Q] });
    for (const [open, year] of [["Bef 1880", "1850"], ["Aft 1870", "1890"]]) {
      const d = doc({ assertions: [birth("a_1", open), birth("a_2", year)], person_evidence: linked("a_1", "a_2") });
      expect(questionStatus(d, question()).unregisteredDisagreements).toEqual([]);
    }
  });

  it("birth years exactly three apart disagree", () => {
    const birth = (id: string, date: string) => ({ id, fact_type: "birth", date, extracted_for_question_ids: [Q] });
    const d = doc({ assertions: [birth("a_1", "1819"), birth("a_2", "1822")], person_evidence: linked("a_1", "a_2") });
    expect(questionStatus(d, question()).unregisteredDisagreements).toHaveLength(1);
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

  it("a superseded link no longer ties its assertion to the old person", () => {
    const d = doc({
      assertions: [birthplace("a_1", "England"), birthplace("a_2", "Ohio")],
      person_evidence: [
        { id: "pe_1", assertion_id: "a_1", person_id: "I2", superseded_by: null },
        { id: "pe_2", assertion_id: "a_2", person_id: "I2", superseded_by: "pe_3" },
        { id: "pe_3", assertion_id: "a_2", person_id: "I3", superseded_by: null },
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
    doc({
      project: { subject_person_ids: ["I1"] },
      assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }],
      person_evidence: [{ assertion_id: "a_1", person_id: "I1" }],
      ...extra,
    });

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

  it("only birth parents count: Step, Adoptive, Foster and Guardian do not, in any casing", () => {
    const rel = (parent: string, subtype?: string) =>
      ({ type: "ParentChild", parent, child: "I1", ...(subtype ? { subtype } : {}) });
    for (const subtype of ["Step", "step", "Adoptive", "Foster", "Guardian"]) {
      const t = { relationships: [rel("I2"), rel("I3"), rel("I4", subtype)] };
      expect(questionStatus(withSubject(), question(), t).competingParentSets).toEqual([]);
    }
    const biological = { relationships: [rel("I2"), rel("I3", "Biological"), rel("I4", "biological")] };
    expect(questionStatus(withSubject(), question(), biological).competingParentSets).toEqual([
      { personId: "I1", parentIds: ["I2", "I3", "I4"] },
    ]);
  });

  it("three birth parents are already competing", () => {
    const t = { relationships: tree.relationships.slice(0, 3) };
    expect(questionStatus(withSubject(), question(), t).competingParentSets).toEqual([
      { personId: "I1", parentIds: ["I2", "I3", "I4"] },
    ]);
  });

  it("one related hypothesis does not clear it", () => {
    const hyps = [{ id: "h_1", related_question_ids: [Q] }];
    expect(questionStatus(withSubject({ hypotheses: hyps }), question(), tree).competingParentSets).toHaveLength(1);
  });

  it("a person outside the question's scope is not reported", () => {
    const d = doc({ assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }] });
    expect(questionStatus(d, question(), tree).competingParentSets).toEqual([]);
  });

  it("a person reached only through a superseded link is not in scope", () => {
    const d = doc({
      assertions: [{ id: "a_1", extracted_for_question_ids: [Q] }],
      person_evidence: [{ id: "pe_1", assertion_id: "a_1", person_id: "I1", superseded_by: "pe_2" }],
    });
    expect(questionStatus(d, question(), tree).competingParentSets).toEqual([]);
  });

  it("without a tree it reports nothing", () => {
    expect(questionStatus(withSubject(), question()).competingParentSets).toEqual([]);
  });
});

/**
 * Section B's "not exhaustive" choice.
 *
 * The search stopped on RESOURCES rather than on a finding, so neither
 * searching on nor concluding is wrong, and only the researcher can say which.
 * All four conditions have to hold, and each rules out a different wrong
 * routing — so each gets its own case where exactly that one is missing.
 */
describe("questionStatus — the researcher's choice (section B)", () => {
  const SPENT = {
    stopped_because: "resources_spent",
    justification: null,
    log_entry_ids: ["log_1"],
    stop_criteria: null,
    not_reached: [],
  };
  const spent = (extra: Record<string, unknown> = {}) =>
    question({ search_stop: { ...SPENT, ...extra } });
  /** A plan whose one item is done, and the log entry that did it. */
  const settled = (itemStatus = "completed") => ({
    plans: [
      {
        id: "pl_1",
        question_id: Q,
        status: "active",
        items: [{ id: "pli_1", status: itemStatus, repository: "FamilySearch" }],
      },
    ],
    log: [{ id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "partial" }],
  });

  it("fires when all four hold, and defaults to research-plan", () => {
    const s = questionStatus(doc(settled()), spent());
    expect(s.nextStep).toBe(
      "researcher's choice: research-plan or proof-conclusion (default research-plan)",
    );
  });

  it("defaults to research-plan when the overturn risk is high — a named source could change the answer", () => {
    for (const justification of [
      "Overturn risk: high — the 1880 probate packet is unsearched.",
      "overturn risk: HIGH",
      "Overturn risk: lowish? no — high",
    ]) {
      const s = questionStatus(doc(settled()), spent({ justification }));
      expect(s.nextStep, justification).toMatch(/\(default research-plan\)$/);
    }
  });

  it("defaults to proof-conclusion when the overturn risk is low", () => {
    const s = questionStatus(
      doc(settled()),
      spent({ justification: "Overturn risk: low — two independent sources agree." }),
    );
    expect(s.nextStep).toMatch(/\(default proof-conclusion\)$/);
  });

  it("a justification with no Overturn risk prefix still defaults to research-plan", () => {
    // Older stops wrote free prose here. Defaulting those to conclude would end
    // questions early on a document that never made that judgement.
    const s = questionStatus(doc(settled()), spent({ justification: "Ran out of budget." }));
    expect(s.nextStep).toMatch(/\(default research-plan\)$/);
  });

  it("does not fire on any other stop reason — those are findings, not budgets", () => {
    for (const reason of ["blocked_by_conflict", "criteria_met", "premise_invalidated"]) {
      const s = questionStatus(doc(settled()), spent({ stopped_because: reason }));
      expect(s.nextStep, reason).not.toMatch(/researcher's choice/);
    }
  });

  it("does not fire once a proof summary exists — the question is concluded", () => {
    const d = doc({
      ...settled(),
      proof_summaries: [{ id: "ps_1", question_id: Q, tier: "probable" }],
    });
    expect(questionStatus(d, spent()).nextStep).not.toMatch(/researcher's choice/);
  });

  it("does not fire while a plan item is still open — the search has not stopped", () => {
    for (const status of ["planned", "in_progress"]) {
      const d = doc(settled(status));
      expect(questionStatus(d, spent()).nextStep, status).not.toMatch(/researcher's choice/);
    }
  });

  it("does not fire when a log entry of the question is not listed in the stop", () => {
    // The stop was written before that search was weighed, so it does not
    // describe the state the choice would be made from.
    const d: any = doc(settled());
    d.log.push({ id: "log_2", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" });
    expect(questionStatus(d, spent()).nextStep).not.toMatch(/researcher's choice/);
  });

  // ── the closing-entry half: why a plain plan_item_id filter is not enough ──

  const HANDOFF_URL = "https://www.ancestry.com/search/?name=Flynn";
  const handOff = (captureReceived: boolean) => ({
    id: "log_1",
    plan_item_id: "pli_1",
    tool: "external_site",
    outcome: "partial",
    external_site: {
      site: "ancestry",
      url_generated: HANDOFF_URL,
      capture_received: captureReceived,
    },
  });
  const upload = (id: string) => ({
    // The researcher's upload. It carries NO plan_item_id, which is exactly why
    // filtering the log by plan_item_id alone would never see it.
    id,
    plan_item_id: null,
    tool: "external_site",
    outcome: "positive",
    external_site: { site: "ancestry", url_generated: HANDOFF_URL, capture_received: true },
  });
  const oneItem = (status: string, log: any[]) => ({
    plans: [{ id: "pl_1", question_id: Q, status: "active", items: [{ id: "pli_1", status }] }],
    log,
  });

  it("an item waiting only on an upload does not keep the choice from firing", () => {
    // Section I: the researcher is the blocker. Counting it as open would park
    // the question behind a hand-off nobody inside the project can close.
    const d = doc(oneItem("in_progress", [handOff(false)]));
    expect(questionStatus(d, spent()).nextStep).toMatch(/researcher's choice/);
  });

  it("an upload that closes a hand-off and is NOT listed in the stop blocks the choice", () => {
    // The entry carries no plan_item_id, so it is matched by URL. Without that
    // match the upload could never undo a choice the stop predates, and the
    // question would sit at the choice forever.
    const d = doc(oneItem("completed", [handOff(true), upload("log_2")]));
    expect(questionStatus(d, spent()).nextStep).not.toMatch(/researcher's choice/);
  });

  it("the same upload listed in the stop lets the choice fire", () => {
    const d = doc(oneItem("completed", [handOff(true), upload("log_2")]));
    expect(questionStatus(d, spent({ log_entry_ids: ["log_1", "log_2"] })).nextStep).toMatch(
      /researcher's choice/,
    );
  });

  it("an unrelated upload to a different URL is not this question's to account for", () => {
    const elsewhere = {
      ...upload("log_2"),
      external_site: {
        site: "ancestry",
        url_generated: "https://example.test/other",
        capture_received: true,
      },
    };
    const d = doc(oneItem("completed", [handOff(true), elsewhere]));
    expect(questionStatus(d, spent()).nextStep).toMatch(/researcher's choice/);
  });
});

describe("questionStatus — ending on an unsettled conflict (section E, decision 12)", () => {
  // Once a conflict cannot be settled and nothing is left to search, re-running
  // conflict-resolution weighs the same evidence forever. `weighed_log_entry_ids`
  // is what tells "already weighed" from "new evidence to weigh".
  const plan = (status: string) => ({
    id: "pl_1", question_id: Q, status: "active",
    items: [{ id: "pli_1", status }],
  });
  const log = [
    { id: "log_1", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" },
    { id: "log_2", plan_item_id: "pli_1", tool: "record_search", outcome: "negative" },
  ];
  const conflict = (extra: Record<string, unknown> = {}) => ({
    id: "c_1", status: "unresolved", blocks_question_ids: [Q],
    independence_analysis: "Both trace to the same informant.",
    weighed_log_entry_ids: ["log_1", "log_2"],
    ...extra,
  });
  const settled = (extra: Record<string, unknown> = {}) =>
    doc({ plans: [plan("completed")], log, conflicts: [conflict()], ...extra });

  it("an analysed conflict that has weighed every entry, nothing open, routes to proof-conclusion", () => {
    const s = questionStatus(settled(), question());
    expect(s.nextStep).toMatch(/^proof-conclusion — unsettled conflict c_1/);
  });

  it("once the not_proved conflict summary exists, nothing further is due", () => {
    const d = settled({
      proof_summaries: [{ id: "ps_1", question_id: Q, tier: "not_proved", shortfall: "conflict" }],
    });
    expect(questionStatus(d, question()).nextStep).toBeNull();
  });

  it("a summary of another shortfall is not the terminal marker", () => {
    const d = settled({
      proof_summaries: [{ id: "ps_1", question_id: Q, tier: "not_proved", shortfall: "gap" }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^proof-conclusion/);
  });

  it("one log entry the weighed list does not cover sends it back to conflict-resolution", () => {
    const d = settled({
      log: [...log, { id: "log_3", plan_item_id: "pli_1", tool: "record_search", outcome: "positive" }],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^conflict-resolution — unresolved c_1/);
  });

  it("a researcher's upload closing a hand-off is evidence the list must cover too", () => {
    const url = "https://example.org/search?q=x";
    const d = settled({
      log: [
        ...log,
        { id: "log_3", plan_item_id: "pli_1", tool: "external_site", outcome: "partial",
          external_site: { site: "ancestry", url_generated: url, capture_received: false } },
        { id: "log_4", tool: "external_site", outcome: "positive",
          external_site: { site: "ancestry", url_generated: url, capture_received: true } },
      ],
      conflicts: [conflict({ weighed_log_entry_ids: ["log_1", "log_2", "log_3"] })],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^conflict-resolution/);
  });

  it("does not fire while a plan item is still open", () => {
    // With the conflict already analysed this is section E's OTHER arm: there
    // is something left to search, so go run it rather than weigh again.
    const d = doc({ plans: [plan("planned")], log, conflicts: [conflict()] });
    const step = questionStatus(d, question()).nextStep;
    expect(step).not.toMatch(/unsettled conflict/);
    expect(step).toBe("search-records");
  });

  it("does not fire on a conflict never analysed, or one with no weighed list", () => {
    for (const c of [conflict({ independence_analysis: null }), conflict({ weighed_log_entry_ids: undefined })]) {
      const d = doc({ plans: [plan("completed")], log, conflicts: [c] });
      expect(questionStatus(d, question()).nextStep).toMatch(/^conflict-resolution/);
    }
  });

  it("an unanalysed conflict beside an analysed one still goes to conflict-resolution first", () => {
    const d = settled({
      conflicts: [conflict(), conflict({ id: "c_2", independence_analysis: "" })],
    });
    expect(questionStatus(d, question()).nextStep).toMatch(/^conflict-resolution/);
  });

  it("the same holds for a question already exhaustive_declared", () => {
    const s = questionStatus(settled(), question({ status: "exhaustive_declared" }));
    expect(s.nextStep).toMatch(/^proof-conclusion — unsettled conflict/);
  });
});

describe("questionStatus — a conflict that wants new evidence (section E)", () => {
  const openPlan = (repository = "FamilySearch") => ({
    id: "pl_1",
    question_id: Q,
    status: "active",
    items: [{ id: "pli_1", status: "planned", sequence: 1, repository }],
  });
  const analysed = (extra: Record<string, unknown> = {}) => ({
    id: "cf_1",
    status: "unresolved",
    blocks_question_ids: [Q],
    independence_analysis: "Both trace to the same compiled abstract.",
    ...extra,
  });

  it("routes to the search once every open conflict has been analysed", () => {
    // Without this the conflict rung fires forever and the items the route PRs
    // ask research-plan to write never run -- the loop they would introduce.
    const d = doc({ plans: [openPlan()], log: [], conflicts: [analysed()] });
    expect(questionStatus(d, question()).nextStep).toBe("search-records");
  });

  it("names search-external-sites when the decisive item is not FamilySearch", () => {
    // The plan writes this arm as "the next step is search-records", right for
    // a FamilySearch item and wrong for an Ancestry one: the router would spawn
    // the wrong agent. The item is asked, as the dispatch arm already does.
    const d = doc({ plans: [openPlan("Ancestry")], log: [], conflicts: [analysed()] });
    expect(questionStatus(d, question()).nextStep).toBe(
      "search-external-sites — pli_1 (Ancestry)",
    );
  });

  it("an unanalysed conflict goes to conflict-resolution first, even beside an analysed one", () => {
    const d = doc({
      plans: [openPlan()],
      log: [],
      conflicts: [analysed(), analysed({ id: "cf_2", independence_analysis: null })],
    });
    expect(questionStatus(d, question()).nextStep).toBe(
      "conflict-resolution — unresolved cf_1, cf_2",
    );
  });

  it("does not fire with no open item — that is the unsettled arm's case", () => {
    const d = doc({
      plans: [{ ...openPlan(), items: [{ id: "pli_1", status: "completed", repository: "FamilySearch" }] }],
      log: [],
      conflicts: [analysed()],
    });
    expect(questionStatus(d, question()).nextStep).not.toBe("search-records");
  });

  it("an item waiting only on an upload is not an open item here either", () => {
    // Section I. Counting it would route forever to a search nobody can run.
    const d = doc({
      plans: [{
        ...openPlan("Ancestry"),
        items: [{ id: "pli_1", status: "in_progress", repository: "Ancestry" }],
      }],
      log: [{
        id: "log_9",
        plan_item_id: "pli_1",
        tool: "external_site",
        outcome: "partial",
        external_site: {
          site: "ancestry",
          url_generated: "https://example.test/s?q=9",
          capture_received: false,
        },
      }],
      conflicts: [analysed()],
    });
    expect(questionStatus(d, question()).nextStep).not.toBe(
      "search-external-sites — pli_1 (Ancestry)",
    );
  });
});
