# question-selection — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/question-selection/SKILL.md` and its
three reference files (`question-formulation.md`, `pedigree-analysis.md`,
`validation-protocol.md`) as of branch `deep-dive-question-selection`. Every
line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls[].args.entry`,
`output.file_changes`) — judgement calls ("was this the best-sequenced plan")
are excluded, per the guide.

**Save this file. The next auditor of `question-selection` starts here
instead of rebuilding it.**

---

## A. Gating — whether to write a question at all

1. Do not add a new question while any open question has an `in_progress`
   plan item — **unless** an unresolved conflict names that question in
   `blocks_question_ids` (Step 1a + its exception). In the exception case the
   new question's `unblocks` must include the question whose plan is in
   flight.
2. Never write a second `q_` for a question that already exists, on
   re-invocation.
3. Never delete a question, and never change an existing question's
   `status` — `exhaustive_declared` and `resolved` belong to other skills.
4. Do not spawn a question merely to corroborate or upgrade the tier of an
   objective part already `resolved` at a defensible tier (`probable` or
   better) — Step 1b. Does not apply to a still-open independent fact, a
   Priority 1 conflict, or a Priority 6 FAN pivot on an *unproved* question.
5. Priority 3 (`timeline_gap`) fires only when a gap's `severity == "high"`.
6. Priority 5 (pedigree gap) never fires on a gap belonging to the
   subject's spouse or child.
7. Priority 6 (`fan_pivot`) fires only when all planned direct searches are
   complete and unresolved, or the primary question's
   `exhaustive_declaration.declared == true` — never off one nil result.
8. A FAN question's answer must be evidence *about the objective's
   subject* — not a fact about the associate for its own sake.

## B. The question's content

9. **One question at a time.** At most one new `q_` entry per invocation.
10. A single-fact objective's first question restates the objective with
    identifying detail — never narrowed to a record set.
11. A multi-fact objective decomposes into per-fact questions; the
    multi-fact objective is never written verbatim as one question.
12. The question names the fact sought, never the record that might carry
    it — no "census", "certificate", "probate", "deed", "muster roll" etc.
    in the question text (that's `research-plan`'s decision).
13. A question concerning a relative states, in its rationale, how the
    answer is evidence about the objective's subject — and never targets
    the subject's own spouse or child except on a Priority 6 FAN pivot.
14. When the objective disputes an existing tree assignment, the first
    question **tests** the assignment (confirm-or-refute against
    independent records) — never assumes or confirms it, and never treats
    the questioned tree as evidence for its own conclusion (issue #1471).
15. In interactive mode, before formulating a disputed-assignment question,
    ask the user for (a) the evidence behind their doubt and (b) the
    birth date/place they're working from — unless already supplied in the
    conversation, or running `--autonomous`.
16. `depends_on` names a question only when it must be resolved first, or
    its specific findings are the basis of this question's strategy; a
    first question (no priors) sets `depends_on: []`.
17. `unblocks` names questions this one's resolution would enable/advance.
18. When neither `depends_on` nor `unblocks` applies, both are explicitly
    `[]` — never omitted.
19. A freshly written question's `exhaustive_declaration` is always
    unstarted: `declared: false`, `justification: null`, `log_entry_ids: []`,
    `stop_criteria: null`.
20. `selection_basis` must be the value the Step 2 priority table assigns
    for the priority that fired, and that value must be one the schema's
    closed `selection_basis` enum actually contains.

## C. Presentation

21. Never report only the id — give the full question text, the rationale,
    and what it depends on/unblocks, naming other questions by their text
    (not id alone).
22. The next step is offered in plain language, never by naming a skill.

## D. Ownership

23. This skill writes only `research.json` `questions[]`, via
    `research_append`. No other section, no `tree.gedcomx.json` write.
