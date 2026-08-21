# Deep dive: timeline — findings and validator requests

Issue #1655. Guide followed: `docs/skill-deep-dive-guide.md`.

**Corpus read:** all five committed run logs,
`eval/runlogs/unit/timeline/v1_2026-07-08_15-47-10.json` through
`v1_2026-07-29_20-42-37.json` — 9 tests × 5 runs = 45 runs, 30 of which wrote a
timeline, 152 persisted events. Transcripts and `tool_calls` read before any score.
Prohibition list: `timeline-prohibition-list.md`.

**Starting numbers, verified:** 39 pass / 4 partial / 2 fail. Across the five
`.ann.json` files, **281 annotated dimensions, 0 score corrections** — no annotator
changed a single score in five annotation passes. The **7 comments** are all in the
`07-08` file, from one annotator, and split three ways: two on `place_distance` not
being called (`_001`, `_002` — F1's subject, though not F1's defect, see there), three
on `ut_timeline_008`'s misroute, and **two on `ut_timeline_003`** disputing a
Correctness/Completeness 1 for a *correct* decline. That last pair looks like a live
grading defect and is not one — see "Two things already fixed upstream" below.
Nothing in the human record touches F2–F9.

**Two things already fixed upstream, checked rather than assumed.** (1) The `_003`
1/1 — judge rationale *"The test is marked as NEGATIVE — the timeline skill should
have declined this"*, annotator reply *"routing to the correct skill IS the expected
behavior"* — happened only in `07-08`, the one run with a different
`judge_prompt_hash` (`adea6e4cb2c9`; the other four share `30747842dbdf`). `_003`
scored 3/3 in all four later runs, and `f067c2f1a` (2026-08-13) then wrote the rule
into the judge prompt explicitly: *"An empty response from the skill under test, with
the correct other skill named in 'Skills Claude invoked', is the **pass** condition on
those tests."* So it is historical, not a defect the suite passes today, and it gets
no F-number. (2) Worth recording alongside it: **all five run logs are judge-stale** —
every `judge_prompt_hash` differs from the current prompt — which is rule 2b,
warn-only.

**One caveat on the judge half of every `mid-research-flynn` quote below.** That
scenario's `README.md` is pasted into the judge prompt as `{scenario_readme}`
(`orchestrator.py`'s `_load_scenario_readme`, into the `scenario_readme` slot that `judge.py`'s `render_prompt_parts` fills), and `7a78e4ffb` (2026-08-12) rewrote it from
"4 sources" to "9 sources … deliberately unworked" — *after* the newest run log. So
the **skill** behaviour quoted throughout still stands (it is read from
`tool_calls` and `file_changes`), but the **judge** rationales on `_001`, `_003` and
`_009` were produced against a scenario description that has since been corrected.
That affects F7's Identity-coherence 3 and F2's `_001` Gap-detection 3 as evidence of
*judge* behaviour; neither finding rests on the rationale, and both rest on the
persisted field.

The grep the issue prescribed returns 0 files — confirmed. The score-branch leak in
this skill takes a different shape: three `judge_context` blocks and two rubric
dimensions pointed the judge at the *reply* for a rule that lives in a *persisted
field*, and the judge then credited the field with what the reply said (F2, F3, F7).

**Dimensions that never discriminate — 3 of 9, as the issue said:**

| dimension | score distribution across 45 runs |
|---|---|
| rubric / Chronological ordering | 3 × 30 (never scored on the 15 negative runs) |
| rubric / Gap detection | 3 × 30 |
| rubric / Deferral of logical-impossibility detection | 3 × 12 (dimension added 2026-07-29) |

A fourth is worse than non-discriminating: **Geographic feasibility** carries an
explicit "mark this dimension N/A when the pair is not distance-sensitive"
instruction, and the judge scored it **3** on all four positive tests where the only
long-distance pair has ~5 years between its events. It reported coverage on four
tests that cannot exercise it, and it scored 3 on the run that *fabricated* the
distance (F1).

---

## F1 — A distance the skill computed itself, persisted as a tool result. Two runs, both all-3s, both human-confirmed.

**Did:** `ut_timeline_001`, run `v1_2026-07-21_16-41-07` —
*"`place_distance` is not available — I'll compute Ireland → Schuylkill County from
the returned coordinates (Ireland 53.0°N, 8.0°W; Schuylkill 40.7°N, 76.2°W) using the
Haversine formula: **≈ 5,150 km**."* The persisted 1850 census event carries
`distance_from_previous_km: 5150`. `output.tool_calls` for that run contains
`place_search`, `place_search`, `research_append` — **no `place_distance` at all**.
`ut_timeline_002` in the same run persisted `5139` the same way, also with zero
`place_distance` calls.

