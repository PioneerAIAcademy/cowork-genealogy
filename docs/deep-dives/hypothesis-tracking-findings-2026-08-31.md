# Deep dive: hypothesis-tracking — findings and validator requests

Issue #1644. Guide followed: `docs/skill-deep-dive-guide.md`.
Prohibition list: [`hypothesis-tracking-prohibition-list.md`](./hypothesis-tracking-prohibition-list.md).

**Corpus read:** all five committed run logs,
`eval/runlogs/unit/hypothesis-tracking/v1_2026-07-19_03-22-09.json` through
`v1_2026-08-23_19-10-10.json` — 70 test-runs across a suite that grew from 11
tests to 16 over that span — plus every `.ann.json` beside them.
`text_response`, `tool_calls` and `file_changes` were read for every run in the
newest log before any score, per Step 2. **All 16 tests pass clean in the
newest run**, so per Step 3 the whole suite is a quiet pass and got most of the
time.

**The grep the issue prescribed returns 2 files, as stated:**
`ut_hypothesis_tracking_011.json` and `ut_hypothesis_tracking_012.json`. Both
read clean, not leaky. `_011`'s branches ("refuse outright" vs. "partially push
back but still change the status") both name a `score 1`/`score 2` outcome the
skill could actually produce — its transcript shows an outright refusal that
also performs the *correct* alternative write (ruling out h_002), which the
`judge_context` explicitly anticipates as acceptable. `_012`'s branches are
about *why* h_001 stays `supported`, not about whether it does, and its own
justification is the piece this PR rewrites (see F1) — the branch shape itself
was sound, its content was about to go stale.

**Dimensions that never discriminate — worse than the issue's headline number,
measured across all 70 recorded test-runs in the five-log corpus:**

| dimension | scores ever seen | n |
|---|---|---|
| base / **Tool Arguments** | `3` or `null` only | 70 |
| rubric / **Claim clarity** | `3` or `null` only | 70 |
| rubric / **Evidence linkage** | `3` only | 70 |
| rubric / **Status transitions** | `3` only | 70 |
| base / **Correctness** | `3` (68), `2` (1), `1` (1) | 70 |
| base / **Completeness** | `3` (68), `2` (1), `1` (1) | 70 |

**The single most important number in this dive: of 70 test-runs ever
committed, 68 scored a flat `3` on every dimension the run produced, and the
other 2 are the *same* test** (`ut_hypothesis_tracking_014`, a near-miss
routing test whose empty `text_response` the base judge scores 1/1 by design —
the harness overrides its `test.outcome` to `pass` because it correctly
delegated via the `Skill` tool, exactly as `eval/CLAUDE.md`'s
`routing_negative_judge_fail` advisory describes). **No graded instance of
actual skill behavior has ever scored anything but a perfect 3 across five
committed run logs and three suite expansions.** `Status transitions` and
`Evidence linkage` — the two dimensions this repair most needs to be able to
fail — have *never* taken a value other than 3, not even once, in 70 runs.
That is the real reason a live defect (the `supported` gate below) sat in a
green suite for as long as it did: the suite could not have shown red for it,
because nothing in the corpus ever asked it to.

---

## F1 — The `supported` gate could not be satisfied by an indirect-only proof, and nothing in the suite could show that

**This finding is not new to this dive — it is the known defect merged in from
issue #1709, and it is why this issue exists.** Recorded here in the dive's
own Did/Should/Gap form because it is this dive's central finding, and because
the guide asks every finding to be written this way regardless of where it was
first noticed.

