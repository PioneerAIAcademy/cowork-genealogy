# hypothesis-tracking — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/hypothesis-tracking/SKILL.md` and
`references/hypothesis-gps-guidance.md` as this PR leaves them (issue #1644,
which also lands the `supported`-gate widening — rule 7 below is stated in its
post-fix form). Every line is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`, `output.file_changes`) or by a
mechanical scan of `research.json`'s `hypotheses[]`/`conflicts[]` diff.

Judgement calls ("is this claim specific enough", "does this evidence really
bear on the hypothesis") are deliberately excluded — they belong to the judge.

**Save this file. The next auditor of `hypothesis-tracking` starts here instead
of rebuilding it.**

---

## A. Scope gate (before any file read)

1. "Resolve this conflict / weigh these assertions / choose between / which is
   correct" → decline, name **conflict-resolution**, and produce **no other
   output** — no file reads, no tool calls, no analysis.
2. "Build/create a timeline" → decline, name **timeline**, same "no other
   output" rule.
3. "Write a proof / proof conclusion / write the conclusion" → decline, name
   **proof-conclusion**, same rule.
4. Anything about creating, updating, reviewing, or tracking hypotheses is
   in scope; proceed.

## B. Writes

5. Every write to `hypotheses` goes through `research_append` — no direct
   file edits.
6. On `{ ok: false, errors }` from `research_append`, surface the errors and
   fix the input; never retry blindly with the same payload.
7. `validate_research_schema` is called at the end of **every** interaction,
   including a read-only review that wrote nothing.
8. **Read-only detection.** A request for a summary, review, or status check
   with no requested change writes nothing to `research.json` or
   `tree.gedcomx.json` — issues are named in the text response only.
9. `references/hypothesis-gps-guidance.md` is read before creating or
   evaluating any hypothesis.

## C. Creation

10. A new hypothesis always starts `status: "active"`, even when existing
    evidence already strongly favors it.
11. A hypothesis sourced from a compiled source (family tree, published
    narrative) is flagged in its notes as a lead needing verification.

## D. Status transitions

12. `supported` requires ALL of: every `conflicts[]` entry whose
    `competing_assertion_ids` overlap this hypothesis's `supporting_assertion_ids`
    or `contradicting_assertion_ids` has `status` of `resolved` or `moot`; either
    one supporting assertion carries `evidence_type: "direct"` or at least two
    carry `evidence_type: "indirect"` citing at least two distinct `source_id`
    values; and no logical/geographic impossibility.
13. Never downgrade `supported` → `active` for a minor discrepancy (e.g., a
    census age-rounding gap of a few years). Adding a new contradicting
    assertion does not by itself force a downgrade.
14. `ruled_out` requires ANY of: affirmative refutation (e.g., a will that
    excludes the candidate), exhaustive elimination, or a chronological/
    biological impossibility.
15. On a non-read-only turn, an impossibility already visible in the project
    state is acted on immediately — not deferred to conflict-resolution, not
    hedged on a `person_evidence` link rated `confident` (`match_score >= 0.80`).
16. `ruled_out_reason` is populated whenever `ruled_out: true`, and states the
    affirmative refutation — never a bare "insufficient evidence."

## E. Scope discipline

17. Only the hypothesis (or hypotheses) the user asked about are modified in
    that turn. A different hypothesis's status is never changed, even when its
    own notes or a related assertion make the correct status obvious — that
    observation goes in the text response, not into a write.
18. `conflicts` is never modified by this skill.
19. `questions` is never modified by this skill; `related_question_ids` on a
    new hypothesis is `[]` when no question exists yet.
20. `tree.gedcomx.json` is never modified by this skill.

## F. Evidence linkage

21. Every assertion that conflicts with a hypothesis is recorded in
    `contradicting_assertion_ids` — recorded first, resolved later via
    conflict-resolution. It is never omitted because the researcher expects to
    explain it away.

## G. Re-invocation

22. Updating an existing hypothesis about the same claim happens in place (or
    via `superseded_by`); a second `h_` entry for the same claim is never
    created.