**Should:** SKILL.md Step 3.5 Phase 2 — *"call `place_distance({ standardPlace1,
standardPlace2 })` with the two `standard_place` names and write its `kilometers`
onto the later event's `distance_from_previous_km`"*, and the only value the skill
may supply itself is `0` for two events sharing one `standard_place`. Prohibition 25.

**Gap — lane 2, and the most consequential grading hole in the suite.** Both runs
scored Correctness 3, Tool Arguments 3, Geographic feasibility 3, outcome `pass`, and
the annotator (`edesonchristopher@gmail.com`) confirmed every one of those 3s with no
comment. The reason nothing looked: **timeline has no tool-usage dimension at all**.
The harness has been saying so on every positive test —
`missing_tool_usage_dimension` appears in `output.warnings` for all six positive
runs of the latest log.

**The contrast is null-vs-invented, not available-vs-unavailable.** `place_distance`
fixtures are absent from `_001`/`_002` in **all three** of the `07-08`, `07-19` and
`07-21` runs — they were added between `07-21` and `07-29`. So the tool could not be
called in any of the three. The first two left `distance_from_previous_km: null`,
which is what Step 3.5 requires; the third wrote 5,150 km. The judge scored
Geographic feasibility **2** on the two null runs and **3** on the invented one, so
the only signal in the pipeline moved the wrong way, and the number is what moved it.

The 07-08 annotator commented on those 2s — *"place_distance tool was available in
fixtures but not called. Implicit reasoning about trans-Atlantic feasibility isn't
sufficient when the tool exists"* — and **confirmed the score rather than correcting
it** (0 of 281 corrections across the five passes). The comment's own premise is also
wrong: no `place_distance` fixture was loaded for that test. So the human record
contains a note adjacent to F1's subject, written against a misreading of the
fixture list, and nothing that touches the fabrication itself.

Genealogically: `distance_from_previous_km` is the input to the one impossibility
judgement this skill owns. A number that came from the model's own arithmetic reads
identically to one that came from the FamilySearch Places API, and 5,150 vs 5,400 km
is the kind of difference that decides a travel-feasibility call at the margin.

> **Validator request V1 — every persisted place and distance traces to a tool response**
> **Rule:** in a produced timeline, each non-null `standard_place` must equal a
> `standardPlace` value returned by a `place_search` / `place_search_all` call in the
> same run; each `distance_from_previous_km` must be `null`, or `0` where the event
> and its predecessor share one non-null `standard_place`, or a `kilometers` value
> returned by a `place_distance` call in the same run.
> **Where to look:** `output.tool_calls` (each entry names its `response_fixture`;
> the bodies are in `eval/fixtures/mcp/`) and the produced timelines in the
> after-state.
> **Why it is not judgment:** both sides are literal strings and numbers; nothing
> about the distance's reasonableness is being assessed.
> **What a violation looks like:** `ut_timeline_001` and `ut_timeline_002`, run
> `v1_2026-07-21_16-41-07` — `5150` and `5139` persisted, zero `place_distance` calls
> in either run.

---

## F2 — Six persisted gaps send the researcher after the 1890 census. Gap detection scored 3 every time, three times while crediting the opposite.

**Did:** `gaps[].expected_events` contains `"1890_census"` in **six distinct persisted
gaps across four of the five runs** — `ut_timeline_007` (`07-19`, `07-29_08-30`,
`07-29_20-42`), `ut_timeline_005` (`07-21`), `ut_timeline_006` and `ut_timeline_002`
(both `07-29_20-42`). Seven `research_append` calls carry one, because `_007`'s
`07-19` run wrote the same gap twice; six is the count of distinct gaps and the one to
use.

**Should:** SKILL.md Step 4 — *"Note: 1890 census was mostly destroyed by fire."*
`expected_events` is defined two paragraphs earlier as *"the record types that should
fill it"*. A destroyed census fills nothing. Prohibition 31.

**Gap — lane 2 for the grading, lane 4 for the attractor in the body.** The judge did
not merely miss it; it wrote the opposite. `ut_timeline_006`, `07-29_20-42`, Gap
detection 3: *"The 1880–1908 gap (1890 and 1900 censuses expected, high severity)
**acknowledges the 1890 census destruction**."* It does not — the array lists it.
`ut_timeline_002`, `07-21`, Gap detection 3: *"The skill correctly notes that the 1890
census destruction is expected and not counted against research."* And the same test's
`07-29_20-42` rationale is the plainest of the three, crediting the array itself:
*"expected_events listing marriage, 1870/1880/**1890**/1900 censuses … specific record
types that should fill the gap."* Each time the skill said the right thing in chat and
listed it in the field, and each time the judge graded the sentence rather than the
array. This is exactly the "said the right thing and wrote something else" case the
guide sends you to `file_changes` for.

Genealogically it is not cosmetic. `expected_events` is the negative-evidence
worklist — the whole point of Step 4 — and a `high`-severity gap whose worklist
includes an unrecoverable record set overstates what remains searchable. Note the
cost lands on the human reader and the viewer, not on another skill: nothing in any
other `SKILL.md` reads `expected_events` today.

**Fixed in the body** by removing the attractor rather than restating the rule: the
enumeration listed 1890 and then caveated it in a trailing note, and the enumeration
is the half that got used. It now reads *"Every 10 years (1850, 1860, 1870, 1880,
1900, 1910, 1920). 1890 is absent from that list because it was destroyed — it can
never fill a gap, so it never appears in `expected_events`."* Same line count.

> **Validator request V2 — `expected_events` names only record sets that survive**
> **Rule:** no `gaps[].expected_events` entry may name a record set that does not
> survive to be searched. Keep the destroyed-set list as data so it can grow; the
> standing US case is the 1890 federal census (match `1890` adjacent to
> `census`/`cen`, case-insensitive, so `1890_census`, `"1890 census"` and
> `"census 1890"` all hit). Naming the surviving 1890 *veterans schedule* explicitly
> is fine and must not be flagged.
> **Where to look:** the produced timelines' `gaps[].expected_events` in the
> after-state.
> **Why it is not judgment:** membership in a closed literal list. Whether the *rest*
> of the worklist is well chosen stays with the judge.
> **What a violation looks like:** `ut_timeline_006`, run `v1_2026-07-29_20-42-37` —
> `gaps[2].expected_events: ["1890_census", "1900_census"]`.

---

## F3 — A two-people verdict whose contradiction survives in prose but not in the chronology.

**Did:** `ut_timeline_006` (`identity-two-lives`), run `v1_2026-07-29_20-42-37`. The
reply is unambiguous: *"## Identity-Test Result: **FAIL** ❌ … | **Birth year** |
~1845 (age 5 in 1850; age 15 in 1860) | ~1832 (age 38 in 1870; age 48 in 1880) | …
These are **two different men named Patrick Flynn**."* The persisted `t_002` has six
events and **no `~1832` Pennsylvania birth event**:

```
~1845       birth   Ireland                        [a_002, a_009]
1850        census  Schuylkill County, Pennsylvania [a_003, a_004]
1860        census  Schuylkill County, Pennsylvania [a_010]
1870        census  Schuylkill County, Pennsylvania [a_015, a_016]
1880        census  Schuylkill County, Pennsylvania [a_018, a_019]
1908-03-12  death   Schuylkill County, Pennsylvania [a_011, a_013]
```

`a_015` and `a_018` are the two `~1832` / Pennsylvania birth assertions — the entire
basis of the verdict. They were absorbed into the 1870 and 1880 census events. The
other four runs all persisted the `~1832` event as its own first row. Identity
coherence scored **3 in all five**, and the annotator confirmed the 3.

**Be precise about what survived.** The two census `description` strings do carry the
finding — *"I3 enumerated age 38, head of household; birthplace Pennsylvania —
implies birth year ~1832"* and the same for 1880 — so a reader who reads the prose
does see two men. What is gone is the finding's presence **in the chronology itself**:
no `~1832` row, no `conflict_ids`, nothing on the `~1845` birth event marking it as
contested. The sorted event list — the structure the viewer renders and the artefact
this skill exists to produce — shows one Ireland-born Patrick Flynn enumerated
smoothly from 1850 to 1880, with the counter-evidence demoted to free text inside two
rows that are about something else. That is a weaker claim than "reads as one coherent
life", and it is the claim the evidence supports.

**Should:** SKILL.md Step 6 — *"This identity-coherence judgment has no persisted
field; your chat reply is its only record"* — which makes `events[]` the only durable
trace of what the verdict rested on. And Step 3 — *"Multiple assertions **from the
same record about the same event** should produce ONE timeline event"*; a birth-year
assertion is not about the enumeration. Prohibitions 18 and 40.

**Gap — lane 2.** The rubric's Identity coherence dimension asks only whether the
reply "named the deciding signals", so a run that names them in chat and dissolves
them in the file is indistinguishable from one that does both. `judge_context` for
`_006` said *"Should build a candidate timeline that aggregates assertions from BOTH
candidate persons"* — which this run technically did, since `a_015`/`a_018` are cited
*somewhere*.

**Does not convert to a validator today, and the reason is V4's.** The rule would be:
where a Mode-B timeline's reply reports a two-people / Fail conclusion, at least one
persisted event must carry the competing value in a structured field. Deciding it needs
the reply, and `run_validators` injects no `text_response` — the same contract change
V4 waits on. Stated here so it is ready if that lands; until then this one is graded,
not checked.

**Fixed in `rubric.md` and the test's `judge_context` as a three-way bar, and the
middle band is the point.** `pass` requires the competing value in a **structured
field** — its own event, or `conflict_ids` / `conflict_note`. `partial` is the
description-only case. `fail` is nowhere at all. The first draft of this fix made the
description form a `pass`, which would have graded F3's own cited run a pass and left
the finding unfalsifiable — a criterion nothing can fail, which is the shape this dive
exists to delete. The three-way split is also the genealogically correct bar: a
competing birth year inside a census row's `description` cannot be sorted, does not
appear in the viewer's date column, and is not readable structurally by the next
skill. It is information the skill retained; it is not chronology, which is the one
thing this skill exists to produce. So `_006`/`07-29_20-42` scores **partial** on this
dimension rather than the 3 it received — a real change, not a restatement.

---

## F4 — 22 events cite an assertion dated to a different year. This is the mechanism behind F3.

**Did:** across the five run logs, 22 persisted events cite an assertion whose own
`date` names a different year than the event's. The recurring one is the 1860 census
event citing `a_009` (`~1845`), in 14 runs. The consequential ones are
`ut_timeline_006` (`07-08`, `07-29_20-42`) putting `a_015`/`a_018` (`~1832`) on the
1870/1880 census events, and `ut_timeline_007` (`07-08`, `07-29_08-30`) putting
`a_015`/`a_018` (`~1845`) there.

**Should:** Step 3's "same record about the same event" rule, prohibition 18. An
assertion carrying its own date belongs to the event of that date; a census-derived
birth-year assertion belongs to the birth event, which is where the same runs
*also* cite it.

**Gap — lane 2, and the fixture is teaching it.** All six Flynn seed timelines carry
exactly this line: `t_001`'s 1860 census event cites `['a_008', 'a_009', 'a_010']`,
and `a_009` is dated `~1845`. The model copies the seed. I did **not** fix the seeds:
`mid-research-flynn` alone is referenced by **123 tests across 20 skills**, and
`flynn-multi-conflict` by 7 across 6 — changing either buys a paid run for every one
of those skills to close a single copied line. V3 below carries a before-state
exemption instead, which makes it fair without touching a shared fixture. If the lead
wants the seeds cleaned, it is a one-line edit per scenario riding on a
whole-corpus run, not on this one.

> **Validator request V3 — a dated assertion is not absorbed into an event of another year**
> **Rule:** an event's `assertion_ids` must not include an assertion whose own `date`
> names a different year than the event's `date`. Exemptions: assertions with no
> `date`; an assertion whose date is a range spanning the event's year; and any
> `(event date, assertion id)` pairing that already existed in the before-state
> timeline of the same `t_` id (so a regeneration is not punished for a seed
> fixture's pattern).
> **Where to look:** the produced timelines' `events[]`, `research.json`
> `assertions[].date`, and the before-state timeline with the same id.
> **Why it is not judgment:** a four-digit-year comparison on two string fields plus a
> set-membership exemption. Nothing about whether the grouping is *sensible* is
> assessed.
> **What a violation looks like:** `ut_timeline_006`, run `v1_2026-07-29_20-42-37` —
> the `1870` event cites `a_015` (`~1832`) and the `1880` event cites `a_018`
> (`~1832`); neither pairing exists in the before-state, and the effect is F3.

---

## F5 — `ut_timeline_004`'s scenario did not hold the state the test asks about.

**Did:** the test's premise is a 1912 deed *"four years after his documented 1908
death (a_011)"*, and its `judge_context` required the deed *"sorted after the 1908
death (a_011)"*. In `flynn-impossibility`, `a_011` was **not linked to I1 by any
`person_evidence` entry** — `pe_005` linked `a_013` (the father relationship from the
same certificate) and stopped there. A skill obeying Step 2 (*"Find all
`person_evidence` entries for the target person … collect the `assertion_id` from
each"*) therefore cannot produce a 1908 death event at all.

Run `v1_2026-07-29_20-42-37` did obey it, and said so:
*"Existing timeline `t_001` needs regeneration — it also included a_002, a_003,
a_008, a_009, a_011 which are not in person_evidence for I1."* Its persisted timeline
has three events (1850, 1860, 1912) and no death. It then flagged the deed against a
death date that appears nowhere in the timeline it wrote. **Completeness 3, Deferral
3, outcome `pass`, annotator confirmed.** The other four runs reached the intended
five-event shape only by ignoring Step 2, and scored the same. The dimension cannot
tell the two apart.

**Should:** prohibition 15, and the guide's own standard — a scenario has to hold the
state its test interrogates. Same shape as the `ut_person_evidence_017` fix in
`a2a51ca4b`.

**Gap — lane 2, fixed.** `flynn-impossibility` is referenced by this one test only,
so the fix is cheap and local: added `pe_008` linking `a_011` to I1 with the same
rationale shape as its sibling `pe_005`. The scenario README was stale for a second
reason — it still instructed the skill to *"flag the 1912 event as a **chronological
impossibility**"*, which #1022 moved to check-warnings — and now states the deferral
behaviour instead. Re-validated: `validate_research_json` returns no errors, and the
runnability gate passes all 9 timeline tests.

**It is four assertions, not one, and it is corpus-wide.** In every one of the six
Flynn scenarios, I1's non-superseded `person_evidence` links exactly `a_001`, `a_004`,
`a_010` and `a_013` (plus `a_014` where the scenario has one). Assertions carry no
person field of their own, so Step 2's gather cannot reach **`a_002`** (~1845 Ireland
birth), **`a_003`** (1850 residence), **`a_009`** (~1845 Ireland, from the 1860
census) or **`a_011`** (1908 death) for any person. Every positive test's
`judge_context` asks for events built from them — `ut_timeline_001`'s first clause
wants *"birth …, 1850 census, 1860 census, and 1908 death"* — and `SKILL.md` Step 3
uses `a_003` as its canonical combine example. So the corpus systematically asks for a
chronology its own `person_evidence` cannot supply, and the only way to score well is
to ignore Step 2.

> **Validator request V7 — a seed timeline's events must be reachable from `person_evidence`**
> **Rule:** in a *scenario fixture*, every `a_*` cited by
> `timelines[].events[].assertion_ids` must be linked by a non-superseded
> `person_evidence` entry to one of that timeline's `person_ids`. A scenario that cites
> an assertion no person links is a corpus defect: Step 2 gathers from
> `person_evidence`, so the seed describes a chronology the skill cannot rebuild, and
> the only way to score well on it is to ignore Step 2.
> **Where to look:** `eval/fixtures/scenarios/*/research.json` — `timelines[]`,
> `person_evidence[]`, `assertions[]`. **Static: no run log, no model call, no cost.**
> This is a lint over the corpus rather than a per-run validator, so unlike V1–V6 it
> can be implemented and enforced without buying anyone a paid run.
> **Why it is not judgment:** an id-set reachability test over three arrays already in
> the file.
> **What a violation looks like:** all six Flynn scenarios before this PR — `t_001`
> cites `a_002`, `a_003`, `a_009` and `a_011`, none of which any `person_evidence`
> entry links to I1. `flynn-impossibility` is fixed here; the other five would fail
> until the whole-corpus decision is taken, which is exactly the visibility that
> decision needs.

**`flynn-impossibility` is fixed in full** — `pe_008`–`pe_011` now link `a_011`,
`a_002`, `a_003` and `a_009` — because it is timeline-only, costs no other skill's run,
and a partial fix would have left `ut_timeline_004` still returning a shorter `t_001`
while its `judge_context` demanded the deed sort after a death event the scenario
could not produce. **`mid-research-flynn` and `flynn-multi-conflict` are not fixed**,
for the reason under F4: 123 tests across 20 skills and 7 across 6 respectively, so
each edit buys a paid run for every one of those skills. They go to the lead with F4's
seed cleanup as one whole-corpus-run decision.

---

## F6 — A regeneration silently deleted two persisted events.

**Did:** same run as F5. `t_001` went from four events to three; `a_002`, `a_003`,
`a_008`, `a_009` and `a_011` stopped being cited anywhere. Because `update` replaces
`events` wholesale, that is a deletion of previously persisted analysis. This run
happened to name what went, in a "Coverage note" — but nothing required it, and the
opposite behaviour (`ut_timeline_001`, every run, keeping unlinked assertions in the
timeline) scored identically.

**Should:** nothing in the body covered this. Step 7 says arrays are *"replaced
**wholesale**"* and that timelines are *"regeneratable — cached analysis, not primary
data"*, but never says what to do when the new gather is a strict subset of the old
one.

**Gap — lane 4, a genuine doctrine gap rather than an ignored rule, so the body gets
one sentence:** *"Name in your reply any event the prior timeline held that this one
drops — a shorter timeline deletes it."* A matching clause went into `_004`'s
`judge_context`.

**This is pre-emptive doctrine, and the token cost is accepted deliberately** — worth
saying plainly, because the same "no violation in the corpus" fact is why F6 gets no
validator, and the two decisions look inconsistent unless the asymmetry is named. A
validator that has never fired reads as coverage and CLAUDE.md rules it out. A body
sentence that has never been needed costs ~20 tokens per invocation and changes
behaviour the first time a regeneration does drop an event — which is a silent
data-loss path in a *production* project folder, not just an eval artefact, and the
corpus already contains a run that took it and reported it only by luck. Different
mechanisms, different failure costs, so the same fact supports both calls. If a future
run drops events silently, that is the violation, and V-next writes itself.

---

## F7 — An identity-coherence verdict issued on a parentage hypothesis, and rewarded for it.

**Did:** `ut_timeline_001`, run `v1_2026-07-29_20-42-37` —
*"**Hypothesis coherence (h_001 — Thomas Flynn as father): Pass** — Ages advance
correctly (age 5 → age 15 over exactly 10 years), geography is stable (Schuylkill
County throughout), **and the death certificate independently names Thomas Flynn as
father**. Three independent sources agree … strong multi-source coherence."* The
07-08 run did the same: *"**Coherence (h_001 — Thomas Flynn parentage): Pass**"*.
`h_001`'s claim is *"Patrick Flynn's father was Thomas Flynn of Schuylkill County"*,
and `t_001.person_ids` is `["I1"]` — one person.

**Should:** Step 6 opens *"When building a hypothesis-testing timeline (Mode B),
evaluate coherence"*, and every branch under it is about identity — *"records cohere
into one plausible life"*, *"conflated identities"*, *"evidence supporting the
merge"*. Nothing there authorises a verdict on parentage, and the handoff rules send
*"User asks to resolve a conflict"* and evidence weighing to conflict-resolution:
*"Do not attempt weighing evidence within this skill."* Prohibitions 1 and 39.

**Gap — lane 2 *and* lane 4.** The judge scored Identity coherence **3** and wrote
*"The response aggregates both candidates' assertions and names the deciding signals
clearly, supporting a one-life conclusion"* — there is one candidate, and no one-life
question was asked. The rubric heading said "(hypothesis-testing timelines)" and the
skill's Mode B triggers on `hypothesis_id` being present, so a parentage-labelled
timeline walks straight into the identity machinery.

The lane-4 half was missed on the first pass and matters more than the grading half:
**the body does not actually restrict the verdict**. Step 6 opened *"When building a
hypothesis-testing timeline (Mode B), evaluate coherence"* and Step 8's report list
said *"**Coherence** (Mode B hypothesis test): the Pass / Fail / Inconclusive
verdict"* — neither mentions identity, so the skill was following its instructions.
Grading it down without fixing the body would have penalised compliance. Both lines
now carry the qualifier, and Step 8 says to omit the verdict for a parentage, marriage
or other relationship hypothesis.

Genealogically this is the worst-behaved finding of the set, because chronological
coherence *cannot* support parentage. Ages advancing ten years between two censuses
and a county staying the same are true of every man in Schuylkill County; they say
nothing about whose son he was. The user is handed "Pass" on a parentage hypothesis —
proof-conclusion's output — on the strength of a chronology that could not have
falsified it.

**Does not convert to a validator today, same blocker as F3 and V4.** The rule would
be: where a timeline's `hypothesis_id` names a non-identity hypothesis, the reply must
contain no Pass / Fail / Inconclusive conclusion about it. That is a literal-phrase
check — the guide's seventh convertible shape — but it reads the reply, which the
validator contract does not expose. Stated so it is ready when V4's change lands.

**Fixed** in `rubric.md` (Identity coherence now scopes itself to identity questions,
marks N/A elsewhere, and treats a verdict on a non-identity hypothesis as a fail) and
in `_001`'s and `_002`'s `judge_context`.

---

## F8 — 23 of the 30 timeline-writing runs re-render the persisted timeline in chat. Nothing grades output economy.

**Did:** `ut_timeline_007`, run `v1_2026-07-21_16-41-07` — nine `|`-delimited rows
keyed on the persisted event dates. `ut_timeline_002`, run `v1_2026-07-29_20-42-37` —
a per-event walkthrough carrying the distance ladder verbatim: *"**1850 census** …
(Ireland → Schuylkill, **5,400 km**) · **1860 census** … (same county, **0 km**) ·
**1908 death** … (**0 km**)"*. `ut_timeline_004`, same run — a full
`| Date | Event | Source |` table of all three persisted events. Nineteen runs echo
the non-zero distance for a pair they had just called feasible.

**Should:** Step 8, twice, by name. *"In your FINAL chat response, do NOT reproduce
the persisted content — the full event table, the distance ladder, or a per-event
walkthrough."* And *"Do NOT re-render every event row or the distance ladder in chat
— the events, places, and distances are persisted and the viewer renders the full
chronological table."* Prohibitions 44–45.

**Gap — lane 2, and deliberately not a body edit.** The rule is already in the body,
stated twice, with its reason (latency is ~linear in tokens generated). Per the guide,
restating an obeyed-nowhere rule makes the prompt longer and changes nothing. No
rubric dimension covers output economy and none is added — the 5-dimension cap is
full and this is exactly the mechanical check a program should own.

> **Validator request V4 — the reply does not re-render the persisted timeline**
> **Rule:** `output.text_response` must not contain a per-event rendering of the
> timeline it just persisted. Flag (a) two or more `|`-delimited lines each containing
> a persisted `events[].date` value, and (b) **two or more** distinct
> `distance_from_previous_km` values echoed in the response — that is the distance
> ladder. One distance is exempt: Step 8's *Anomalies* bullet invites naming a single
> figure when reasoning about feasibility, and flagging that would penalise the
> behaviour Step 5 requires. Exempt (b) entirely on tests tagged
> `geographic-feasibility`.
> **Where to look:** `output.text_response` and the produced timeline's `events[]`.
> **Why it is not judgment:** substring search for values already extracted from the
> persisted object. Whether the summary reads well stays with the judge.
> **Harness change required — size this one differently from V1/V5.**
> `validator_runner.py::run_validators` injects only `before_state`, `after_state`,
> `tool_calls`, `skill_frontmatter`, `skills_invoked`, `blocked_context_calls`,
> `blocked_protected_writes` and `test`. There is no `text_response` and no validator
> in `eval/harness/validators/` reads the reply, so V4 needs `text_response` added to
> `available_args` and threaded from `orchestrator.py` — a contract change, not just a
> new `test_*` function. If that is unwelcome, V4 becomes a sixth rubric dimension
> instead, which needs a slot (see the note under F8). Every other request here fits
> the existing contract.
> **What a violation looks like:** `ut_timeline_007`, run `v1_2026-07-21_16-41-07` —
> nine table rows keyed on persisted event dates; and `ut_timeline_002`, run
> `v1_2026-07-29_20-42-37` — `"5,400 km"`, `"0 km"`, `"0 km"` in order, which is the
> distance ladder.

---

## F9 — An unresolved conflict left unmarked on an event that cites one of its competing assertions.

**Did:** `ut_timeline_002`, runs `v1_2026-07-08_15-47-10` and `v1_2026-07-19_03-22-09`
— the 1860 census event cites `a_009`, one of `c_001`'s three competing assertions,
and carries `conflict_ids: ["c_002"]` with no mention of `c_001`. Both runs are
`partial`, so this is the weakest finding here; it is recorded because it is the only
mechanical handle on `_002`'s central requirement.

**Should:** Step 5 — *"If those are already captured as `c_*` entries, reference them
from the affected event via its `conflict_ids` / `conflict_note` field"*. Prohibition
35, and `_002`'s own `judge_context`: *"the timeline should show this ambiguity rather
than silently picking one."*

**Gap — lane 2, addressed by a `judge_context` clause** stating that "showing the
ambiguity" is a claim about the persisted event, not the reply, so a `place` that
states one side while the reply calls it "provisional" has still picked a side where
it counts. Largely subsumed by V3 — once `a_009` stops being cited on the 1860 event,
both violations vanish — but V5 catches the general case.

> **Validator request V5 — an unresolved conflict is marked on the events it governs**
> **Rule:** where the before-state `conflicts[]` holds an entry with no
> `preferred_assertion_id`, any produced event citing one of that conflict's
> `competing_assertion_ids` must name the conflict's `c_*` id in its `conflict_ids`.
> **Where to look:** before-state `conflicts[]`; produced `events[].assertion_ids` and
> `events[].conflict_ids`.
> **Why it is not judgment:** an id-set intersection followed by a membership test.
> **What a violation looks like:** `ut_timeline_002`, run `v1_2026-07-19_03-22-09` —
> the `1860` event cites `a_009` (competing in the unresolved `c_001`) with
> `conflict_ids: ["c_002"]`.

---

## Backfill for the retired dimension

`Chronological ordering` scored 3 on all 30 write-runs and is retired in this PR (see
below). Its two halves are covered: sorting by
`test_events_chronologically_ordered`, and date-certainty coding by nothing. Across
152 persisted events there are **0** offenders, so this is a guard replacing a
dimension, not a finding — and per CLAUDE.md whoever implements it must break the
corpus and watch it fail before committing it.

> **Validator request V6 — `date_certainty` matches the date's precision**
> **Rule:** an event whose `date` carries an approximation or directional marker
> (`~`, `c.`, `abt`, `before`, `after`, `<`, `>`, or a `YYYY-YYYY` range) must not have
> `date_certainty: "exact"` — it must be `approximate`, `estimated` or `calculated`.
> An event built from a directional-qualifier assertion (`before 1850` → `1849`) must
> additionally carry a note about the conversion in `description`, per Step 3.
> **Where to look:** the produced timelines' `events[].date` and
> `events[].date_certainty`; and the source assertion's `date` for the directional
> case.
> **Why it is not judgment:** a pattern match on one string against a closed enum.
> **What a violation looks like:** none in the committed corpus — this replaces a
> rubric dimension that scored 3 thirty times out of thirty and could therefore never
> report one.

---

## Measured: what the two paid runs showed

The grading changes were not shipped on argument. Two full runs plus two
single-test probes, $6.42 total, all after the edits above.

**Two runs, not the one the issue budgeted, and that overrun is mine.** The issue is
explicit: the edits buy *one* `make eval-skill SKILL=timeline` run, and *"Batch every
finding into that one run — that is the whole reason this is one task per skill rather
than one per defect."* Every finding *was* batched into run 1; the second run exists
because run 1 exposed a bug in a fix of mine, not because anything was left out. Total
$6.42 against a ~$9 budget for one run plus annotation, so it is inside the money — but
it cost a second annotation pass, which is the scarcer half. The cheap-probe discipline
limited the damage: the two $0.5 single-test probes are what confirmed the fix before
the second full run, rather than a third full run discovering it.

**Run 1 — `v1_2026-08-21_14-07-10`, 7 pass / 2 fail, $2.79. Superseded and
inactive; read the caveat below before using its scores.**

It did the job it was for: the dimensions started discriminating. `ut_timeline_005`
returned **five non-3 scores in one test**, where this suite had produced none on a
positive test in five prior runs outside `_004`/`07-21`. `Geographic feasibility`
returned N/A on the four tests with no distance-sensitive pair instead of a bogus 3.
The `missing_tool_usage_dimension` advisory disappeared.

**But its `_005` failure was my own grading bug, not a skill defect**, and that is
the caveat: `_005`'s Correctness 2, Tool usage 2, Geographic feasibility 2, Deferral 2
and **Identity coherence 1** in run 1 are artefacts of a rubric since revised. The
`_005` reply contained no instance of `Pass`, `Fail`, `Inconclusive`, `verdict` or even
`coherence`; the clause fired on *"casts meaningful doubt on whether a_014 belongs to
this Patrick Flynn"*, which is the **Step-5 coherence signal Step 5 requires**, not a
Step-6 verdict. Two of the 2s were judge misreads the dimension invited — it marked
Tool usage down while conceding *"This is correct per the rule"*, and its own sentence
*"the distance is recorded between the census and the prior event, not between the
baptism and the census"* is self-refuting, because the census's prior event **is** the
baptism.

Fixed by defining the term: a verdict is an explicit Pass / Fail / Inconclusive — or
supported / ruled-out — conclusion **about the hypothesis**, and a Step-5 signal
(infeasible pair, out-of-lifespan record, doubtful attribution, a `pe_*` confidence
question) is required behaviour and never a deduction. Plus two reading rules the judge
had got wrong: `distance_from_previous_km` is the distance from the immediately
preceding event, and the travel-feasibility finding has no persisted field, so the
structure is never marked down for "not reflecting" it.

**Run 2 — `v1_2026-08-21_14-34-37`, 8 pass / 1 fail, $2.67. Active; this is the
record.**

| | run 1 | run 2 |
|---|---|---|
| `_005` Identity coherence | **1** | **N/A** |
| `_005` Tool usage / Geographic feasibility / Correctness / Deferral | 2 / 2 / 2 / 2 | **3 / 3 / 3 / 3** |
| `_001` `_002` `_004` `_006` `_007` | unchanged | unchanged |

`_005` recovered on two independent samples (a $0.49 probe and run 2), so the
Geographic-feasibility result is not confounded by the hedge that was absent from the
probe's reply. The judge reasons in the new terms unprompted: *"The skill did not issue
an explicit Pass/Fail/Inconclusive verdict on h_001 itself. The reply's observation …
is a Step-5 coherence signal."*

**Three findings are now confirmed fixed by measurement rather than by inspection:**

- **F5.** `_004` persists five events — `~1845` birth, 1850, 1860, 1908 death,
  1912 deed — the chronology its own `judge_context` describes and which was
  unreachable before `pe_008`–`pe_011`. Its skill time also dropped 229s → 170s.
- **F7.** `_001`, `_002` and `_004` all return Identity coherence **N/A** in run 2,
  and none issued a parentage verdict: the `SKILL.md` qualifier held. The `_005` false
  positive was the clause, not the skill.
- **F3.** `_006` persisted the `~1832` Pennsylvania birth as **its own first event**
  in run 2, so the new bar's `pass` criterion is met and Identity coherence 3 is
  correct. The defect did not recur; what the three-way bar buys is that a recurrence
  is now detectable instead of scoring 3 either way.

**Two things the runs did not fix, deliberately.** `_008` fails in both runs, and F4's
seed-taught year mismatch is still visible — run 2's `_006` 1860 event cites `a_009`
(`~1845`), exactly the copied line held for the whole-corpus decision.

---

## F10 — checked, and it dissolves. Recorded because the check is the finding.

**Did:** `ut_timeline_003` and `ut_timeline_009` scored Correctness 1 / Completeness 1
in run 2, with outcome `pass` — a third consecutive observation under the current judge
prompt. The genealogist annotated run 1's cells and **confirmed** both:
*"Although timeline correctly avoided resolving the birthplace conflict itself, it
produced no user-facing response explaining that the request belongs to
conflict-resolution"*, and *"completeness requires communicating that timeline cannot
resolve the conflict and that conflict-resolution should be used."*

**Should:** prohibition A5 — *"On a negative-routing turn the skill must call no tools
at all"* — which both runs satisfy (`tool_calls: []`). Beyond that there is no rule to
cite, and that absence is the finding: the guide's own hand-back rule says *"Do not edit
the base rubric or the global judge prompt. Those are global."* The behaviour graded here
belongs to neither this skill's body nor its rubric.

That reading is reasonable and it looked like the dive's ideal find — a defect on a
passing test. It is not one, and the field that settles it is `activated`:

```
ut_timeline_003: activated=False  turns=0  skills_invoked=['conflict-resolution']  text=''
ut_timeline_009: activated=False  turns=0  skills_invoked=['proof-conclusion']     text=''
ut_timeline_008: activated=False  turns=1  skills_invoked=[]                       text='I'd be happy to help…'
```

**On `_003` and `_009` the timeline skill never ran.** The router delegated before it
loaded, so the empty `text_response` is an unfilled output slot, not a silent decline —
the user-facing answer came from the routed-to skill, which the harness does not
capture in that field. No `SKILL.md` line can instruct a skill that never loads, so
there is no lane-4 fix and no F-numbered defect. This is the "judge misreading a clean
decline" half of the dichotomy in
`orchestrator.py`'s `flag_routing_negative_judge_fail`, whose docstring records the
measured study behind it: replaying 121 committed run logs against the annotations, a
human confirmed the judge's 1 in **20 of 24** eligible cells, and *"there is still no
mechanical discriminator, and gating on empty output is worse than deleting."* The
warning is retained on purpose — *"A judge 1 here is worth a human's eye."* Nothing to
escalate: the lead already decided this on better evidence than a proposal from here.

**`_008` is the opposite case and it is real.** `turns=1`, no routing at all, and a
non-empty reply offering to do the attribution reasoning itself — *"Once I can see
what's in the certificate, I can compare it against what's known about both Patrick
Flynns."* The same docstring records that **all 14** cells with non-empty output were
human-confirmed, because non-empty output from a non-activated skill means the main
thread did the work instead of routing. So `_008`'s 1/1 is right, and the defect is a
routing miss. It belongs on **#1646** as a distinct signature from the flap that issue
was filed on: not "routes to conflict-resolution" but "routes nowhere and answers
inline". Run 1 scored the same test 3/3 on Correctness and Completeness while failing
it on routing, so the cell is flaky in grading as well as in routing.

**Not converted to a validator, on authority rather than for want of trying.**
`flag_routing_negative_judge_fail`'s docstring is the record of someone already
attempting exactly this and measuring the result: *"There is still no mechanical
discriminator, and gating on empty output is worse than deleting"* — 4 of the 24 cells
were human-overridden, all 4 empty/zero-turn, but so were 6 of the 20 confirmations, and
one test carries that identical signature confirmed in two run logs and overridden in
two others. A validator here would be the check-that-cannot-be-right, which is worse
than the check-that-cannot-fail.

**Gap — lane 2, no change made.** The finding here is the check, and it is worth the
words: two of three negatives in this suite carry a permanent Correctness 1 /
Completeness 1 that is correct behaviour, and the one that carries a real defect looks
identical in the outcome column. Anyone reading this suite's dimension scores without
reading `activated` will draw the wrong conclusion in both directions.

---

## Grouping for the paid run

Every edit below is one batch, one `make eval-skill SKILL=timeline` run, one
annotation pass (5 sampled tests, ~3 sentences since PR #1637). No issue is filed:
F1–F9 all land on this skill's single eval slot, and splitting them would buy a second
run for nothing.

**The run logs some requests cite are no longer on disk.** Retention keeps the newest
five candidates and prunes at the writer, so the two runs above pruned
`v1_2026-07-08_15-47-10` and `v1_2026-07-19_03-22-09` with both their `.ann.json`
siblings. V2, V4 and V5 cite examples from them, and F1's annotator quote is from the
07-08 file — the only log that ever carried human comments before this session. They
are committed history, not lost: retrieve one with
`git show 762d1b122:eval/runlogs/unit/timeline/v1_2026-07-19_03-22-09.json`. Whoever
implements a validator against a pre-2026-08-21 example needs that command, which is
why it is written here rather than left to be rediscovered.

**Where V1–V6 go after merge.** They are not left in a document with no owner. The
grouped destination is **one issue labelled `developer` + `nothing-checks`** — that
label is exactly the register `docs/architecture.md` keeps under "What nothing
checks", and all six are missing guards. The guide's route for non-lane-2 items is one
grouped issue, not six, and the CLAUDE.md ladder makes filing the lead's call rather
than mine, so they go in the PR body for him to file or assign. The three held
seed-fixture defects and the paid-run cost note ride on the same card, since the
whole-corpus decision they need is his too.

## Fixes made (this session)

Nine files edited.

**Grading defects I own — `judge_context`:**

| file | change |
|---|---|
| `build-patrick-timeline.json` | F1, F2, F7. Added the place/distance traceability rule; the surviving-record-set rule for `expected_events`; the Geographic-feasibility N/A clause (the only long-distance pair is five years apart); and the F7 clause naming `h_001` as a parentage claim with one candidate person. That last one is **conditional, not a flat N/A**: if the run issued no coherence verdict the dimension is N/A, and if it issued one anyway the rubric fail branch applies. A flat "this dimension is N/A" would have been binding (`judge/prompt.md:186-190`) and would have made the new fail branch unreachable on the one test where F7 recurred. |
| `timeline-with-multi-conflict.json` | F1, F2, F9. Same two rules, plus: "showing the ambiguity" is a claim about the persisted event's `conflict_ids` / `conflict_note`, not about the reply — a `place` that states one side while the reply says "provisional" has picked a side in the only place the viewer reads. Plus a flat N/A for Geographic feasibility and the same conditional clause for Identity coherence, noting that referencing `c_002` is not itself a coherence verdict. |
| `impossibility-after-death.json` | F1, F2, F6, F7. Same two rules, plus the wholesale-replacement clause: a regeneration that returns a shorter timeline has deleted persisted analysis, and is acceptable only if the reply says which events went and why. Plus the Geographic-feasibility N/A clause and the same conditional Identity-coherence clause — its `t_001` also carries `hypothesis_id: h_001`, and once F5's fix makes it a live Mode-C target the rubric would otherwise fail a body-compliant run here. |
| `identity-two-lives.json` | F1, F2, F3, F4. Same two rules, the same-event citation rule, and the Geographic-feasibility N/A clause, plus the three-way visibility bar for a Fail verdict: `pass` where the competing ~1832 birth occupies a structured field (its own event, or `conflict_ids` / `conflict_note`), `partial` where it appears only in an event `description`, `fail` where the persisted events carry it nowhere. |
| `identity-one-life.json` | F1, F2, F4. Same two rules, the same-event citation rule (`a_015`/`a_018` are birth-year assertions and belong on the birth event, not the 1870/1880 census events), and the Geographic-feasibility N/A clause. |
| `geographic-infeasibility.json` | F1, F2, F7. Same two rules — this is the one test where Geographic feasibility is genuinely gradeable, so the traceability rule matters most here, and its existing do-not-penalise clause about the two Ireland strings is untouched — plus the conditional Identity-coherence clause. Its `t_001` carries `h_001` like the rest, and it is the fourth test where F7 is *on record*: `v1_2026-07-19_03-22-09` opens a section *"Coherence verdict (Mode B — h_001 hypothesis)"*. Missing this file would have left the judge to infer the parentage scope unaided on one of the two tests with a documented instance. |

**`rubric.md`:**

- New dimension **Tool usage — place resolution and distance**, graded on the tool
  ledger: every `standard_place` from a `place_search` response, every
  `distance_from_previous_km` from a `place_distance` response or `0` for a shared
  place, and a `fail` for a figure the skill derived itself. `null` is a **pass** both
  where an event lacks a `standard_place` and where the pair needed a distance but no
  `place_distance` response was obtainable, provided the reply says so — that is the
  correct behaviour the 07-08 and 07-19 runs showed, and the first draft of this
  dimension had no branch for it. Makes F1 gradeable and clears the
  `missing_tool_usage_dimension` advisory the harness has emitted on every positive
  test.
- **Gap detection** now grades the persisted array, with a `fail` branch for an
  `expected_events` entry naming a record set that does not survive (1890 as the
  standing case) and an explicit note that a chat acknowledgement does not offset it.
  This was one of the three never-discriminating dimensions; it can now report F2.
  A gap-boundary padding clause was drafted and then **removed**: no finding here
  covers padding, all 30 write-runs write unpadded boundaries, and a criterion nothing
  can fail is the thing this dive exists to delete.
- **Geographic feasibility**: the N/A instruction was already there and the judge
  scored 3 anyway, so it now says N/A is the *required* verdict on a scenario with no
  distance-sensitive pair, and that scoring 3 for a correct call on a five-years-apart
  pair reports coverage the run does not have. The "called a feasible pair
  infeasible" fail branch keeps its meaning without the parenthetical that duplicated
  the N/A rule.
- **Identity coherence** gains a scope paragraph (identity questions only; N/A where
  the hypothesis is parentage or another relationship *and* no verdict was issued; a
  verdict issued there anyway is a fail, F7) and a persisted-visibility requirement on
  the Fail branch — satisfied by a separate event, a conflict field, **or** a
  `description` naming the competing value and its candidate — with a `partial` for the
  case where the persisted events carry it nowhere at all (F3).
- A rubric-wide preamble: grade the persisted timeline, not the narration about it —
  naming the two findings (geographic feasibility, the coherence verdict) that
  genuinely have no persisted field, so the rule cannot be over-applied.
- **`Deferral of logical-impossibility detection` kept, deliberately**, though it is
  `3 × 12` and one of the issue's three non-discriminating dimensions. Retiring it
  would free the last slot for an output-economy dimension and give F8 a home, and I
  am not taking it: its predecessor under the old name `Impossibility detection`
  scored **1** on `ut_timeline_004` in `07-21`, so this axis has discriminated inside
  the committed corpus. Twelve samples across two runs is a thin sample, not a proven
  inert dimension, and the #1022 boundary it grades is the newest thing in this
  skill's contract. `Chronological ordering` is different: 30 samples, one value, and
  both halves independently covered. F8 therefore rides on V4 rather than on a
  dimension — with the harness change V4 needs stated in the request.
- **Retired `Chronological ordering`** to stay inside the spec §7 five-dimension cap
  (`_MAX_DIMENSIONS = 5`, `harness/rubric.py`). It scored 3 on all 30 write-runs; its
  ordering half is already enforced by `test_events_chronologically_ordered` on every
  positive test, and its date-certainty half becomes validator V6. Verified after the
  edit: `parse_rubric` returns 5 dimensions, `has_tool_usage_dimension` is now True,
  and `check_rubric_tool_drift.py` reports no timeline hits.

**Fixture — `flynn-impossibility` (F5), referenced by `ut_timeline_004` only:**

- Added `pe_008`–`pe_011`, linking `a_011` (1908 death), `a_002` (~1845 Ireland
  birth), `a_003` (1850 residence) and `a_009` (~1845, from the 1860 census) to I1 —
  the four dated assertions Step 2's gather could not reach. `pe_008` alone would have
  left the test unable to produce a birth event, so `t_001` would still have come back
  shorter than its own `judge_context` describes. Schema re-validated clean.
- Rewrote the README, which still told the reader a timeline "should flag the 1912
  event as a **chronological impossibility**" — the doctrine #1022 removed. It now
  describes the deferral behaviour and records why `pe_008` exists.

**`SKILL.md` (lane 4, three edits, +409 chars / +68 words):**

- **1890** (F2) — removed the attractor rather than restating the rule. The
  every-ten-years enumeration listed 1890 and caveated it in a trailing note; the
  enumeration is the half that got used. Now instruction-only: *"Every 10 years — 1850,
  1860, 1870, 1880, 1900, 1910, 1920. Never 1890, and never 1890 in
  `expected_events`."* Marginally shorter than what it replaced.
- **Wholesale regeneration** (F6) — one sentence, filling a gap the body did not cover
  at all: *"Name in your reply any event the prior timeline held that this one drops —
  a shorter timeline deletes it."*
- **The coherence verdict is for identity questions only** (F7) — the edit that carries
  the cost, and the one the first pass missed. Step 6's opener and Step 8's report list
  both said "Mode B" with no mention of identity, so the skill was obeying its
  instructions when it graded a parentage hypothesis Pass. Both now carry the
  qualifier, and Step 8 says to omit the verdict for a parentage, marriage or other
  relationship hypothesis. Without this, the rubric change would have penalised
  compliance.

The first two were described in the first draft as "net-neutral on tokens". That was
wrong and unmeasured; the real figure is above, and the third edit is most of it.

**Not fixed, deliberately:**

- **Three seed-fixture defects, copied identically across the six Flynn scenarios**,
  all held for one whole-corpus-run decision by the lead rather than fixed piecemeal:
  `t_001`'s 1860 census event citing `a_009` (`~1845`) (F4); `t_001`'s first gap
  carrying `"start": "1860-01-01"`, which the body prohibits by name (*"Do not pad a
  year to `YYYY-01-01` / `YYYY-12-31`"*) — found while checking the padding clause
  above, and the reason no run violates that rule is that every run *corrected* the
  seed; and **four** dated assertions (`a_002`, `a_003`, `a_009`, `a_011`) linked to
  I1 by no `person_evidence` entry (F5, fixed in `flynn-impossibility` only).
  `mid-research-flynn` is referenced by 123 tests across
  20 skills and `flynn-multi-conflict` by 7 across 6, so each edit buys a paid run for
  every one of those skills. V3's before-state exemption keeps that validator fair
  without the first edit.
- **`place_search_all`** is in `allowed-tools` and was called **0 times in 45 runs**.
  Not a defect — `place_search` is the right call for every place string in this
  corpus — but no timeline test exercises the grant, so nothing would notice if it
  broke. Noted, not acted on.
- **`ut_timeline_008`'s flap** — per the issue's own pointer, the cause is the
  `ut_person_evidence_017` corpus inconsistency tracked on #1646. Not re-derived. It
  passed in four of the five committed runs here.

## Cost note

The run-log snapshot for `v1_2026-07-29_20-42-37` was **already inactive before this
session's edits**. `diff_snapshot_vs_disk` reports two drifted files:
`packages/engine/plugin/skills/timeline/SKILL.md` — from `c1fc2a4c2`, which deleted
the dead `model:` frontmatter pin, so the drift is behaviourally neutral and the run
log still reflects current behaviour — and
`eval/fixtures/scenarios/mid-research-flynn/README.md`. The edits above therefore do
not *buy* the paid run; one was already owed. They should still ride on it as a single
batch.

## Verification

Static, re-run after every revision:

- `eval/harness` pytest: **2459 passed, 3 skipped**.
- `packages/engine/mcp-server` packaging suite: **504 passed** (24 files). One failure
  was earned and fixed en route: `doc-links.test.ts` rejected two `file.py:LINE`
  citations in this document, which now cite symbols.
- `check_rubric_tool_drift.py`: 59 repo-wide hits, **0 in timeline**.
- `parse_rubric`: **5 dimensions**, `has_tool_usage_dimension` **True**.
- `check_runnable` over all 9 timeline tests: **all runnable** — no abort at the gate
  that stopped the citation dive's first post-fix run at $0.
- `validate_research_json` on the edited `flynn-impossibility/research.json`: **no
  errors**.

Empirical, and the part that decides whether any of this works — see "Measured: what
the two paid runs showed" above. Run 2 (`v1_2026-08-21_14-34-37`) is the active log:
`diff_snapshot_vs_disk` returns clean against the working tree, and run 1 is inactive
on the seven files revised after it.

**Still outstanding, and it is not mine to do:** run 2 has no `.ann.json`. Its
`review_sample` reseeded to `_001, _002, _005, _007, _008`, overlapping run 1's
annotated set only on `_001` and `_002` — whose scores are identical, so those transfer
in substance. `_005` and `_007` are all-3/N-A confirmations. `_008` carries Correctness
1 / Completeness 1 and so needs written comments under rule 3. Annotations are written
only by the CRUD UI; per `eval/CLAUDE.md` they are never hand-authored, and this PR
cannot go green until that pass is done.
