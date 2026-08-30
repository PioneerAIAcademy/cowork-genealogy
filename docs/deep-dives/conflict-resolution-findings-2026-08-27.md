# Deep dive: conflict-resolution — findings and validator requests

Issue #1652. Guide followed: [`docs/skill-deep-dive-guide.md`](../skill-deep-dive-guide.md).
Prohibition list: [`conflict-resolution-prohibition-list.md`](./conflict-resolution-prohibition-list.md).

**Corpus read:** all five committed run logs —
`eval/runlogs/unit/conflict-resolution/v1_2026-08-18_10-20-02.json`,
`…_13-28-10.json`, `…_15-37-43.json`, `…_19-42-11.json`, and the active
`v1_2026-08-19_15-24-31.json` — 63 runs over 13 tests, plus the five `.ann.json`
annotations. Transcripts read before scores, per Step 2.

> **`v1_2026-08-18_10-20-02` is no longer on disk.** It and its `.ann.json` were pruned by
> the harness's 5-candidate retention cap when this dive's own run landed, and the
> deletions are committed in this PR. It was read in full while it was present, and the
> findings below cite it; recover it from git history (`git show
> <pre-prune-commit>:eval/runlogs/unit/conflict-resolution/v1_2026-08-18_10-20-02.json`) if
> you need to check a quotation against it.

---

## Sequencing

Ruled on issue #1652 (2026-08-27): **this dive goes first and pays for the
`make eval-skill SKILL=conflict-resolution` run.** Issue #1823 waits and buys its own
run afterwards. Batching #1823's step-1 SKILL.md edit in here would have saved one
measured $2.53 run, but it would have pulled a blocking-conflict *definition* change —
`research-append.ts`, `validator.ts`, both `research.schema.json` mirrors and two
specs — under a genealogist's review. **No file on issue #1823's Touches list is
edited in this PR.** Issue #1852's line that the eval slot is held by #1823 is
superseded by that ruling; #1852 is in any case blocked behind #1851 and not in this
window.

Findings F3 and F6 below sit next to #1823's territory without entering it: #1823 owns
whether `blocks_question_ids` / `identity_question` are populated and what the
*completion gate* does with them. F3 and F6 are about what `conflict-resolution` itself
may write while another conflict is open, and about a coherence rule on
`proof_summaries` that no gate reads. Both are cross-referenced onto #1823 rather than
duplicated.

## Numbers, re-derived

The issue body's original table said 12 tests and 4-of-6 flat dimensions; DallanQ's
`make judge-report` comment corrected that to 13 tests and 3-of-6. Both are right about
different populations, and the difference matters for reading the rest of this document,
so here it is computed directly from the five run logs:

| | |
|---|---|
| Tests in the suite | **13** (7 positive, 6 negative) |
| Runs in the corpus | 63 (5 logs × 12–13 tests, 1 run each) |
| Dimensions flat **across the whole corpus** | **3 of 6** — `base/Tool Arguments`, `rubric/Evidence weighing`, `rubric/Resolution completeness` |
| Dimensions flat **on positive tests only** | **4 of 6** — the three above plus `base/Completeness` |
| `judge_context` files naming a score branch | **0**, confirmed |

`base/Completeness` and `base/Correctness` look like they discriminate only because of
the negative-test judge artifact in **F9**: every `1` either dimension ever scores comes
from an auto-routed negative test whose score is *ignored* in deciding the outcome. On
the 35 positive runs — the only place a dimension can report a defect in the craft —
`base/Completeness` is 3 in 35 of 35, `rubric/Evidence weighing` is 3 in 35 of 35, and
`rubric/Resolution completeness` is 3 in 35 of 35.

So **four of the six dimensions have never, in five paid runs, said anything other than
"3"** about work this document shows to be wrong in at least six distinct ways. That is
the context for every finding below: none of them was caught, and the two dimensions
nominally responsible for catching most of them are the two that have never moved.

> **Read this table as a property of the five committed logs, not of the suite.** The
> sixth run (see "What the eval run showed") moved three negative tests from 1 to 3 with
> no behaviour change, which shifts the whole-corpus count. Re-derive with
> `make judge-report` rather than quoting these figures. What did *not* shift: `Evidence
> weighing` and `Resolution completeness` are still 3 on every positive run — 42 of 42
> across every run ever measured for this skill.

---

## F1 — Standard 46 is stated in `independence_analysis` and discarded in `weighing_analysis`, on the same write, in 3 of 3 birthplace resolutions

**Did:** `ut_conflict_resolution_006`, run `v1_2026-08-19_15-24-31`, conflict `c_001`,
one `research_append` call. Its `independence_analysis` reads:

> "Per GPS Standard 46, these two assertions must be treated as a **partially dependent
> unit, counted as no more than one strong report**."

Its `weighing_analysis`, in the same `fields` object, reads:

> "Third, **corroboration**: both original census records agree on Ireland, representing
> **two independent recording occasions** by different enumerators. The Pennsylvania
> claim stands alone with a secondary informant. The applicable defensible rationale is a
> combination of Standard 48 rationales 1 and 2: the death certificate birthplace entry
> is **uncorroborated** … while **two independent recording occasions by proximate
> informants corroborate Ireland**."

The same shape, in the same run log:

- `ut_conflict_resolution_008` / `c_001` — independence: "a_002 and a_009 carry the
  weight of **one well-placed informant** … not two fully independent witnesses";
  weighing: "Third, corroboration: **two census records, independently created** by
  different enumerators a decade apart, both record Ireland."
- `ut_conflict_resolution_001` / `c_001` — independence: "treated as a **single informant
  unit** for the birthplace fact — they receive the weight of one strong contemporaneous
  recording, **not two fully independent ones**"; weighing: "Third, consistency: two
  enumerations a decade apart, by different enumerators who **independently** recorded
  Ireland, carry more weight than a single later report."

**Should:** the skill body's gate before any `resolved` write (SKILL.md :294–300):

> "**Gate before any `status: "resolved"` write:** can independent evidence actually
> break the tie? When every competing assertion traces to a single source or a single
> informant, weighing cannot resolve the conflict — no matter how thorough your analysis
> reads. … Completing a strong analysis is not, by itself, grounds to resolve."

And `references/weighing-evidence.md`, Standard 48 rationale 1: "**Uncorroborated single
item**: Only one evidence item (**or one group of related items**) supports the losing
side, while **multiple independent items** support the winning side." Having grouped the
Ireland side into one unit under Standard 46, the skill has no multiple independent items
left on the winning side, so rationale 1 is unavailable to it. The resolution is
1 informant unit vs. 1 informant — the exact tie the gate at :294 exists to stop.