**Did:** `SKILL.md:129-134` (pre-fix) required "at least one line of direct
evidence" for `supported`, with no path for a hypothesis resting entirely on
correlated indirect evidence. Demonstrated live in the `stribling-father-1821`
debug run (issue #1413): the agent assembled a guardianship bond, a mother's
remarriage, a prior marriage and four equal co-heir shares, reasoned about them
correctly, and held the hypothesis at `active` citing this exact rule.

**Should:** the skill's own reference,
`references/hypothesis-gps-guidance.md:64-68` — "Do not privilege direct
evidence and dismiss indirect or negative evidence" — and BCG Standard 40's
"seek all three evidence types," neither of which the old gate honored for the
one status transition that matters most.

**Gap:** lane 4 (core doctrine) — the one finding in this dive that earns a
body change, and only because the rule was *absent for the case*, not ignored
(the search-wikipedia dive's F9/F7 distinction applies identically here). The
lead's ruling (recorded in the issue body, 2026-08-31) replaces the gate with a
mechanical floor: no unresolved conflict naming the hypothesis's linked
assertions, and either one direct supporting assertion or two indirect ones
citing two distinct `source_id`s. Two narrower fixes were considered and
rejected by the lead — documenting the assertions-only route without touching
the gate (leaves the standard form of an indirect proof permanently
unpromotable), and relaxing the gate to "a correlated set that survived
conflict-resolution" (every term is a judgment call, so nothing could check
it). The lead named seven sites; **five are landed here**:
`SKILL.md` (gate + flow diagram), `research-schema-spec.md` §5.9,
`rubric.md`'s Status transitions dimension, and
`ut_hypothesis_tracking_012.json`'s `judge_context` (justification only — the
verdict was already right).

**Two of the seven are deliberately not touched in this PR:**
`skill-deep-dive-guide.md`'s canonical example (line 171) and
`gps-research-flow.md`'s "Tracking hypotheses" paragraph. Both live outside
this skill's own directory — one is the process doc every future deep dive
reads, the other is the architecture-level doctrine doc every new reader is
sent to — and whether a genealogist deep dive on one skill should edit
cross-cutting docs like these is not this dive's call to make unilaterally.
Left as-is pending that decision; both still describe the pre-fix rule until
someone makes it, which is a known, named gap rather than a silent one.

**Independently re-verified rather than trusted:** grepped the whole repo for
the old rule's literal phrasing ("at least one.*direct", "direct evidence.*
support") — it appears only at the two sites the lead named plus the
deep-dive-guide's own worked example, nowhere else. `proof-conclusion.md` and
both cited spots in `project-status`'s files key only on the bare `"supported"`
string and never restate the criteria, confirmed by direct read rather than by
trusting the issue's "checked, no edit" list. `validator.ts` was independently
read end to end for the `hypotheses[]` block: it enforces only shape, enum
membership, and `ruled_out_reason`'s conditional requirement — **no
cross-field rule about evidence type or conflict status exists server-side
today**, which is exactly the `nothing-checks` gap the required validator
request (V1, below) closes.

---

## F2 — No test in the corpus has ever exercised a live promotion to `supported`, direct or indirect

**Did:** every status-transition test in the suite covers *refusing* a wrong
promotion (`_011`) or downgrade (`_012`), or moving a hypothesis to
`ruled_out` (`_004`, `_009`, `_011`). Mechanically confirmed by scanning every
`file_changes` diff across all five committed run logs (`hypotheses[].added`
and `.modified`, all 70 runs): **not one ever sets a hypothesis's `status` to
`supported`.** Every fixture that has a `supported` hypothesis (`mid-research-
flynn` and its siblings) starts it that way; no test ever asks the skill to
*decide* the promotion. This is a strict superset of the issue's own
observation ("no test where an indirect-only argument is the subject") — there
is no promotion test of any evidentiary shape.

**Should:** the guide's own Step 6 shape — "a cross-field rule that must
always hold" — exists precisely so a rule like this one gets exercised, and a
rule that is never exercised by any test cannot regress visibly, which is
consistent with the "single most important number" above: `Status transitions`
has scored 3 in all 64 of its non-null evaluations because nothing in the
corpus has ever put it in a position to do otherwise for this transition.

