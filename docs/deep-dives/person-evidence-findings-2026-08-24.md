# Deep dive: person-evidence — findings and validator requests

Issue #1646. Base `11c8e2cb`. Release candidate: `v1_2026-08-24_22-05-46` (22 tests,
drift 0, annotated). Findings were read from `v1_2026-08-20_15-53-03` and the

Step 1's output is [`person-evidence-prohibition-list.md`](./person-evidence-prohibition-list.md)
— 36 transcript-checkable rules, of which **11 have a guard and 9 of those are
tag-gated**, so they fire on one or two named tests and are inert on the other
~19. That coverage table is what directed the reading below, and it is the
finding underneath all six: the body is most emphatic exactly where nothing
checks it (household skeleton 8-of-10 unguarded, threshold policy 7-of-10).

**Numbers re-pinned before starting**, per the lead's 2026-08-23 comment. `make
judge-report` gives **1 of 8** non-discriminating dimensions, not the card's
"3 of 9": the flat one is `base/Tool Arguments` (n=17, always 3). A hand count
that treats `N/A` as a value, or that counts the judge's re-cased headings
(`Score discipline (advisory)`) as separate dimensions, gets a different and
wrong answer. `rubric/Score discipline` now varies [1, 3] — it caught n7v.

---

## F1 — The household rubric bar cannot be met by any scenario in the suite, and correct behaviour matches its *partial* wording

**Did:** `merge_warnings` is called **0 times across all 21 tests**.
`ut_person_evidence_021` and `ut_person_evidence_026` — the two household runs
that materialize members and write edges — both skipped the gate and said so, in
the response ("Coherence dry-run via `merge_warnings` is not possible (no
candidateGedcomx — working from pre-extracted assertions)") and in every `pe_`
rationale they wrote. Both scored **3 on all eight dimensions**, including
`Person minting and connecting edges`.

**Should:** `rubric.md`'s **pass** bar read "For a multi-person household, a
`merge_warnings` dry-run coherence gate **is run** over the pre-materialization
set before committing" — unconditionally. Its **partial** bar penalised a run
that "skips the `merge_warnings` gate on a household". The behaviour observed is
the partial bar's wording verbatim.

**Gap:** lane 2, and the bar was unreachable rather than merely strict. SKILL.md
conditions the gate on holding a `candidateGedcomx` "from a prior `record_read`
call", and **`record_read` is not in person-evidence's `allowed-tools`** — the
skill cannot obtain one for itself. Every household scenario is built from
pre-extracted assertions, so in the unit tier the precondition is unsatisfiable
by construction and the pass bar describes a state no run can reach. The judge
scored 3 by ignoring its own rubric and grading the body instead, which is the
right answer arrived at the wrong way — and it means the dimension was reporting
nothing about the gate either way.

**Fixed here.** Both bars now turn on whether a candidate document is in hand,
and a noted skip is explicitly the pass.

## F2 — The suite's one flat dimension is the one a `judge_context` writes the answer for

**Did:** [`patronymic-mismatch-caps-confidence.json`](../../eval/tests/unit/person-evidence/patronymic-mismatch-caps-confidence.json)
carried *"Tool Arguments: score 3 if `same_person` was called with the two
primary ids (subject and candidate persona). If no other tool is needed, that is
sufficient."* Two further tests hand the same dimension a conclusion:
`detect-absent-household-member` ("minting the children and writing the edges is
the expected tool use … no same_person call is required") and
`marriage-parent-persona-unscored`.

**Should:** the issue's own instruction — "Rewrite a hit to name the *dimension*
without writing the finding." This is the worked example's exact shape.

**Gap:** lane 2. `base/Tool Arguments` is the suite's only non-discriminating
dimension (n=17, always 3; +4 N/A), and a third of the tests that exercise it
tell the judge what to conclude. That is not proof of causation, but it is the
one dimension where the corpus supplies the answer and the one dimension that
has never varied.

**Fixed here** on the score-branch hit. The other two are left: neither writes a
score, and both state a genuine fixture fact the judge cannot otherwise know
(that no `same_person` call is owed because the personas are new stubs). Removing
those would make the tests harder, not better.

## F3 — `same_person` is skipped outright, and the dimension that grades it had never once reported it

**Did:** `ut_person_evidence_n7v` on `flynn-marriage-parent-match` — **9 of 9**
assertions carry a non-null `record_persona_id`, `same_person` is never called,
and eleven `pe_` entries land, three of them at `confident` with a null
`match_score`.

**Should:** SKILL.md §2 — "**Score the match with `same_person`** when the
assertion is `record_search`-sourced — i.e. it has a non-null
`record_persona_id`." §3 then makes the score an input to confidence.

**Gap:** the rule is in the body and was ignored, so per the deep-dive guide
restating it is not the fix. Across the five committed run logs before this one
`rubric/Score discipline` took the value **3 on all 73 gradings**; benter-070
measured the underlying skip at roughly **1 in 3 on this one test** (#1646
comment 4). An intermittent compliance failure is what a judge dimension is
worst at catching.

Independently re-derived here, and three apparent skips turned out **not** to be
violations: `ut_person_evidence_011`, `_022` and `_014` each link an assertion
whose own `record_persona_id` is null, even though their scenarios contain
scored personas. Checking the scenario rather than the linked assertion produces
three false findings — worth recording, because that is the obvious way to write
this check wrong.

**Closed by a validator, shipped here** —
`test_same_person_called_when_persona_meets_existing_candidate`. Not tag-gated:
it derives its own precondition (a new `pe_` entry linking a persona with a
non-null `record_persona_id` to a person that was already in the tree) and
stands down otherwise.

## F4 — `check-warnings` is skipped on ~20% of write-runs, on a different test each time

**Did:** across two consecutive runs, **five different tests** finished a write
without invoking `check-warnings`, every one of them scoring 3 on all eight
dimensions in the run where it skipped:

| Run | Skipped it | Of |
|---|---|---|
| `v1_2026-08-20_15-53-03` | `_025`, `_014` | 12 write-runs |
| `v1_2026-08-24_18-17-08` | `_011`, `_002`, `_022` | 13 write-runs |

**Should:** SKILL.md §8 — "After creating links and any stub persons, **invoke
`check-warnings`** on the affected persons to catch genealogical
impossibilities."

**Gap:** the miss is not a property of any test — it moves. That is precisely
what a judge dimension cannot report and a program can. `_014` is the case that
matters most: it mints a brand-new stub person and skips the guard that would
catch that stub carrying an impossible lifespan.

**Closed by a validator, shipped here** — `test_check_warnings_runs_after_a_write`.
It triggers on a new `pe_` entry **or** a newly minted tree person, and stands
down on a read-only audit run and on a negative routing test.

**Correction to this finding as first written.** I recorded F4 as un-shippable,
on the grounds that `skills_invoked` "is not among the fixtures
`validator_runner.run_validators` supplies", and filed #1881 on that basis. That
was wrong, and wrong in an avoidable way: I read `validators/conftest.py`, which
supplies *standalone-pytest* defaults, and never opened `validator_runner.py`,
which has supplied `skills_invoked` from the PreToolUse hook all along.
`test_search_records.py` was already using it, and
`test_tree_edit.py::test_check_warnings_runs_after_any_tree_write` — landed by
deep dive #1657, which arrived in this branch's `main` merge — already asserts
this very rule for the other skill that writes to the tree. The work was one
validator, not a harness change, and #1881 is closed as folded in.

**And a second correction on top of the first**, found by @florencemashipei in
review. I then reported that `conftest.py` "had no `skills_invoked` fixture" and
added one. It had one — added by the search-wikipedia dive (`91723121`) and
present on `main` throughout. Mine was a duplicate, and since the later
definition wins it was dead code from the moment it landed, with a docstring
asserting the opposite of what git shows. Removed. I cannot reconcile that with
the "fixture not found" error I observed and reported at the time, and I am not
going to invent a reason; what is checkable is that the fixture predates this
branch and the addition was never needed. Whole-directory standalone runs remain
broken for older, separate reasons (a missing `test` fixture, and
`validators_lib` not being on the import path); not addressed.

## F5 — A `judge_context` quotes a retired version of §5, and blesses the shape the rubric calls a shortfall

**Did:** `ut_person_evidence_022` created Mary Doyle with
`tree_edit({operation: "add_person", person: {gender, names}})` — a name-only
shell, no facts, no source-ref. It scored **3 on all eight dimensions**,
including `Person minting and connecting edges`, whose **fail** bar reads "Mints
each new person via `materialize_facts` create-or-enrich so it arrives WITH its
sourced fact(s) … not a bare name-only stub" and whose **partial** bar names
"leaves a member a name-only shell (the old stub shape)".

**Should:** the test's own `judge_context` told the judge the opposite — "The
stub should be minimal (gender + a name) … **SKILL.md §5 notes proof-conclusion
populates stub facts later**." §5 has not said that since the
tree-materialization rework; it now says the reverse, by name: "do **not**
hand-build a name-only stub with `tree_edit add_person` … so the new person
arrives WITH its facts, never as a name-only shell that a later step fills in."
The `judge_context` and the rubric actively contradict each other, and
`judge_context` won.

**Gap — and the skill turns out to be right.** Mary Doyle is named only *inside*
the groom's marriage assertion. She has no `record_role` and no name assertion of
her own, so `materialize_facts` has no persona to mint from — and
`materialize-facts.ts`'s `SKIP_TYPES` skips the `marriage` fact_type outright
(`SKIP_TYPES = {relationship, age, marriage}`). `tree_edit add_person` was the
only mechanism available, and §5 prohibited it by name. §7.3's nearest clause
covers only a persona that is *matched*, which she is not. The body had a hole,
and the skill fell into the one action left.

**Fixed here, both halves:** §5 gains the carve-out naming this case as the one
place `tree_edit add_person` is correct, and the `judge_context` is rewritten off
the current doctrine.

## F6 — A matched persona's facts never reach the tree person (the lead's finding, verified)

**Did / Should:** recorded by the lead on #1646, 2026-08-22, and verified against
the body here. `docs/specs/tree-materialization-spec.md` assigns person-evidence
"write the linked persona's assertions as sourced facts/names onto the tree
person" for **every** linked persona. SKILL.md covered it only in §5 (persona
matches **no** existing person) and §7.3 (**multi-person household** record).
**§4 has no materialize instruction**, so the commonest case — a single-person
record matched to someone already in the tree — got a `pe_` link and no facts.

**Gap:** lane 4, and it is not bookkeeping. search-records sources its next
query's name and date parameters off the tree person
(`search-records/SKILL.md`), so the facts that never landed are the ones that
would have sharpened the next search.

**Fixed here** — §4 gains the step, folded in at the lead's suggestion rather
than split out. Covered by a new test, `ut_person_evidence_027`, on the
`mid-research-flynn` death certificate (`src_004`, role `deceased`), whose
`a_011`/`a_012` are unlinked and whose subject is already in the tree — so the
case needed no new fixture. Guarded by
`test_matched_persona_is_materialized_onto_its_person`.

---

## Lane summary

| | Lane | Disposition |
|---|---|---|
| F1 rubric bar unreachable | 2 — grading | fixed (`rubric.md`) |
| F2 score-branch judge_context | 2 — grading | fixed (one test) |
| F3 `same_person` skipped | body rule already present | **validator shipped** |
| F4 `check-warnings` skipped | body rule already present | **validator request** (blocked, below) |
| F5 stale `judge_context` + §5 hole | 2 + 4 | both fixed |
| F6 matched persona not materialized | 4 — doctrine | step added, test added, **validator shipped** |

Two prose edits, both to rules the body did **not** already contain — F5's
carve-out and F6's step. No rule the skill already obeyed was restated.

## Validator requests

**V1 — `same_person` attestation. SHIPPED** as
`test_same_person_called_when_persona_meets_existing_candidate`.

> **Rule:** when a new `person_evidence` entry links an assertion carrying a
> non-null `record_persona_id` to a tree person that existed before the run,
> `same_person` must appear in `tool_calls`.
> **Where to look:** new `person_evidence[]` in the after-state, `assertions[]`
> for `record_persona_id`, the before-state tree for whether the person is new.
> **Why it is not judgment:** all three are recorded fields; nothing needs
> interpreting.
> **What a violation looks like:** `ut_person_evidence_n7v`, run
> `v1_2026-08-20_15-53-03` — 9 of 9 personas scored, zero calls.

**V2 — materialize a matched persona. SHIPPED (tag-gated)** as
`test_matched_persona_is_materialized_onto_its_person`.

> **Rule:** linking a persona whose assertions carry a materializable
> `fact_type` (anything outside `relationship`/`marriage`/`age`) to a
> **pre-existing** tree person requires a `materialize_facts` call naming that
> `personId`.
> **Why tag-gated, and when to ungate:** the rule is universal but the corpus is
> not yet — several existing tests link to an existing person without
> materializing, and an ungated assertion would fail them all in one run. A
> failing validator short-circuits the judge (`_compute_outcome` returns "fail"
> before grading), so ungating today deletes the dimension scores that diagnose
> those tests instead of surfacing the defect. Ungate once they are brought up
> to the rule.

**V3 — `check-warnings` after a write. SHIPPED** as
`test_check_warnings_runs_after_a_write`. (First written up as blocked; the
blocker did not exist — see the correction under F4.)

> **Rule:** a run that creates `person_evidence` entries or mints a tree person
> must invoke the `check-warnings` skill.
> **Where to look:** `output.skills_invoked` against new `person_evidence[]` and
> new `persons[]`.
> **Why it is not judgment:** both sides are recorded lists.
> **What a violation looks like:** `ut_person_evidence_025` and
> `ut_person_evidence_014`, run `v1_2026-08-20_15-53-03` — wrote links (and in
> `_014`'s case minted a stub) with `skills_invoked: ["person-evidence"]`. Both
> scored 3 on every dimension.
> **Why a validator and not the judge:** the miss moves between runs — five
> different tests across two consecutive runs — so no per-test dimension sees a
> pattern, and each skipping run scored 3 on all eight dimensions.
> **Expected cost:** on a run where the skill does skip, this converts that
> test to a validator-driven `fail` and short-circuits its judge. That is the
> intended behaviour, but it means the next run's headline may drop by a test
> or two until compliance is consistent.

## What this dive did not settle

`ut_timeline_008` — an attribution question that should reach person-evidence and
loses to `conflict-resolution`, **3 of 4 failing on `main`**, tracked on #1655.
Narrowing `conflict-resolution`'s description would also touch
`ut_conflict_resolution_003` and `_007`, so it is a decision outside this suite.
Recorded here so the next person does not re-measure it.

The unit tier captures **no tool responses at all** (#1646 comment 4: 284 calls,
0 responses, all 13 tools), so a warn-only guardrail riding `validation.warnings`
on a successful response leaves no trace here. That bears on #1550's
shadow-then-graduate decision rather than on this skill, and is not folded in.

---

## What the verification run established

`v1_2026-08-24_18-17-08` — 22 tests, **15 pass / 5 partial / 2 fail**, $6.89, 0
aborts, 1 transient retry, drift 0 (and still 0 after merging `main`). Baseline
for comparison is `v1_2026-08-20_15-53-03` at 16 / 3 / 2 of 21.

**F6's step works, including where it was not aimed.** `ut_person_evidence_027`
passes both validators and emits exactly the intended call —
`{personId: "I1", recordId: "ark:/61903/1:1:MDEF", recordRole: "deceased"}` —
and surfaces the Ireland-vs-Pennsylvania birthplace as coexisting sourced facts
instead of declining to materialize. The clause also reached
`ut_person_evidence_026`, which was not written for it: its materialize ops now
carry `personId: "I1"` for the matched head-of-household, where the 08-20 run
omitted it entirely.

**F3's validator fires.**
`test_same_person_called_when_persona_meets_existing_candidate` fails on `n7v`
and short-circuits the judge (every dimension `None`). `n7v` was already a
`fail`, so the headline cost is zero and an intermittent miss is now decided by
a program.

**F1's rubric fix is not implicated in the one regression.**
`ut_person_evidence_026` went pass → fail, but the judge graded the
absence-flagging clause — "it failed to detect and flag Catherine's unexplained
absence … only a parenthetical remark" — which this branch did not touch. Two
targeted probes of `_026` on this same branch then **passed 2 for 2** ($1.03),
so the fail is single-run variance, not the step-4 edit and not the rubric
rewrite. Recorded rather than re-run: buying a second full suite to get a
prettier headline is the waste the guide warns about.

### Two findings the run itself produced

**F7 — the skill gets `tree_edit` argument shapes wrong on the first attempt,
and self-corrects at the cost of a round trip.** `base/Tool Arguments`, the
suite's only non-discriminating dimension (n=17, always 3 across five run logs),
**now varies**: `ut_person_evidence_021` passed
`"type": "http://gedcomx.org/ParentChild"` where the tool wants the bare
`ParentChild`, and `ut_person_evidence_022` passed `add_person` with a
`nameForms` structure instead of `given`/`surname`. Both were rejected and
immediately corrected.

To be exact about causation: this is **not** the F2 `judge_context` fix paying
off — that edit was on `_020`, and the judge is per-test. The dimension varies
because the skill made different calls this run. F2 remains worth having on its
own terms, but it earns no credit here.

Both defects convert. **Validator request:** no `tree_edit` op may carry a
`relationship.type` containing `://`, and no `add_person` op may use
`nameForms`; both are closed argument shapes the tool already rejects, so a
validator reading `tool_calls` decides them without judgement, and catches the
wasted round trip that a self-correcting run otherwise hides.

