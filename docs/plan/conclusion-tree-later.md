# Conclusion tree — routing, researcher statements and other follow-ons, at intent only

> **Status:** NOT BUILT. **Do not build from this file.** Each part gets its own detailed pass
> after the stage of [`conclusion-tree.md`](conclusion-tree.md) it depends on has landed. This file
> records what and why, with acceptance criteria and nothing else. Written 2026-10-06 from issue
> #3032's deep dive.

## What the core plan leaves for these parts

- **Binding.** The conclusion tree, with mandatory claims that `research_append` checks; owed
  findings computed by the engine (`project_context.owedFindings`); completion warns while a
  blocking item is owed; gps-mentor off the default research path (issue #2951); no FamilySearch
  upload; a bounded request ends at its deliverable (PR #3147, PR #3187).
- **Where conclusions happen.** 29 of 48 hosted sessions stated an answer and 7 wrote a proof
  summary; 22 stated answers only in chat. 9 of 44 hosted projects have any `pe_` link. Recording
  one answer takes about 13 minutes on the light path (record-extraction, then proof-conclusion)
  and about 19 on the full one (person-evidence as well).
  - Population: the production feedback bundles read 2026-10-06, 148 zips deduplicated to 138
    bundles in 77 project folders. 72 of those carry project files (44 hosted, 28 Cowork), and 48
    hosted sessions have a transcript. Most predate continuous work (PR #2870, 2026-09-27).
  - Timings: medians of hosted subagent spans, first tool call to last, so lower bounds:
    record-extractor 5.4 minutes, proof-conclusion 7.7, person-evidence 5.7. They are hosted-only;
    e2e runs are faster.
- **What to expect.** With everything here, concluded tree objects reach about 6–7 of 44 hosted
  projects, because links are rare there. The gains are recorded findings, and Cowork, where 21 of
  28 projects are linked.

## Part 1 — routing to owed findings (decided; after Stage 1b; the resume line after Stage 2)

The steering this part adds acts only at a stop or a resume; the router's own order (search the
plan, extract, link, conflicts, exhaustiveness) stays in charge while a job runs, and Stage 1b's
tree-encoding gate, which sends an `encode` item back to proof-conclusion when it returns, is
unchanged.
- `CONTINUE_REASON` (`apps/server/app/agent/continue_policy.py`) points at the first owed item that
  is not advisory, in the engine's order: extract, then conclude, hypothesis and encode. The literal in
  `eval/harness/e2e/orchestrator.py`'s `stop_hook` changes in the same PR
  (`apps/server/tests/test_continue_policy_parity.py`). U24 in
  [`familysearch-handoff.md`](familysearch-handoff.md) is re-deciding the same text, and
  [`single-asks-router-batch.md`](single-asks-router-batch.md) quotes it too. If U24 has landed by
  then, this is its own PR after Stage 1b, editing the text U24 settled; U24 does not wait for it.
- No new routing row in `packages/engine/plugin/skills/research/SKILL.md`.
- project-status leads a resumed project with its first owed item that is not advisory, in plain words. This is
  Cowork's lever: 10 deeply linked Cowork projects ended with no proof.
- After an unrecorded answer about a project person, the agent offers in one line to save it as a
  finding. On yes, the light path runs and the finding may stand at `possible`. `DELIVERY_GUIDANCE`
  lists the save as a bounded deliverable. When no question matches, proof-conclusion appends one
  in the same batch, exempt from `newQuestionWhileSearchInFlightInvariants`.
- **Decided (2026-10-07): no hosted "Save as finding" button.** The one-line chat offer does the
  same work with no UI. Revisit if fewer than 10 of the 20 sessions in the acceptance check below
  end with the answer recorded.

*Acceptance:*
- A resumed project with an owed finding works it before a new search, and Stage 1b's research
  must-not case ("a live job with plan items left keeps searching") still passes.
- Of the first 20 hosted sessions afterwards that state an answer about a project person without
  recording it, the agent makes the offer in at least 18, and every accepted offer ends with the
  answer recorded at some tier. The report gives offers made, accepted, declined and recorded.
- Of the first 10 feedback bundles from resumed Cowork projects holding an owed item that is not
  advisory, at least 7 show it worked. If 10 have not arrived within 60 days of the PR's merge, the
  Cowork arm is reported unmeasured.

## Part 2 — researcher statements (decided: an authored source; after Stage 3 merges, with rule T in warn mode; Stage 3b, rule T's refusal with tree-edit's re-run, follows this part as its own PR)

What a researcher tells the agent ("my grandmother was born in 1880", "that is not my Adam") is
recorded as evidence that never counts as proof on its own.
- A statement is a research source with `repository: "researcher"` and
  `source_classification: "authored"`, quoting the researcher with the date. record-extractor
  writes it through `extraction_append`, which already owns sources and assertions, so no agent
  gains a tool. Statements are detected by the source's repository, because
  `informant_proximity: "researcher"` already marks negative evidence.
- The research skill routes a fact or decision the researcher states about a project person to
  record-extraction as a statement.
- A statement-only citation never grounds `probable`, in either polarity, and a fact claim at
  `probable` or better whose value only a statement carries stands at `possible`.
- Rule T admits an object sourced only to researcher statements; it reads "from you, not yet
  checked". tree-edit writes it at the user's request. This adds a fourth kind of tree object to
  the core plan's model and a label to its Decision 6.
- `repository_recommended` gains `"researcher"` (an open enum, so `CLOSED_ENUMS` is unchanged), and
  the validator requires a `"researcher"` source to be `authored`.
- Each statement costs a record-extractor run (hosted median 5.4 minutes), and person-evidence (5.7)
  to reach a person's found-in-records view.
- If `ut_record_extraction_g4k` still carries its xfail marker (Stage 3 deletes it unless issue
  #2484 lands first), this part's record-extraction run clears it, per rule 10.
- Issue #2069, deleting `known_holdings`, is decided separately; this needs `known_holdings`
  neither way.

*Acceptance:* a statement made in a hosted session becomes a researcher-source assertion that
reads "from you, not yet checked" and never reads likely on its own. A claim citing it beside a
census that links the person stays at `possible` unless a record carries the value.

## Part 3 — the hosted delivery check (decided: hold)

A check on `research_delivered` that refuses to end a bounded turn until its answer is recorded.
It is held because it puts the 13–19 minute recording tail back on bounded asks; issue #2921's
tester asked "Why is it building a tree when I simply asked it to help me find a christening
record?".

*Revisit when* the light path's median, measured as the 13 minutes was (hosted subagent spans,
first tool call to last), is at or below 5 minutes over 20 hosted sessions.

## Part 4 — typed question targets (decided: deferred)

Issue #3213, with its trigger (the core plan's Decision 35).

## What this does not do, in any part

No engine-drafted claims, no conclude-time projection, no recording tail forced on bounded asks,
and no FamilySearch upload.