Rationale 2 (more error-prone sources) does independently carry a preference for Ireland,
and Ireland is very likely the right answer. The defect is not the verdict; it is that
the stated ground for the verdict is refuted by the field immediately above it, and a
reviewer reading the persisted entry is shown a corroboration argument the record does
not support.

**Gap — lane 2, and it is mine.** The two fields are graded by two different rubric
dimensions, and **no dimension reads them together.** `Source independence analysis`
scored 3 on all three (correctly — the independence field alone is good work).
`Evidence weighing` scored 3 on all three, because its pass criterion is "cites specific
assertion attributes … and applies the preponderance hierarchy to them", which this does.
The human annotator confirmed both 3s on `ut_006` and `ut_008` in
`v1_2026-08-19_15-24-31.ann.json`. Nothing in the suite is looking at the seam.

**Fixed in this PR:** `rubric.md`'s `Evidence weighing` dimension now grades the weighing
*against* the independence finding on the same write, with an explicit fail branch. See
"Lane-2 fixes made" below.

**Partially converts** — see validator request **V1**, offered with its false-positive
risk stated. The prose contradiction itself is judgement and stays with the judge; the
phrase-level guard is a cheap catcher for the specific recurring pair.

---

## F2 — 31 of 37 persisted resolutions blow the ~250-word cap, and 16 of those are on single-assertion conflicts where the escape clause cannot apply

**Did:** measured over every analysis-bearing `research_append` write in all five run
logs — 37 writes.

| Field | Cap | Writes over cap |
|---|---|---|
| `resolution_rationale` | ~250 words (two-way conflict) | **31 of 37** |
| `weighing_analysis` | ~200 words | **16 of 37** |

Worst cases in the active log: `ut_conflict_resolution_001` / `c_001` at **460 words**;
`ut_conflict_resolution_006` / `c_001` at **436**; `ut_conflict_resolution_008` / `c_001`
at **421**.

The escape clause covers three-or-more-way conflicts. **It cannot cover 16 of the 31** —
every one of those is an *identity* conflict carrying exactly **one**
`competing_assertion_id`, so there is no second competing assertion to name and nothing
for length to buy:

- `ut_conflict_resolution_002` / `c_002`, `v1_2026-08-18_10-20-02` (pruned by the
  5-candidate retention cap when this dive's run landed) — **475 words** on
  `competing_assertion_ids: ["a_001"]`. Nearly double the cap. Highest surviving instance:
  `ut_conflict_resolution_001` / `v1_2026-08-19_15-24-31`, 460 words.
- `ut_conflict_resolution_003` / `c_002`, `v1_2026-08-18_19-42-11` — **424 words**, same
  single-assertion conflict.
- `ut_conflict_resolution_005` / `c_003`, `v1_2026-08-18_15-37-43` — **420 words**,
  `competing_assertion_ids: ["a_014"]`.

The remaining 13 span `ut_002`, `ut_003`, `ut_005`, `ut_006` and `ut_007` across all
five logs — 257 to 375 words. It is not one test drifting; it is every test that touches
a single-assertion identity conflict, in every run.

**Should:** SKILL.md :257–263 — "keep it to **~250 words or fewer** for the common
two-way conflict … **Completeness outranks the word cap:** in a three-or-more-way
conflict, name every non-preferred assertion … even if that runs past ~250 words — the
cap is **a default for the simple case, never a license** to drop a competing assertion
from the analysis." And :191–193 — "write up only the **2-3 decisive factors** … Keep
`weighing_analysis` to **~200 words or fewer**."

**Gap — lane 2 plus a validator; explicitly *not* lane 4.** The rule is already in the
body, stated twice, with its one exception spelled out. The guide is direct about this:
"Do not add prose to a skill body for a rule it already contains. Check the transcript
first: if the rule was there and was ignored, restating it is not the fix." **No prose
change is proposed.**

Two things push the other way and are worth naming, because they explain why five paid
runs never surfaced this. First, the `Resolution completeness` rubric dimension rewards
exactly what the cap penalises — its pass criterion is "names **every** competing
assertion and explains why the non-preferred ones are less reliable" — and it has scored
3 in 35 of 35 positive runs. Second, nothing else in the harness measures a field length.
A skill told to be brief, graded on thoroughness, and measured on neither, drifts long.

**Converts cleanly** — validator request **V2**. This is the flagship conversion of the
dive: a word count and an array length, no interpretation anywhere.

---

## F3 — A fact conflict is written `resolved` while an unresolved identity conflict covers one of its own competing assertions

**Did:** `ut_conflict_resolution_008`, scenario `flynn-identity-geographic`, **5 of 5
runs**: writes `c_001` (birthplace) to `status: "resolved"`, `preferred_assertion_id:
"a_002"`. `ut_conflict_resolution_006`, same scenario, does the same in **3 of 5 runs**.

In that scenario, `c_002` is open and asks, verbatim:

> `"identity_question": "Is the Patrick Flynn enumerated in the Thomas Flynn 1850
> household the same person as the Patrick Flynn whose 1908 death certificate is
> src_004?"`

`c_001`'s competing set is `["a_002", "a_009", "a_012"]` — where `a_002` is the 1850
census birthplace (src_001, the household in question) and `a_012` is the death
certificate birthplace (src_004). **`c_002` asks whether `a_002` and `a_012` describe the
same person at all.** While it is open, `c_001` is not known to be a conflict; if `c_002`
resolves the other way, `c_001` is `moot` — the status SKILL.md :315 defines for exactly
this ("the disputed person turned out to be a different individual entirely").

`ut_006`'s own response names the problem and then walks past it:

> "**c_002 is the more foundational identity question** but would require additional
> records to decide; c_003 is secondary."

`ut_008`'s response does the same, *after* writing the resolution:

> "**C_002 is the most foundational — it underpins whether the census evidence belongs to
> the right person at all.** Would you like me to work on c_002 next?"

**Should:** SKILL.md :433–437 names this case as its first example of what to prefer —
"prefer the most foundational (**e.g., an identity question that determines whose records
the others even compare**)". `ut_conflict_resolution_002`, on the sibling scenario
`flynn-multi-conflict` with the same `c_001`/`c_002` pair, quotes the rule and applies it
correctly:

> "**c_002 comes first.** It's the more foundational conflict — the whole census
> evidentiary chain depends on whether the 1850 household 84 Patrick is our subject at
> all. **If he isn't, the birthplace dispute in c_001 would be comparing assertions from
> different people.** The skill rule is clear: resolve the identity question that
> determines whose records the others even compare."