**F8 — `project_context` is called outside `allowed-tools`.** The advisory
"skill called MCP tools not in allowed-tools frontmatter: ['project_context']"
fires on most tests in this run and on none in the 08-20 run. Advisory only
under #1748 (the session grants every tool), but it is H5 on the prohibition
list, and the change between two consecutive runs on nearly the same body is
what makes it worth recording. Either `project_context` belongs in the
frontmatter or the body should stop reaching for it — a question for whoever
owns the #1748 decision, not one to settle here.

## F9 — The judge failed a correct run on two events that never happened

**Did:** `ut_person_evidence_023` on `v1_2026-08-24_22-05-46` was scored
Correctness 1, Confidence calibration 1, Score discipline 1. The judge's stated
reasons: the skill "created a person_evidence entry for a_002 linking it to I1
at 'speculative' confidence", and "called same_person and obtained a score of
0.05". Neither happened. The run's tool calls are `project_context` and
`research_query` ×4; `files_created` is empty; and the response ends *"Autonomous
mode, `speculative` cap → no-link. No `pe_` entry written."* — followed by a
recommendation to persist the rejected identity via hypothesis-tracking, which is
what SKILL.md §3 asks for.

**Should:** the deep-dive guide's own rule, one level up — decide what a run did
from `output.tool_calls` and `output.file_changes`, not from its prose. The judge
graded prose.