**Gap:** lane 2 (grading defect — a corpus gap, not a skill defect). Fixed by
a new positive test, `ut_hypothesis_tracking_017.json`
("Promote hypothesis to supported on two indirect assertions from distinct
sources"), reusing the existing `flynn-plan-in-progress` fixture rather than
authoring a new one — it already has `h_001` at `active` with exactly two
indirect supporting assertions (`a_004`, `a_010`) from two distinct sources
(`src_001`, `src_003`), no direct evidence, and its one conflict (`c_001`) is
already `resolved` and does not name any of `h_001`'s assertions. Under the
new gate this clears the floor and the correct behavior is to promote; under
the old gate the correct behavior was to refuse for lack of direct evidence.
This is the one case in the new suite that can actually go red if the old rule
regresses back in.

---

## Checked, and it holds — recorded because the check is what makes the fix trustworthy

Three claims worth stating as measured rather than assumed, because a skill
that writes to a shared `research.json` is exactly the kind of surface where
"nothing has gone wrong yet" quietly substitutes for "nothing can go wrong":

- **Rules 18–20 (never touch `conflicts`, `questions`, or `tree.gedcomx.json`)
  — zero violations across all 80 test-executions in the five-log corpus**
  (mechanical scan of every `file_changes[file].sections_modified` entry and
  every top-level file key). This one already has a generic enforcement
  mechanism — `test_ownership_table`/`test_tree_ownership_table`, see V2
  below — so unlike V1 this was confirmation of an existing guard, not a gap.
- **Scope discipline (rule 17) is genuinely exercised, not merely claimed.**
  `ut_hypothesis_tracking_008` and `_010` each notice a real, correct fix on a
  *different* hypothesis (`h_002`'s missing chronological-impossibility link)
  mid-response and explicitly decline to make it, deferring to the user — the
  textbook case the rule exists for, not a hypothetical.
- **Full routing reciprocity exists for all three Step-0 diversions.**
  `eval/tests/unit/{conflict-resolution,timeline,proof-conclusion}/negative-
  hypothesis-tracking.json` each pair against this skill's own near-miss
  tests (`_014`–`_016`). `check_negative_reciprocity.py` reports zero
  unreciprocated edges touching hypothesis-tracking, and
  `check_rubric_tool_drift.py` reports zero drift hits for this skill (its
  rubric and every `judge_context` mention only `research_append` and
  `validate_research_schema`, both of which are in `allowed-tools`).

No tool defect was found (`research_append` and `validate_research_schema` are
the only two tools this skill calls, and neither's contract is implicated).
No record-type craft gap applies — this skill has no record-type-specific
logic. Lanes 1 and 3 are empty by construction, same as the search-wikipedia
dive found for the same structural reason (a narrow-tool skill has nowhere for
those lanes to live).

---

## Lanes, at a glance

| # | Finding | Lane | State |
|---|---|---|---|
| F1 | `supported` gate rejects a valid indirect-only proof | **4** | fixed, 7 sites |
| F2 | no test ever exercises a live promotion to `supported` | 2 | fixed (new test, existing fixture) |
| — | conflicts/questions/tree.gedcomx.json isolation | — | checked clean, validator requested anyway (V2) |
| — | scope discipline | — | checked clean, no action |
| — | routing reciprocity | — | checked clean, no action |

---

## Validators

**Written directly in this PR rather than handed off as a separate issue** —
the lead's call, overriding the guide's default (file a validator request and
let a developer write it). Both candidates were checked against what already
exists before writing anything new.

> **V1 — the `supported` mechanical floor. Implemented.**
> **Rule:** if a hypothesis's `status` is `supported` in the after-state, then
> (a) every `conflicts[]` entry whose `competing_assertion_ids` overlap that
> hypothesis's `supporting_assertion_ids` or `contradicting_assertion_ids` has
> `status` of `resolved` or `moot`, AND (b) either at least one supporting
> assertion has `evidence_type: "direct"`, or at least two have
> `evidence_type: "indirect"` and cite at least two distinct `source_id`
> values. One-directional only — the converse (clearing the floor but staying
> `active`) is not a violation; the third gate condition (evidence
> consistency) is a judgment call this validator does not attempt.
> **Where to look:** the hypothesis's after-state fields, matched against
> `research.json`'s `conflicts[]` and `assertions[]` in the same after-state.
> **Why it is not judgment:** `evidence_type`, `source_id`, and
> `conflicts[].status` are all closed, schema-required fields already in the
> file.
> **What a violation looks like:** `eval/fixtures/scenarios/flynn-unresolved-
> conflict/research.json` is the fixture that separates "match by assertion"
> from the wrong "match by question" implementation — `h_001` is `supported`
> with `a_004`/`a_010`/`a_013`, while `c_001` is `unresolved` and blocks the
> same question (`q_001`) but names entirely different assertions
> (`a_002`/`a_009`/`a_012`). Matching by question would flag this shipped,
> correct fixture as a violation.
> **Implemented as** `test_supported_requires_evidence_floor` in
> `eval/harness/validators/test_hypothesis_tracking.py`, proven against 11
> hand-built cases in `eval/harness/tests/unit/test_hypothesis_tracking_
> validator.py` (`uv run pytest`, all pass) — including the exact
> `flynn-unresolved-conflict` shape above, both same-source and single-
> assertion indirect rejections, `resolved`/`moot` acceptance, and a
> non-`supported` hypothesis being ignored entirely. Verified before writing
> that it does not break any existing fixture: walked every scenario used by
> this skill's own test corpus (`mid-research-flynn`, `flynn-multi-conflict`,
> `flynn-competing-fathers`, `flynn-one-life`, `flynn-exhaustive-ready`,
> `flynn-plan-in-progress`) — every `supported` hypothesis in all of them
> already clears the floor.

> **V2 — "never writes `conflicts`, `questions`, or `tree.gedcomx.json`".
> Not needed — already enforced.**
> Checked before writing anything: `test_ownership_table` and
> `test_tree_ownership_table` in `eval/harness/validators/test_universal.py`
> already enforce exactly this, generically, for every skill — driven by
> `docs/specs/schemas/ownership.json`. Confirmed `hypothesis-tracking` is
> correctly absent from every `conflicts`, `questions`, and
> `tree.gedcomx.json` row's `callers` list, so a write to any of them by this
> skill already fails `test_ownership_table`/`test_tree_ownership_table`
> today. My original proposal (in an earlier draft of this dive, before it was
> checked against the harness) would have been a dead-code duplicate of an
> existing universal guard. Recorded here so the next auditor doesn't re-derive
> and re-propose it.

---

## Fixes made in this PR

**Skill body** (`packages/engine/plugin/skills/hypothesis-tracking/SKILL.md`) —
the `supported` gate and its flow diagram (F1).

**Docs** — `docs/specs/research-schema-spec.md` §5.9, restated to the new gate
(F1). `docs/skill-deep-dive-guide.md`'s worked example and
`docs/gps-research-flow.md`'s "Tracking hypotheses" paragraph are **not**
touched here — see F1's handback note above.

**Tests** (`eval/tests/unit/hypothesis-tracking/`) —
`rubric.md`'s Status transitions dimension rewritten to the new floor (F1);
`ut_hypothesis_tracking_012.json`'s `judge_context` entries 1–2 rewritten so
the stated justification no longer says the floor is evidence *type alone*
(F1); new test `ut_hypothesis_tracking_017.json`, reusing the
`flynn-plan-in-progress` fixture, no new fixture authored (F2).

**Validator** (`eval/harness/validators/test_hypothesis_tracking.py`) —
`test_supported_requires_evidence_floor`, new (V1). Proven with 11 hand-built
cases in `eval/harness/tests/unit/test_hypothesis_tracking_validator.py`, all
passing under `uv run pytest`. `ruff check` clean on both files.

**Prohibition list** — `docs/deep-dives/hypothesis-tracking-prohibition-
list.md`, new.

## Cost

`eval/harness/validators/**` is not part of the run-log snapshot, so the new
validator buys no paid run by itself. What does: one
`make eval-skill SKILL=hypothesis-tracking` run, as the issue budgets (roughly
$8–12, 45–65 minutes) — required regardless, because the skill body, rubric,
and a test file all changed. The suite goes 16 tests → 17. **This run cannot
confirm the fix by itself** — the corpus's own dimension scores have been
flat for 70 runs, so a green run here is the status quo, not evidence; its
job is to confirm `ut_hypothesis_tracking_017` actually exercises the new
floor and comes back a genuine pass rather than an aborted or mis-scored run,
and that the new validator runs clean against the live suite. Annotation is 5
sampled tests per the current policy.

## Handback — not in this diff

1. **`docs/skill-deep-dive-guide.md`'s canonical example and
   `docs/gps-research-flow.md`'s "Tracking hypotheses" paragraph.** Both still
   describe the pre-fix, direct-evidence-only rule. Left untouched — see F1 —
   pending a decision on whether a single-skill deep dive should edit
   cross-cutting docs outside the skill's own directory, or whether that
   belongs to whoever next touches either doc for its own reasons.

Otherwise, nothing. The validator work that would normally be handed off as a
separate developer issue is implemented directly in this PR instead, per the
lead's instruction. No record-type craft gap, no tool defect, and every
"checked and needing no edit" claim in the issue's own ruling was
independently re-verified against the current repo rather than trusted.
