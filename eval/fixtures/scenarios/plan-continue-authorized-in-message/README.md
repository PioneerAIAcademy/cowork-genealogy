# plan-continue-authorized-in-message

Bridget Halloran (widow, remarried) research, first plan for q_001. Reuses
`flynn-first-plan-surveyed`'s place (Schuylkill County, Pennsylvania) and its
`localities` entry verbatim — the place is infrastructure, not the substance
under test, so it is deliberately not a fresh jurisdiction.

- **Objective:** Identify the other children of Bridget Halloran and her
  first husband, John Doyle, beyond the one already found (Ellen Doyle).
- **Questions:** q_001 (in `open` status, **no plan yet**).
- **Plans:** none — `plans: []`. This is the FIRST plan for the question.
- **Log:** 3 ad-hoc entries (`plan_item_id: null`) — two marriage records
  found incidentally (Bridget's 2nd marriage; Ellen Doyle's own marriage,
  which names her father as John Doyle) and one census image read showing
  Bridget bore ~9 children with only 2 living, of whom only Ellen is
  identified — establishing the pedigree gap the question targets.
- **GedcomX persons:** I1 (Bridget Halloran), I2 (John Doyle, first
  husband), I3 (Ellen Doyle, known child).

## Source and scrub note

Carved from a real alpha feedback case (`feedback-2026-07-30T19-02-08-659Z.zip`,
referenced by issue #1319) where the tester had to ask twice — "run the
record-plan now **and continue with exhaustive research**" — before the
agent proceeded past presenting the plan. **This is a from-scratch
reconstruction, not an edited copy of the real file**: the real case
involved a private individual's actual family history (real names, a real
FamilySearch person ID, exact dates), so rather than editing that document
in place and risking a missed scrub spot, this scenario re-derives the same
essential shape — a widow, multiple marriages found ad hoc, one known child,
census evidence implying several more unfound — with entirely invented
names (Halloran/Doyle/Kearney), no real FamilySearch identifiers, and
decade-level dates only. The plan-content specifics (which record types a
sound first plan should include) are **not** the point of this scenario —
see `flynn-first-plan-surveyed` and its sibling tests for that. This
scenario exists to test what happens **after** the plan is written, when
the invoking message already authorized execution.

**First-cut caveat — verify before committing:** confirm the three log
entries plausibly justify writing a first plan for q_001 without also
requiring a locality survey (the `localities` entry is pre-seeded, matching
the "surveyed" convention) — if not, adjust or drop entries.

**Second correction (2026-08-06):** the test's `judge_context` originally carved
out a "scope limit" for a real baseline-run finding — `Skill('search-records')`
reporting `record_search` unavailable, because this harness's per-test tool
allowlist is computed from the tested skill's own `allowed-tools` only
(`eval/harness/harness/allowed_tools.py::compute_allowed_tools`) and does not
extend to a callee invoked via `Skill(...)`. `ut_search_records_018` already
has the correct, documented answer to this exact problem —
`execution.stub_skills` — so this test now uses that instead of a judge_context
workaround: `Skill('search-records')` is stubbed to a canned confirmation that
execution proceeded, removing the harness artifact from the transcript
entirely rather than asking the judge to reason around it.

## Used by

- `research-plan` tests where the invoking message combines a plan request
  with an execute/continue-authorization phrase in the same turn (e.g. "...
  and start executing it as soon as it's ready", "... and continue with
  exhaustive research") — the skill must hand off to execution rather than
  stopping to ask "Would you like me to start executing this plan?"