**Gap:** lane 2, and the most consequential kind: the skill did the textbook-correct
thing under the autonomous no-link rule and was failed for the opposite. Human
annotation confirms it — the genealogist corrected Correctness and Confidence
calibration **1 → 3** on exactly this reasoning.

**The run's real defects, which the judge missed entirely:**

1. `same_person` was **never called**, though `a_002` carries a
   `record_persona_id` and I1 is an existing tree candidate. Score discipline's
   fail bar names precisely this ("a mandatory score silently skipped"), so the 1
   there is right — for a reason neither the judge nor the annotation comment gives.
2. The response quotes **"Score: 0.71"** as the match score. That value is not
   from `same_person`; it is a **stale figure sitting in the scenario's own
   `results/log_002.json` sidecar** from an earlier logged search. Disclosing an
   unobtained number as the current score is worse than not disclosing one, and
   the disclosure rule (D7) reads as satisfied while being violated.

**Fixed, then reverted, deliberately.** A `judge_context` clause telling the judge
to ground write-claims and score-claims in the call list was written and then
reverted: it is the only edit that flipped the run-log snapshot, and reverting it
kept the completed annotation valid instead of buying a fourth paid run for one
clause. The hallucination is therefore **recorded as calibration data** — two
human 1→3 corrections on the committed run — rather than prevented. The clause is
reproduced here so it can ride whichever run this skill next pays for:

