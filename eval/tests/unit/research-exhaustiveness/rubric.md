# Research Exhaustiveness Rubric

Grading dimensions for research-exhaustiveness unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Tool Arguments — this rubric owns the wiki_read fixture case

**A `fixture_not_found` on a `wiki_read` for a page beyond the single one this
test stocks is a gap in the test's fixtures, not a Tool Arguments defect. When
the calls that DID match a fixture — above all `{State}_Vital_Records` or
`{Country}_Civil_Registration`, the one page `## 1. Gather evidence` actually
names — carry correct arguments, score Tool Arguments exactly 3. Not 2. A
`fixture_not_found` of this kind contributes nothing to the score, so it cannot
be the reason for a deduction of any size.**

**Do not split the difference.** Partial is a deduction. If the only blemish is a
sibling-page fixture miss, there is nothing to deduct for, and quoting this
override while settling one band down is the failure mode this section exists to
prevent — the `search-records` equivalent records three judges doing exactly
that.

This overrides the global "Critical: Tool Usage Errors" rule for this one case,
under that prompt's own provision for a skill's rubric to claim a dimension and
be deferred to.

**Why it exists.** #2257 made a `wiki_read` an unconditional member of
`## 1. Gather evidence`, and `test_fetches_registration_start_date` fails any run
that omits it. But each test stocks exactly one wiki fixture, so a run that
reaches past that page for a plausible sibling is penalised for making the class
of call the suite now requires. Observed on
`tentative-value-alternative-record-gate` in `v1_2026-09-10_14-33-15`: three
`wiki_read` calls, the instructed `Iowa_Vital_Records` matched, `Iowa_Marriage_Records`
and `Iowa_Census_Records` missed, and the judge scored 2 while naming the
instructed call correct.

**Scope this narrowly.** It covers a plausible sibling wiki page for the same
jurisdiction — a record-type page a researcher would reach for next. It does not
cover a malformed URL, the wrong jurisdiction, a tool the agent holds no grant
for, or a `fixture_not_found` on any tool other than `wiki_read`. Those remain
Tool Arguments defects under the global rule.

**Wording alone has not held elsewhere — prefer stocking.**
`eval/tests/unit/search-records/rubric.md` strengthened its equivalent paragraph
twice and judges still scored 2 three times; it now concludes "do not reword this
section again … stock its nil." Treat this section as mitigation, not a
guarantee. If a sibling-page miss recurs here, stock a narrow nil fixture for
that specific page rather than rewording this, or tighten the agent body so the
speculative call is not made.

## Gate reasoning

Did the skill work the 7-point stop criteria as a gate — in order, stopping at the first that fails, and naming it? An exhaustive declaration must be defensible against the criteria, not asserted unilaterally.

This dimension grades the **decision**; `Stop criteria coverage` grades the **content** of each assessment. A run can name the blocking criterion correctly here and still score partial there for saying nothing substantive about it.

- **pass:** The skill evaluates the criteria against the project's log/assertions and either declares only when all seven are met, or declines naming the specific criterion that blocks and the gap under it (e.g., "probate records not yet searched" under `repository_breadth`). The reasoning is grounded in actual log entries, not generic claims.
- **partial:** The skill applies most criteria but glosses over one or two (e.g., asserts "all record types searched" without naming them), or declines naming a gap without tying it to a criterion.
- **fail:** The skill declares exhaustive without applying the criteria, declares without grounding in log entries, or declines without naming what's missing.

## Declaration honesty

Did the skill resist the temptation to declare exhaustive prematurely? An honest "not yet" is a passing outcome — inflated exhaustiveness to make the project look done is a failure.

- **pass:** When record types known to exist for the jurisdiction/period haven't been searched, the skill keeps `declared: false` and lists the gaps. When the user wants to stop early for resource reasons, the skill records `declared: false` with the honest justification, not a workaround that flips it to true.
- **partial:** The skill identifies the gaps but the wording leans optimistic ("substantially exhaustive," "good enough"), or declares true when one criterion is weak but not failed.
- **fail:** Declares `declared: true` with known gaps, or buries the gaps in justification text while flipping the flag.

## Stop criteria coverage

Are the 7 stop criteria assessed with **substance** — each tied to specific project state rather than merely asserted? N/A when the run refuses before evaluating — ANY precondition (classification, identity links, tentative values, an in-flight plan item), or an already-declared question. A decline at a precondition is not a thin assessment; it is a run that never reached the criteria.

**Grade the content, not the presence.** That the seven keys exist at all on a declaring run is asserted deterministically by `test_declared_has_full_stop_criteria` in the skill's validator, so do not spend this dimension on it — a validator names a missing key in one line, where a judge gives an opinion that moves between runs. What only a reader can judge is whether each assessment says anything: "Census, vital records and probate all searched" is an assessment, "Yes" is not. That distinction applies on both paths — as object values when the run declares, as named prose when it declines. An earlier revision narrowed this dimension to the declining path and so left a declaration with seven one-word criteria graded by nothing at all.

**A decline carries all seven, honestly assessed.** The verdict stops at the first criterion that fails; the record does not. Each of the seven says what was met, what failed, or what the evidence could not reach — "For the mother: zero sources" is an honest assessment, not a gap in the write. `justification` names the blocking criterion.

**A claim of work that did not happen is the failure this dimension catches.** "No conflicts exist" on `conflict_resolution` when the conflicts were never examined, or "all repositories searched" against a log that names three, is the write asserting research it did not do — and the stored declaration is what a later reader trusts. An honest negative is the opposite of this failure: "zero sources bear on the mother" is grounded and correct. Judge each of the seven on whether its assessment is answerable from project state, never on how confident it sounds.

- **pass:** All seven criteria (`goal_alignment`, `repository_breadth`, `original_substitution`, `independent_verification`, `evidence_class`, `conflict_resolution`, `overturn_risk`) carry a 1–2 sentence assessment tied to a specific log entry or assertion. On a decline the same seven are present and honest about what failed or was never reached, and `justification` names the blocking criterion.
- **partial:** All seven are present but at least one is generic boilerplate ("yes" with no specifics); or, on a decline, the blocking criterion is named with substance but the other six are absent or generic. Issue #1843 rules that a decline owes only the blocking entry, so recording just that entry is **partial**, not a fail — all seven is the preferred shape, not the minimum.
- **fail:** When declaring, any of the seven is missing. Either way, the assessments are all generic without reference to project state, or any criterion asserts research the log does not support. On a decline, no blocking criterion is named, or one is named with no assessment at all.