That is the right answer, written by the same skill, in the same run log, three tests
away.

**Gap — lane 2 (the test told it to do this: see F4) with a lane-4 residue, and a
validator.** Two mechanisms kept it invisible:

1. `three-conflict-prioritization.json`'s `judge_context` instructs the judge that
   `c_001` first is correct — F4.
2. The judge **cannot see the before-state conflicts at all.**
   `eval/harness/harness/orchestrator.py::_summarize_before_state` renders only
   `research.json` `sources` and `tree.gedcomx.json` source descriptions. There is no
   `conflicts[]` block in the rendered before-state, so a judge grading `c_001`'s
   resolution has no way to know `c_002` was open. **This is already issue #1902**
   ("before-state never renders `conflicts[]` — grounding graded on the skill's own
   testimony"), whose Touches list names that exact function. Commented there rather than
   re-filed.

**Converts** — validator request **V3**. The dependency is structural and readable from
`research.json` alone.

**Cross-referenced onto #1823**, which owns the completion gate's blindness to the same
class of conflict. No file on its Touches list is edited here.

---

## F4 — `three-conflict-prioritization.json`'s `judge_context` prescribes an answer that contradicts SKILL.md and its own sibling test

**Did:** `eval/tests/unit/conflict-resolution/three-conflict-prioritization.json`,
`judge_context[1]`:

> "Should explain the prioritization rationale: **c_001 is the most foundational** because
> birthplace is a distinguishing attribute that bears on both identity conflicts —
> resolving Ireland vs. Pennsylvania first gives the identity analyses more material to
> work with"

**Should:** SKILL.md :433–437 gives "an identity question that determines whose records
the others even compare" as its worked example of *most foundational*, which on this
scenario is `c_002`, not `c_001`. The suite's other prioritization test,
`multi-conflict-prioritization.json` (`ut_002`), keeps its `judge_context` neutral
("Should explain the rationale for the chosen ordering — which conflict is more
foundational, blocks more downstream work, or has better evidence available") and the
skill duly picks `c_002` and passes. The two tests put the same `c_001`/`c_002` pair to
the skill and grade opposite answers as correct.

This is a looser form of the shape the issue's opening grep hunts. That grep — for
`"score [123]"` — returns 0 hits here, correctly. This bullet does not name a score; it
names the verdict, which the judge then confirms. Same effect, one level of indirection.

**Gap — lane 2, mine.** Fixed in this PR: the bullet no longer names which conflict wins.
See "Lane-2 fixes made".

---

## F5 — A recorded `indeterminate` informant is upgraded to a named parent with firsthand knowledge, and the upgrade is what carries the resolution

**Did:** `ut_conflict_resolution_008`, active run, chat response:

> "The census informant — **almost certainly Thomas Flynn, Patrick's father** — reported
> Ireland within 5–15 years of the birth, **with firsthand knowledge**."

`ut_conflict_resolution_006`, active run, persisted `weighing_analysis`:

> "the census household informants — **almost certainly Thomas Flynn and/or his wife** —
> are the people with the most direct possible knowledge of Patrick's birthplace, **since
> parents are as close to eyewitness knowledge of a child's origins as exists**."

`ut_conflict_resolution_001`, active run, persisted `resolution_rationale`:

> "The household informants who answered the census enumerators in 1850 and 1860 **had
> direct personal knowledge** of Patrick's origins: they **either witnessed the birth or
> emigrated from Ireland with him** as a young child."

**Should:** what is actually on file for `a_002` and `a_009` in every one of these
scenarios is `information_quality: "indeterminate"` and

> `"informant": "Unknown — most likely a household member (such as Thomas Flynn or his
> wife), **but possibly a neighbor**"`

SKILL.md :78 — "**Trust the existing assertion classifications** (evidence_type,
directness, informant) **as recorded** — do NOT re-classify inline."
`references/weighing-evidence.md` §4 — "**When the informant is unknown, classify the
information as undetermined.**" And SKILL.md :478 — "Unsound assumptions carry zero
weight without supporting evidence and **must not be used to tip a resolution**."

Three separate upgrades happen in one step, each unsupported by the record:
*unknown-or-possibly-a-neighbour* → *Thomas Flynn*; *Thomas Flynn* → *Patrick's father*;
*a household member* → *an eyewitness to a birth in Ireland*.

The second is the serious one. **Whether Thomas Flynn is Patrick's father is `q_001` — the
open research question this very resolution is said to unblock**, carried in `h_001` at
`status: supported` and in `ps_001` at `tier: probable`, never proved. The resolution
assumes the conclusion it feeds. `ut_001`'s chat response closes with "This unblocks
q_001"; `ut_008`'s closes with "The hypothesis (h_001 — Thomas Flynn as father) is
unaffected."

Neither is right, and the second is wrong in the opposite direction from the one the
skill thinks. `a_013` — "Father: Thomas Flynn" — comes from **James Brown**, the same
son-in-law informant whose birthplace claim this resolution has just discredited as
"secondary, with no firsthand knowledge". Resolving `c_001` against Brown should *lower*
the weight of the direct parentage evidence in `h_001`, not leave it "unaffected". The
only place in the whole corpus that notices is `ut_conflict_resolution_010` — a
**negative** test, where the model never loaded the skill at all:

> "the death certificate names Thomas Flynn as father (direct but secondary), yet the same
> informant got the birthplace wrong … That undermines confidence in James Brown as a
> reliable secondary source, **which is relevant to how much weight a_013 deserves** in
> resolving the open conflict c_001."

**Gap — lane 4 with a lane-2 half, and a validator.** The prose rule exists (:78) but is
about *not re-classifying*, and the model does not experience "the informant was probably
the father" as a re-classification — it experiences it as weighing. SKILL.md's Part-4
guidance actively invites naming the informant's epistemic position, and the model obliges
past the evidence. This is the one finding in the dive where I think the body is genuinely
short of a rule rather than being ignored, and where ADR-0011's first question — *can this
be decided by reading the project documents alone?* — answers **yes**: `information_quality`
is a closed enum already in the file. It belongs at the writer-tool boundary or in a
validator, not in more prose. **No prose change proposed here**; see **V4**, and the
`Evidence weighing` rubric fail branch added in this PR.

**Converts** — validator request **V4**.

---

## F6 — `proof_summaries[].resolved_conflict_ids` names a conflict that is `unresolved`, in 3 of 4 scenarios, and nothing anywhere checks it

**Did:** `eval/fixtures/scenarios/flynn-with-birthplace-conflict/research.json`,
`flynn-multi-conflict/research.json` and `flynn-identity-geographic/research.json` all
ship `ps_001.resolved_conflict_ids: ["c_001"]` while `conflicts.c_001.status` is
`"unresolved"`.

The skill reads this state twice, in the active run log, and both times treats it as
support rather than as a defect:

- `ut_conflict_resolution_006` makes it the **prioritization ground** — the reason it
  chose `c_001` over the `c_002` it had just called more foundational: "it … was already
  claimed as resolved in the proof summary (ps_001) while the conflict entry itself was
  still formally `unresolved` — a discrepancy that would mislead any downstream GPS
  review."
- `ut_conflict_resolution_008`: "The proof summary (ps_001) already references c_001 as
  resolved, **so that's now accurate.**"

**Should:** a proof summary that lists a conflict as resolved when the conflict is not is
a false statement of the research state — the precise failure SKILL.md :457–465 describes
for the conflict entry itself ("A half-filled 'resolved' conflict misrepresents the
research state downstream — proof-conclusion will treat it as decided when it isn't").
The skill is right that this is a discrepancy; it is wrong to let it *decide* anything,
and wrong to call it retroactively accurate.

**Gap — a fixture defect and a missing guard, not a skill-prose defect.**
`packages/engine/mcp-server/src/validation/validator.ts` checks `resolved_conflict_ids`
for presence and shape only — it appears in the `NULLABLE_FIELDS` list and in the
proof-summaries block's `checkRequired` call, and **nowhere else** — it does not check that the
ids resolve to real conflicts, let alone that those conflicts are `resolved`. The
proof-summary block's only `checkRefExists` call is on `question_id`. So a project can
carry a proof summary asserting a conflict resolved that is open, and no tool, schema,
validator, or eval check will say a word.

Deliberately **not** fixed by editing the fixtures in this PR: three scenarios are shared
with other skills' suites, and silently flipping `c_001.status` to `resolved` would change
what `ut_001`, `ut_006` and `ut_008` are even testing. The right fix is the guard, which
then tells us which fixtures to correct.

**Converts** — validator request **V5**. Filed with the `nothing-checks` label, since this
is a way CI stays green while the state is wrong.

---

## F7 — The one-conflict-per-turn rule is broken in 2 of 5 `ut_002` runs, and both pass with all-3s

**Did:** `ut_conflict_resolution_002`, runs `v1_2026-08-18_15-37-43` and
`v1_2026-08-18_19-42-11`: two `research_append` calls each, writing **both** `c_001` and
`c_002` to `status: "resolved"` with full analysis fields on each. `file_changes` confirms
both entries modified. Outcome: `pass`, all six dimensions `3`, in both runs.

**Should:** SKILL.md :432–443 — "**When several conflicts are unresolved at once, address
one per turn.** … Then do the full independence/weighing/resolution work on **that one
conflict only**, leaving the others' fields untouched this turn. Resolving several in a
single pass produces tangled rationale and skips the prioritization judgment the user
asked for."

The test's own `judge_context` carries the rule: "If the skill writes to the conflicts
section, it should update **exactly one** conflict's analysis fields and leave the other
untouched."

**Gap — lane 2 with a validator.** The judge was handed the rule in the test file and
scored 3 anyway, twice. This is not a prose problem and not a rubric-wording problem: it
is a count, and a count should never have been left to an LLM. **Converts** — validator
request **V6**.

---

## F8 — `ut_002` and `ut_003` reach opposite verdicts on the same conflict, in the same scenario, in the same run log

**Did:** both tests run on `flynn-multi-conflict` and both work `c_002` — the single
identity conflict, `competing_assertion_ids: ["a_001"]`. In `v1_2026-08-19_15-24-31`:

- `ut_conflict_resolution_002` writes `status: "resolved"`, `preferred_assertion_id:
  "a_001"`.
- `ut_conflict_resolution_003` writes `status: "unresolved"`, `preferred_assertion_id:
  null`.

Both `pass`, all dimensions 3. Across the five logs `ut_003` splits 2 resolved / 3
unresolved on the same conflict; `ut_002` resolves it 5 of 5.

The discriminator `ut_002` uses to close it does not survive reading:

> "A Patrick of age 5 in 1850 (household 84) maps to age 15 in 1860 — exactly what src_003
> records. The competing 1850 Patrick (dwelling 197, age 6) would have been approximately
> **age 16 in 1860, not 15**. That **one-year gap is small** but runs in the wrong
> direction …"
>
> "No record at any point places the household 197 Patrick in Thomas Flynn's family unit."

and in the chat response, more baldly:

> "the dwelling 197 Patrick **whose family was unrelated to Thomas**"

**Should:** three rules, each broken:

- A one-year census-age difference is not a discriminator.
  `references/historical-contradictions.md` §"Census age estimation" exists for exactly
  this, and `ut_conflict_resolution_007` — the deferral variant of this same conflict —
  states the correct reading: "The age-5 vs. age-6 difference is **within normal census
  variance**."
- "whose family was unrelated to Thomas" is not on file. The scenario records dwelling 197
  as "head **not named** in the index" / "the head of that household is unknown".
  `ut_003`, same run log, gets this right: "The decisive gap: **we don't know who headed
  dwelling 197**."
- SKILL.md :341–351 — "**Do not confirm identity by the absence of an alternative.** …
  Confirm a same-name match by *positively* placing your subject … never by the
  alternative candidate's disappearance." "No record at any point places the household 197
  Patrick in Thomas Flynn's family unit" is the prohibited move stated outright. Plus
  :325 ("DISTINCT until proven otherwise") and :490 ("Err on the side of leaving conflicts
  unresolved").

**Gap — lane 4 residue, but the convertible half is the inconsistency itself.** Adding
prose is not indicated: `ut_007` and `ut_003` show the skill already holds all three rules
and applies them correctly when the prompt does not push toward a verdict
("start working on whichever should come first" pushes; "either resolve it or flag what
additional evidence would be needed" does not). What is missing is anything that notices
the corpus disagreeing with itself. **Converts** — validator request **V7**.

---

## F9 — The judge scores Correctness/Completeness `1` on three of five auto-routed negative tests and `3` on the other two, on structurally identical runs

**Did:** all five clean routing negatives produce the identical run shape —
`activated: false`, empty `text_response`, zero tool calls, zero file changes, and the
test's own `correct_skill` in `skills_invoked`. The judge splits them:

| Test | Routed to | Correctness across the 5 logs |
|---|---|---|
| `ut_004` | `search-records` | 3, 3, 3, 3, 3 |
| `ut_011` | `timeline` | 3, 3, 3, 3, 3 |
| `ut_009` | `person-evidence` | **1, 1, 1, 1, 1** |
| `ut_012` | `proof-conclusion` | 3, 3, 3, 3, **1** |
| `ut_013` | `hypothesis-tracking` | **1** (one run) |

`ut_012` flipped 3 → 1 between `v1_2026-08-18_19-42-11` and `v1_2026-08-19_15-24-31` with
no change in behaviour — identical empty response, identical routing. The rationale given
for the 1s is that the skill "failed to explicitly communicate the routing decision" and
"complete silence does not constitute a proper decline" — but conflict-resolution was
never invoked; the orchestrator routed away before it ran. There is no
conflict-resolution response in existence to grade.

The harness already knows: `routing_negative_judge_fail` warnings fire on exactly these
cells, carrying the advisory "if the skill under test carried out its own task inline, the
1 is right". Here it did not — it produced nothing at all.

**Should:** the outcome is decided by routing, so no test verdict is wrong. The cost is
elsewhere: these are the **only** `1`s either base dimension takes anywhere in the corpus,
so they are the entire reason `base/Correctness` and `base/Completeness` appear to
discriminate. Read the corpus at face value and you conclude 3 of 6 dimensions are flat;
read only where a defect could be reported and it is 4 of 6.

**Gap — lane 2, but not mine to fix.** The judge prompt is global. The guide is explicit:
"**Do not edit the base rubric or the global judge prompt.** Those are global — post the
problem and your proposed wording, and let the lead call it."

**Proposed wording, for the lead:** when a negative test's run has `activated: false`, an
empty `text_response`, and `skills_invoked` ⊆ the test's `correct_skill`, the base
dimensions should be scored `N/A` (`null`) rather than graded — the same treatment
`Tool Arguments` already gets on these runs. Raised on issue #1965's validator-request
issue rather than filed separately.

---

## F10 — `references/validation-protocol.md` ships in this skill and is unreachable, and its content contradicts the body

**Did:** `packages/engine/plugin/skills/conflict-resolution/references/validation-protocol.md`
exists. `grep -n "references/" SKILL.md` returns seven hits, naming
`places-guidance.md`, `weighing-evidence.md`, `historical-contradictions.md` and
`resolution-writing.md`. **`validation-protocol.md` is named nowhere in SKILL.md**, and
the reference table at :42–48 lists only three of the five files present.

Its content, if it were reached, would be wrong for this skill twice over:

> "**Invoke `check-warnings`** if you added assertions or person_evidence entries."

SKILL.md :80 forbids the first ("do NOT invoke the record-extraction or check-warnings
skills from here") and :451 forbids the second ("Write only the `conflicts` section. Do
not modify `assertions`, `person_evidence`, …").

**Should:** a live skill's references should be reachable and non-contradictory.

**Gap — not a new issue.** Two open issues already own both halves: **#1112** ("Skill
references: adjudicate the drifted families, **resolve the 18 unreachable files**, and fix
the pointer to a file that never existed") and **#1115** ("Lint `validation-protocol.md`
and `research-log-protocol.md` for drift"). Commented on #1112 with this instance —
including that this copy is not merely unreachable but actively contradicts its own
skill body, which the other 17 may or may not do. Not deleted here: `validation-protocol.md`
is a shared-family file under #1112's adjudication, and deleting one copy out of the
family is how a drift lint stops being able to see the family.

---

## Observations, not findings

Recorded so the next auditor does not spend time re-deriving them. Neither is a
genealogical defect and neither is worth an issue.

- **`project_context` is denied on every run.** 32 attempts across 8 tests hit the
  `uncovered_tool_call` advisory; the call never reaches `tool_calls` at all, meaning it
  was denied before reaching the mock. `conflict-resolution`'s `allowed-tools` does not
  list it, and the unit harness still derives a deny-list from the grant. Every positive
  test then spends 2–3 turns on a `Glob` + raw `Read` of `research.json` instead. This is
  the distortion CLAUDE.md already names — "A skill's `allowed-tools` is a **grant, not a
  restriction** … The unit harness still derives one; retiring it is open work" — not a
  new defect. `project_context` is served live by the compiled TS tool — `mock_mcp.py`'s
  live-handler dispatch routes it through `_make_compiled_tool_handler` to
  `project-context.js` — so it would work if it were reachable.
- **`ut_conflict_resolution_006` declares six `mcp_fixtures` and uses none of them** in
  any of five runs (`place-search-ireland`, `place-search-pennsylvania`,
  `place-search-allegheny`, `place-search-schuylkill-county`, and both
  `place-distance-*`). Its only MCP call in every run is `research_append`. Harmless, but
  it makes the test look like it exercises the place path when it never has.
  `ut_005` does exercise it correctly — `place_search` ×2 then `place_distance`, with the
  199 mi / 320 km in its response traceable to
  `eval/fixtures/mcp/place-distance-schuylkill-allegheny.json`.

---

# Validator requests

Per Step 6 — the genealogical rule is supplied here; a developer writes the Python.
Grouped onto **one** issue, per the guide's "Do not open one issue per finding", since
all seven ride the same `conflict-resolution` eval run and the same annotation pass.

---

### V1 — `weighing_analysis` must not claim corroboration that `independence_analysis` just denied

**Rule:** on a single `research_append` write, when `independence_analysis` groups the
winning side's assertions as dependent — it says they are "partially dependent", a
"single informant unit", or "not … independent", or that they carry "the weight of one"
report — then `weighing_analysis` must not, on that same write, cite those assertions as
"two independent" items or invoke GPS Standard 48 rationale 1 ("uncorroborated single
item") against the losing side. A group of related items gets no more credibility than
its strongest single member; it cannot simultaneously be one item and be the corroboration
that makes the other side uncorroborated.

**Where to look:** the `fields` object of the `research_append` call, or the
`conflicts[]` entry in the after-state — `independence_analysis` and `weighing_analysis`
together.

**Why it is not judgment:** whether the argument is *persuasive* is judgment and stays
with the judge. Whether the same write says both "count as one" and "two independent
recording occasions corroborate" is a phrase-level contradiction.

**Caveat, stated plainly:** this is the least clean of the seven. A phrase-pair guard will
have false positives — a weighing analysis may legitimately say the two *records* are
independent while the *informant* is shared, which is exactly what a correct answer looks
like. **Recommend shipping it warning-level, not fail-level**, and letting the developer
choose the anchor phrases from the three worked examples below. If it cannot be made to
distinguish those two cases, drop it — the `Evidence weighing` rubric fail branch added in
this PR already covers the same ground with a judge that can read.

**What a violation looks like:** `ut_conflict_resolution_006`, run
`v1_2026-08-19_15-24-31`, `c_001` — independence: "must be treated as a partially
dependent unit, counted as no more than one strong report"; weighing, same write: "two
independent recording occasions by proximate informants corroborate Ireland". Same shape
in `ut_008` and `ut_001` in the same log.

---

### V2 — `resolution_rationale` and `weighing_analysis` word caps

**Rule:** `weighing_analysis` must be **≤ 200 words**. `resolution_rationale` must be
**≤ 250 words** when the conflict has **fewer than three** `competing_assertion_ids`; with
three or more, the cap does not apply (SKILL.md's completeness escape). Suggest failing at
a 20% grace band — 240 / 300 — so a 260-word rationale on a two-way conflict is a warning
and a 420-word one is a failure; the developer should pick the band, but it must be far
below what the corpus produces today.

**Where to look:** each `conflicts[]` entry in the after-state that this run modified:
`weighing_analysis`, `resolution_rationale`, `competing_assertion_ids`.

**Why it is not judgment:** a word count of a string field and the length of an array.
Nothing needs interpreting, and the one exception is expressed entirely in terms of the
array length.

**What a violation looks like:** `ut_conflict_resolution_002`, run
`v1_2026-08-18_10-20-02` (pruned by the 5-candidate retention cap when this dive's run
landed), `c_002` — 475 words on `competing_assertion_ids: ["a_001"]`.
31 of 37 writes in the corpus are over the rationale cap, **16 of them on
single-assertion conflicts where the escape clause cannot apply**; 16 of 37 blow the
weighing cap too. Highest surviving instance: `ut_conflict_resolution_001` /
`v1_2026-08-19_15-24-31`, 460 words.

---

### V3 — no `resolved` fact conflict while an open identity conflict covers one of its competing assertions

**Rule:** a conflict must not be written `status: "resolved"` if, in the same
`research.json`, another conflict has `status: "unresolved"`, `conflict_type: "identity"`,
and a `competing_assertion_ids` entry that shares a `source_id` with any of the resolving
conflict's own `competing_assertion_ids`. Until the identity question is settled, the two
assertions are not known to describe one person, so their disagreement is not established
as a conflict at all — and if the identity resolves the other way the entry is `moot`, not
`resolved`.

**Where to look:** `research.json` `conflicts[]` and `assertions[]` in the after-state —
`status`, `conflict_type`, `competing_assertion_ids`, and each assertion's `source_id`.

**Why it is not judgment:** three closed enums and two id joins, all already in the file.
No prose is read.

**What a violation looks like:** `ut_conflict_resolution_008`, all five run logs,
scenario `flynn-identity-geographic` — `c_001` set `resolved` on `a_002` (src_001) while
`c_002` is `unresolved` and asks whether src_001's Patrick is src_004's Patrick.
`ut_conflict_resolution_006` does the same in 3 of 5.

**Note for the implementer:** this overlaps issue #1823's territory conceptually but not
in code — #1823 widens the *completion gate*'s blocking predicate; this is a
`conflict-resolution` eval validator. Coordinate on the shared definition of "blocking"
before both ship, and expect #1823's step 2 ruling to be the thing that settles the
`source_id`-sharing heuristic above into something firmer.

---

### V4 — a resolution may not assert firsthand knowledge for an informant the record records as unknown

**Rule:** when a competing assertion carries `information_quality: "indeterminate"`, or an
`informant` string containing "unknown", "possibly", "likely" or "most likely", the
`weighing_analysis` and `resolution_rationale` must not attribute to that informant
firsthand or eyewitness knowledge of the disputed fact ("firsthand knowledge", "direct
personal knowledge", "witnessed the birth", "eyewitness"), nor name them with a certainty
the record withholds ("almost certainly Thomas Flynn"), nor assign them a family
relationship that the project has not established. An unknown informant is undetermined,
and an undetermined informant cannot be the ground of a resolution.

**Where to look:** `research.json` `assertions[]` (`information_quality`, `informant`) for
each id in `competing_assertion_ids`, against the `weighing_analysis` and
`resolution_rationale` on the same conflict.

**Why it is not judgment:** `information_quality` is a closed enum already in the file, and
the guard is a literal-phrase check against the specific assertions the conflict names —
not a reading of the argument.

**What a violation looks like:** `ut_conflict_resolution_008`, run
`v1_2026-08-19_15-24-31` — "almost certainly Thomas Flynn, Patrick's father … with
firsthand knowledge", where `a_002.information_quality` is `"indeterminate"` and
`a_002.informant` is "Unknown household member (likely Thomas Flynn or wife)".
`ut_006` and `ut_001` carry the same upgrade into the persisted fields.

**Second half of the same rule, worth pricing separately:** the relationship asserted
("Patrick's father") is the subject of the project's own open question `q_001` and its
`h_001` at `status: supported`. A stronger form of this validator would fail any
resolution that states as fact a relationship the project holds only as an unproved
hypothesis. That needs a decision on how to read `hypotheses[].status` — the lead's call,
not a junior's.

---

### V5 — `proof_summaries[].resolved_conflict_ids` must reference conflicts that exist and are resolved

**Rule:** every id in `proof_summaries[].resolved_conflict_ids` must resolve to a
`conflicts[]` entry that exists **and** carries `status: "resolved"`. A proof summary
listing an open conflict as resolved states the research state falsely to every downstream
reader, which is the exact harm SKILL.md :457–465 describes for the conflict entry itself.

**Where to look:** `research.json` `proof_summaries[]` and `conflicts[]` in the after-state.

**Why it is not judgment:** an id join and one closed-enum comparison.

**What a violation looks like:** three shipped fixtures —
`eval/fixtures/scenarios/flynn-with-birthplace-conflict/`, `flynn-multi-conflict/` and
`flynn-identity-geographic/` — all carry `ps_001.resolved_conflict_ids: ["c_001"]` with
`c_001.status: "unresolved"`.

**Label `nothing-checks`.** `validator.ts` checks this field for presence and shape only — `checkRequired` plus
`checkAllowedKeys` against `RESEARCH_SHAPES.proof_summary`; there is no `checkRefExists`
on it (the proof-summary block's only one is on `question_id`), so today no tool, schema, validator
or eval check can see the inconsistency. Belongs in `validator.ts` as a referential check,
not only as an eval validator — it should bind on every project, not just on graded runs.
**Expect it to fail three fixtures the moment it lands**; that is the point, and fixing
them is part of the same change.

---

### V6 — at most one conflict's analysis fields modified per invocation

**Rule:** in a single `conflict-resolution` invocation, at most **one** `conflicts[]`
entry may have any of `independence_analysis`, `weighing_analysis`,
`preferred_assertion_id`, `resolution_rationale` or `status` changed. Creating new
conflict entries is not restricted — identification is a separate step from resolution —
so gate only on the five analysis/verdict fields.

**Where to look:** `file_changes["research.json"].diff.conflicts.modified` in the run
output, or a before/after diff of `conflicts[]`.

**Why it is not judgment:** a count of modified entries.

**What a violation looks like:** `ut_conflict_resolution_002` in runs
`v1_2026-08-18_15-37-43` and `v1_2026-08-18_19-42-11` — both `c_001` and `c_002` written
`resolved` with full analysis in one turn. Both graded `pass`, all six dimensions 3,
despite the test's own `judge_context` naming the rule.

---

### V7 — the same conflict in the same scenario must not get opposite verdicts across a run log

**Rule:** across one run log, group every conflict write by `(scenario, conflict id)`.
When two tests write the same conflict in the same scenario and disagree on `status` or on
`preferred_assertion_id`, flag the run log. The evidence available to the skill is
identical in both, so at most one verdict can be right and the suite is currently unable
to say which.

**Where to look:** the run log's `tests[].scenario` and each run's
`file_changes["research.json"].diff.conflicts.modified[].changed_fields`.

**Why it is not judgment:** a grouping and an equality check. Deciding *which* verdict is
correct is genealogy and stays with a human; noticing that the corpus contradicts itself
is arithmetic.

**What a violation looks like:** `v1_2026-08-19_15-24-31`, scenario
`flynn-multi-conflict`, conflict `c_002` — `ut_conflict_resolution_002` writes
`resolved` / `a_001`, `ut_conflict_resolution_003` writes `unresolved` / `null`. Both
`pass` with all-3s. Across the five logs `ut_003` alone splits 2 resolved / 3 unresolved
on that same conflict.

**Note:** this one is a *suite* validator rather than a per-run one, so it may want to live
alongside `make judge-report` rather than in `eval/harness/validators/`. The developer
should place it; the rule is what matters.

---

## What the eval run showed

`make eval-skill SKILL=conflict-resolution` — run log
`eval/runlogs/unit/conflict-resolution/v1_2026-08-27_15-11-46.json`, 13 tests, $2.7558,
651s wall. **10 pass, 3 partial** (`ut_001`, `ut_006`, `ut_008`), against 12 pass / 1
partial in the newest committed log. Recorded here before annotation, because two of the
results contradict what this document predicted.

### What the fixes achieved

**The F3/F4 fix works, and the judge quotes it.** `ut_conflict_resolution_006` scored
**Correctness 2** — the first time in six run logs that the resolve-over-an-open-identity-conflict
defect has been caught by anything. The rationale:

> "The skill treats a_002 (1850 census birthplace) as a settled attribute of the subject
> Patrick Flynn without addressing the open dependency: c_002 asks whether the Patrick
> Flynn in src_001 is even the same person as the Patrick Flynn on the 1908 death
> certificate … It presents a contingent result (valid only if c_002 resolves in favor of
> the subject being the 1850 Patrick Flynn) as a decided one."

That is the defect, described correctly, in the judge's own words. Both edits contributed:
the `judge_context` bullet stopped telling it `c_001` was the right answer, and the
rationale closes by citing the new `Resolution completeness` wording verbatim.

### What the fixes did not achieve — and this is the part to carry forward

**`Evidence weighing` and `Resolution completeness` are still 3 in 7 of 7 positive runs.**
The dive changed *outcomes* — three partials where the corpus had at most one — without
un-flattening either dimension it wrote a new fail branch into. Both new rules fired; the
judge attributed both to a **neighbouring dimension**:

| Rule written into | Defect caught | Dimension the judge actually deducted on |
|---|---|---|
| `Evidence weighing` (independence/weighing contradiction) | yes, on `ut_001` | `Source independence analysis` = 2 |
| `Resolution completeness` (resolving over an open identity conflict) | yes, on `ut_006` | `base/Correctness` = 2 |

`ut_001`'s independence rationale describes **F1** almost exactly — *"it notes the sources
are 'partially dependent' in underlying knowledge but then treats them as two independent
sources for weighing purposes"* — and deducts on independence rather than on weighing.

Two readings, and this dive cannot separate them on one run: either the rules are in the
wrong dimensions and should be moved, or dimension attribution is loose enough that
*which* dimension carries a rule matters less than whether the rule is stated anywhere the
judge reads. **Do not re-word either dimension on this evidence alone** — that is a
one-run inference about a judge that has already shown itself unstable (below). It wants
the next paid run to settle.

### Calibration note

**The two new rubric fail branches did not move the dimensions they were written into.**
`Evidence weighing` and `Resolution completeness` each scored **3 in 7 of 7 positive
runs** — unchanged from the five committed logs, and unchanged by this PR's edits. Across
every run ever measured for this skill that is **42 of 42** for each dimension: 35 before
this PR, 7 after.

`ut_conflict_resolution_008` is the sharpest case, because it scored **3 on both** while
exhibiting the behaviour each branch names:

- The `Resolution completeness` branch describes "a competing assertion treated as a
  settled attribute of the research subject while an unresolved identity conflict covers
  that assertion's person-link". `ut_008` resolved `c_001` on `a_002` with `c_002` and
  `c_003` both still `unresolved`. Exact match. Scored 3.
- The `Evidence weighing` branch forbids weighing that rests on "an informant identity,
  relationship, or firsthand knowledge the record does not establish". `ut_008`'s
  `weighing_analysis` says the census assertions were "recorded while Patrick lived in the
  household of **his parents** — the people with direct, **firsthand knowledge** of where
  he was born", and that the 1850 informant was "almost certainly Thomas Flynn or his
  wife, **present at the birth**". `a_002.information_quality` is `indeterminate`; the
  parentage is `q_001`, unproved. Exact match. Scored 3.
- The first half of the `Evidence weighing` branch — the independence/weighing
  contradiction — is only a **partial** match here, and that is worth stating rather than
  rounding up. This run's independence analysis says "partially independent" rather than
  collapsing the pair to one report, and the weighing carries that qualifier through
  ("two partially independent records"). It still reaches for Standard 48 rationale 1 on a
  side its own analysis calls partly dependent, which the branch forbids, but it is a
  softer instance than the three in the committed corpus.

**The edits are not inert.** `Source independence analysis` moved to **2** on `ut_001` —
and the sampled annotation confirmed that 2 with no score change, so a human agrees the
deduction is right. What the run cannot tell us is whether the two unmoved dimensions are
mis-scoped or whether the judge simply attributes loosely; both readings fit, and one run
does not separate them.

**The `ut_008` gap is judge-only.** `ut_008` fell outside the harness's designated review
sample (seed 2995: `ut_001`, `ut_007`, `ut_009`, `ut_012`, `ut_013`), so no human has
confirmed either 3. **Recorded here rather than closed by re-annotating** — re-running the
sample to reach one test would spend a paid run to confirm a negative result this
paragraph already states, and the annotation would no longer be the harness's own sample.

---

### F1, F2 and F8 all recurred

No prose changed, so this is the expected result — recorded because it is what makes the
validator requests load-bearing rather than speculative.

- **F2:** **7 of 7** rationales over the ~250-word cap (`ut_008` at 429 words), **4 of them
  on single-assertion conflicts** where the escape cannot apply. `Resolution completeness`
  scored 3 on every one. Corpus total is now **38 of 44** writes over the cap. **V2 stands.**
- **F8:** `ut_002` wrote `c_002` `resolved`/`a_001` and `ut_003` wrote the same `c_002`
  `unresolved`/`null` — same scenario, same run log, both `pass`. Six of six run logs now.
  **V7 stands.**
- **F1:** recurred on `ut_001`, caught but mis-routed (above). **V1 stands, still
  warning-level.**

### F9 corrected: the negative-test 1s are stochastic, not systematic

**This run refutes the stable half of F9 and I am correcting it rather than rewording it.**
`ut_009`, `ut_012` and `ut_013` all scored **Correctness 3 / Completeness 3** here. Across
the five committed logs `ut_009` was 1 in 5 of 5 and `ut_013` 1 in its only run.

| Test | Committed corpus | This run |
|---|---|---|
| `ut_009` | 1, 1, 1, 1, 1 | **3** |
| `ut_012` | 3, 3, 3, 3, 1 | **3** |
| `ut_013` | 1 | **3** |

The claim in F9 that these are "the only 1s either base dimension takes" was true of the
committed corpus and is still true of it. The inference that the artifact is *deterministic*
was wrong — it is run-to-run noise on a structurally identical input, which is the same
conclusion `ut_012`'s 3→1 flip already hinted at and I under-weighted.

This **strengthens** the proposal on #1972 rather than weakening it: a dimension that
returns 3 or 1 at random on an identical empty-response routing pass is not measuring
anything, and scoring it `N/A` loses no signal. It also means **the 4-of-6-flat figure in
this document's opening table is a property of the committed corpus, not a stable
property of the suite** — re-derive it with `make judge-report` rather than quoting it.

`ut_010` remains 1/1, but it is not the same case: it is the `grade_on_invariant` test
where the model does the classification in-body, so there is real output to grade.

---

## F11 — a `Tool Arguments` deduction whose own rationale awards full credit

**Did:** `ut_conflict_resolution_008`, run `v1_2026-08-27_15-11-46`, `base/Tool Arguments`
= **2**. The rationale's closing sentences:

> "This represents a single clean recovery from validation errors—the tool told Claude
> exactly what was wrong, and the retry succeeded with correct args. **Per the recovery
> policy, this scores full credit.**"

**Should:** a rationale concluding "scores full credit" should carry score 3. This
deduction is the sole reason `ut_008` is `partial` rather than `pass`.

**Gap — lane 2, global.** The recovery policy lives in the base judge prompt, not in this
skill's `rubric.md`, so the wording is not this dive's to change. Filed with F9's proposal
on #1972 for the lead.

**Underneath it is a real tooling observation, worth its own look:** the skill called
`research_query` with an `assertionId` filter three times and got a validation error each
time — that filter is not supported — before recovering with an unfiltered call. The
recovery was clean, but three wasted calls on a filter a skill plausibly expects to exist
is a tool-surface question, not a skill defect. Not chased here; noted for whoever picks
up `research_query`.

---

## Lane-2 fixes made in this PR

Owned by this dive per the guide ("For lane 2 findings you own: the fix, made") and issue
#1652 ("For grading defects you own (`judge_context`, `rubric.md`): the fix, made").

1. **`eval/tests/unit/conflict-resolution/three-conflict-prioritization.json`** — the
   `judge_context` bullet that named `c_001` as the correct first choice is replaced with
   one that names the *criteria* SKILL.md gives and leaves the answer open, and a second
   bullet asks the judge to check what the skill says about `c_001`'s dependence on the
   open `c_002` if it resolves `c_001` first. Fixes **F4**; makes **F3** gradeable.
2. **`eval/tests/unit/conflict-resolution/rubric.md`** — three edits, each adding a way a
   dimension can fail that the corpus actually exercises:
   - `Source independence analysis`: a derivative of a source already in the conflict must
     be named even when it is not in `competing_assertion_ids` (the `a_007` / `src_002`
     Ancestry index of the same 1850 census, which no run has ever mentioned).
   - `Evidence weighing`: **fail** when the weighing contradicts the independence finding
     on the same write, or when it rests on an informant identity, relationship or
     firsthand knowledge the record does not establish. Fixes the grading half of **F1**
     and **F5**.
   - `Resolution completeness`: **fail** when a competing assertion is treated as settled
     while an unresolved identity conflict covers its person-link. Fixes the grading half
     of **F3**.

   No word counts were added to the rubric. Length is arithmetic and belongs in **V2**,
   not in a dimension an LLM has to eyeball — that is how a dimension ends up scoring 3
   forever.

3. **The Iberian naming pre-edit** to
   `packages/engine/plugin/skills/conflict-resolution/SKILL.md` (:339), carried over from
   closed issue #1617 per DallanQ's comment on #1652. Not a finding of this dive; it rides
   this dive's eval run because one clause of prose cannot pay for a run of its own.

## What is deliberately not changed

- **No SKILL.md prose beyond the settled pre-edit.** Every behavioural finding here is
  against a rule the body already states — in three cases (F2, F7, F8) the skill obeys the
  rule in one test and breaks it in another within the same run log. The guide's
  instruction is the one being followed: "if the rule was there and was ignored, restating
  it is not the fix."
- **No fixture edits.** F6's three inconsistent scenarios are shared with other skills'
  suites; correcting them belongs with V5's guard, which will name them.
- **No base-rubric or global-judge-prompt edit** (F9) — global, so the wording is proposed
  and the lead calls it.
- **No file on issue #1823's Touches list.**