> GROUNDING: decide what the run DID from its tool calls, not from its prose. A
> person_evidence entry exists only if a research_append call created one; if no
> research_append appears in the run, no pe_ entry was written and the skill must
> not be marked down for writing one. Likewise a same_person score was obtained
> only if a same_person call appears.

> A score quoted in the response must come from a same_person call in THIS run.
> The scenario's results/log_002.json sidecar carries a stale 0.71 from an earlier
> logged search; presenting that as the match score is a documentation failure even
> though a number was disclosed, and skipping same_person entirely when a
> record_persona_id meets an existing candidate is a Score discipline failure
> regardless of whether the link decision came out right.

**Also converts to a validator, and the existing one cannot catch it.**
`test_same_person_called_when_persona_meets_existing_candidate` fires only when a
new `pe_` entry exists, so a skipped attestation on a **no-link** decision — which
is exactly this — slips past. The rule is owed to the *decision*, not to the link.
Recorded as a known gap at the lead's direction rather than widened here; widening
needs a way to detect "an unlinked record-search persona with a serious candidate
was evaluated", which is harder than reading what was written.

## F10 — A stale sidecar score is quotable as a live one

Generalising F9's second half, because it is not specific to `_023`: a scenario's
`results/<log_id>.json` sidecars carry `score` values from earlier logged searches,
and nothing distinguishes them from a score obtained in the current run. A skill
that skips `same_person` can still produce a confident-looking, numerically
specific disclosure by reading one. **Validator request:**

> **Rule:** a numeric match score appearing in a response or in a `pe_`
> `rationale` must correspond to a `same_person` call in the same run.
> **Where to look:** `output.tool_calls` for `same_person` and its returned score;
> the response text and `research_append` args for quoted numerals.
> **Why it is not judgment:** the call either happened or it did not, and the
> sidecar values are readable from the scenario.
> **What a violation looks like:** `ut_person_evidence_023`, run
> `v1_2026-08-24_22-05-46` — quotes 0.71 from `flynn-record-matching`'s
> `results/log_002.json` with zero `same_person` calls in the run.

## Deferred deliberately — the name-provenance sentence on §5's carve-out

Raised by @florencemashipei in review of #1882, verified, accepted, and **not
shipped in this PR**. Recorded here rather than left implicit.

**The gap.** §5's carve-out tells the skill to create a bride named only inside
the groom's marriage assertion with `tree_edit add_person` — "gender plus the
name the record gives". `assertNodeHasRef` runs on inline **facts** only in the
`add_person` arm of `tree-edit.ts`, never on names, so she lands with **no
provenance**. And the exemption she travels through is the one
`tree-materialization-spec.md` §6 reserves for **hypothesis, oral, and manual**
stubs, whose stated safety argument is that record-derived names "come through
`materialize_facts`, which enforces a resolved ref on every name it authors."
A bride in a marriage register is record-derived, so that argument is exactly
what does not hold for her. Shipping the clause as drafted legitimises
unsourced `add_person` for record-derived people.

**The accepted wording**, to apply verbatim on the next run:

> Create her with `tree_edit add_person` — gender, the name the record gives,
> and that name's `sources: [{ ref, page }]` resolved from the marriage
> assertion's `source_id`, since `add_person` enforces a ref on inline facts but
> not on names and she is record-derived, not a hypothesis stub. Then link per
> Step 4.

**Why deferred.** It edits `SKILL.md`, so it flips the run-log snapshot and buys
a paid eval run; it cannot take `eval-cosmetic-skip`, which is for
behaviour-neutral edits only. The lead chose to let it ride the run
`person-evidence` next pays for, alongside F9's judge-grounding clause.
@florencemashipei stated she would approve on that basis provided the deferral
is explicit, which is what this section is.

**The better fix is filed, not written here.** #1895 — teach `materialize_facts`
to mint from a relationship assertion's named party, so the ref is *enforced
rather than remembered* and the carve-out retires entirely. That is a tool
change with its own spec section and Vitest coverage, so it wants a tool
reviewer rather than this dive.

**Three things now ride the next paid run**, and they should go together: this
sentence, F9's `_023` grounding clause, and — if the corpus has caught up — the
ungating of `test_check_warnings_runs_after_a_write`.
