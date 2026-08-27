# search-external-sites — deep-dive findings (2026-08-26)

Issue #1648. Branch `1648-deep-dive-search-external-sites`, built against
`abd76bb8`.

Evidence base: **five committed run logs** for this skill
(`v1_2026-08-10_07-55-38` through `v1_2026-08-24_09-59-31`), spanning two
judge-prompt hashes, 73 base and 58 rubric dimension gradings, 48
`external_links_search` log entries and 24 generated URLs. Four of the five
logs carry annotations.

The Step 1 prohibition list is
[`search-external-sites-prohibition-list.md`](./search-external-sites-prohibition-list.md)
— 74 rules, for the next auditor.

---

## F4 (headline) — the skill overrides a resolved conflict, and the rubric grades that by accident

This is the finding the dive exists for. It has three parts, in three
different lanes.

### The project state gives an unambiguous answer

`eval/fixtures/scenarios/mid-research-flynn/research.json` carries one
`conflicts[]` entry:

```
c_001   disputed_attribute: "birthplace"
        status:             "resolved"
        preferred_assertion_id: "a_002"          (Ireland, 1850 census)
        competing_assertion_ids: [a_002, a_009, a_012]
        resolution_rationale: "Ireland is accepted as the birthplace. The
          1908 death certificate birthplace of 'Pennsylvania' is rejected
          as a likely error by the son-in-law informant …"
```

A full GPS conflict resolution: independence analysis, weighing analysis,
a preferred assertion, a written rationale, `status: resolved`. Pennsylvania
is not an alternative view — it is a value this project examined and rejected.

### The skill encodes the rejected value about a third of the time

**Figures corrected 2026-08-27** after PR #1954 review (florencemashipei). The
first version of this section said "7 of 24". Both halves were wrong: the
numerator conflated *non-Ireland* (7, which includes one `Massachusetts` URL
belonging to a different scenario and subject) with *the rejected value* (6),
and the denominator pooled two run logs that retention has since pruned along
with post-fix runs. Re-measured over exactly the run logs this branch commits,
counting only `mid-research-flynn` URLs:

| | Flynn URLs encoding a birthplace | encoded the rejected value | |
|---|---|---|---|
| **Pre-fix** (`v1_2026-08-20_21-55-13`, `v1_2026-08-20_22-45-06`, `v1_2026-08-24_09-59-31`) | 15 | **5** | **33%** |
| **Post-fix** (`v1_2026-08-26_23-13-30`, `v1_2026-08-27_00-08-56`) | 9 | **1** | **11%** |

The five pre-fix misses are `_002` three times, `_009` once and `_007` once.
The single post-fix miss is `_002` on `v1_2026-08-27_00-08-56`.

`_fhk` and `_pic` are excluded from both rows: they run on
`ma-state-census-external`, which carries no `conflicts[]`, so their
`Massachusetts` value is an ordinary parameter and correct.

**Read this as directional, not settled.** Nine post-fix observations is a
small sample, and the one miss is on the test most prone to it. The honest
claim is that the rate moved from about a third to about a tenth, not that the
defect is closed. What would settle it is V1 in issue #1950, which decides the
question deterministically instead of by rate.

**Why it is harmful, not cosmetic.** These sites *filter* on birthplace.
A search for a man born in Ireland, run with `birthplace=Pennsylvania`,
returns nothing — and this skill's own step 6 then logs that nothing as
`outcome: "negative"`, which is GPS exhaustiveness evidence. A rejected
informant error, entered as a search filter, becomes a permanent record
saying a collection was searched and held nothing. Two researchers running
the same skill against the same project get different searches and different
absences on file.

`SKILL.md` says nothing about `conflicts[]`. It was never told to look.

### The rubric catches it only where a test author hard-coded the answer

On the 2026-08-24 run, two tests encoded the same wrong value:

| Test | Encoded | base/Correctness | rubric/URL generation |
|---|---|---|---|
| `_007` | `birthplace=Pennsylvania` | **3** | **3** |
| `_002` | `birthplace=Pennsylvania` | **2** | **2** |

Identical behaviour, opposite grades. The only difference is that `_002`'s
`judge_context` names the answer and `_007`'s does not:

> `_002`: "…so encoding the subject's actual birthplace — Ireland, per
> assertions a_002 and a_009 — is correct."

> `_007`: no mention of birthplace at all.

Four of fifteen tests pin a birthplace in `judge_context`; eleven do not. So
this axis is graded on 27% of the corpus, by accident of who wrote which test
file. `rubric.md`'s URL generation dimension — the dimension that should own
it — says only "includes all relevant search parameters from the plan item",
which a Pennsylvania value satisfies.

### What this dive changed, and what it hands off

**Lane 4 (skill prose) — done on this branch.** `SKILL.md` step 3 now carries
the rule, keyed on the section that already holds the answer:

> **Check `conflicts[]` before encoding a place or date.** If a `conflicts[]`
> entry names that field in `disputed_attribute`:
> `status: "resolved"` → encode the value from `preferred_assertion_id`, and
> only that value … Any other status → the fact is still contested. **Omit the
> field.**

*A correction inside this dive, left visible.* The first version of this edit
said only "a contested fact is an uncertain parameter — omit it," with no
resolved/open split. That was wrong on this fixture and would have failed
tests `_001`, `_002` and `_004`, whose `judge_context` all reward encoding
Ireland — the rule would have told the skill to omit a field the project had
already decided. It was caught by reading `c_001` rather than the test files,
and rewritten before any paid run. The rule is better for it: it now tells the
skill to read `conflicts[]`, which nothing in `SKILL.md` previously did.

**Lane 2 (eval) — done on this branch.** The answer moved out of per-test
`judge_context` and into `rubric.md`'s URL generation dimension, where it grades
all fifteen tests instead of four. The dimension now instructs the judge to read
`conflicts[]` for an entry naming the field, and gives three outcomes: a
resolved conflict makes `preferred_assertion_id`'s value correct and a rejected
competitor a **fail**; an unresolved one makes omitting the field correct and
silently picking a side a **partial**; no conflict entry means grade it as an
ordinary parameter. The wording is fixture-agnostic — it names no place — so it
carries to any scenario.

Two `judge_context` blocks were trimmed to stop pre-deciding the grade
(`ancestry-census-search.json[0]`, `myheritage-url-generation.json[1]`). Each
keeps its genuinely test-specific content and loses only the answer:

- `_001` keeps the distractor warning — this scenario's **research objective
  text still echoes the rejected birthplace** — but now points at the rubric
  rather than naming the correct value. That trap is the reason the test
  exists and would have been lost by deleting the note outright.
- `_002` keeps the MyHeritage template limitation (`birth_place` is the only
  location field, so a county or residence value belongs nowhere in that URL)
  and the "do not penalize the absent county parameter" guard.

`_004` and `_006` were left alone: both mention a place, but neither pins a
conflict answer — `_004` lists FindMyPast's expected parameter names, `_006`
rules out record-site parameter style on Newspapers.com.

**Validator — V1 in issue #1950.** Fully mechanical: read `conflicts[]`,
find entries with `status: "resolved"`, and assert no generated URL encodes a
value from a rejected `competing_assertion_ids` entry. No judge, no prose, and
it binds on every test rather than 27% of them.

---

## F1 — two of six reference files are unreachable

`references/research-log-protocol.md` (82 lines) and
`references/validation-protocol.md` (16 lines) are named by **nothing**: not
`SKILL.md`, not `rubric.md`, not any of the 15 test files, not each other.

```
$ for f in references/*.md; do echo "$(basename $f): $(grep -c $(basename $f) SKILL.md)"; done
evaluating-compiled-sources.md: 3
places-guidance.md: 1
repository-types.md: 1
research-log-protocol.md: 0      ← 82 lines, unreachable
search-strategy-external.md: 3
validation-protocol.md: 0        ← 16 lines, unreachable
```

98 lines that ship into the VM on every install and are never read.

**This is a re-derivation, not a discovery — and the existing account is
better.** Issue #1112 owns it repo-wide and has a walker: measured again on
2026-08-21, **18 unreachable files under `plugin/skills/*/references/`,
53,027 bytes.** DallanQ posted the `search-external-sites` half on issue #1779
on 2026-08-21, five days before this dive re-found it, including the part this
dive missed on its first pass — that `search-full-text`'s copy is unreachable
too, so PR #1758's filter-traceability rule "has never reached a running skill."

Recorded here because the dive must state what it found, but **nothing is filed
and no comment is owed**: #1112 holds the verdict on whether each copy is
deleted or re-wired, and #1779 already carries the sequencing note. The one
thing this dive adds is the count for this skill specifically — two files, 98
lines, one of which (`research-log-protocol.md`) duplicates logging discipline
that step 4 and step 6 now state inline.

The content is not worthless. `research-log-protocol.md` covers exactly the
logging discipline that step 4 and step 6 spell out inline. That is the
question for whoever picks this up: delete it as dead weight, or delete the
inline duplication and name the reference. Doing neither is what costs 98 lines
for nothing.

## F2 — SKILL.md documents a call shape the model no longer uses

`research_log_append` gained a batch `ops[]` form on 2026-07-26. `SKILL.md`
documents only the flat single-call form, twice (step 4's two code blocks).

In the 2026-08-24 run, **10 of 12** `research_log_append` calls used `ops[]`.

Nothing is broken — the batch form satisfies the two-entry rule step 4 asks
for, and every validator passes. The cost is that the worked example a reader
edits is not the shape that runs, so a future correction to the logging rules
gets written against a form the model has stopped emitting. Worth one edit to
the example; not worth a run of its own.

## F3 — the curated-links fetch is logged as a nil when links came back

Of the 48 `external_links_search` log entries in the corpus, **9 carry
`outcome: "negative"` with `resultsExamined: 2`** — links were returned and the
fetch was recorded as having found nothing. Six different tests, four of the
five run logs:

```
2026-08-10 _013    2026-08-18 _005/_007/_002    2026-08-20 _007/_006/_013/_005    2026-08-24 _013
```

The model is grading the *search's* usefulness ("none of these links fit my
record type") on an entry whose subject is the *fetch*. The two readings call
for different next steps — "FamilySearch curates nothing for this place" sends
you to a different repository; "FamilySearch curates plenty, none of it
relevant" sends you to widen the year window — and collapsing them loses that
distinction permanently, in the audit trail.

**Fixed on this branch** (lane 4): step 4's log block now carries the rule
inline, with the worked wording for the `notes` field. **Handed off** as V3 in
issue #1950: `outcome` must be `positive` whenever `resultsExamined > 0` on an
`external_links_search` entry. One line of Python, and it would have caught all
nine.

## F5 — three rubric dimensions have never once moved

Full corpus, 58 rubric gradings across five run logs and two judge prompts:

| Dimension | n | Distribution | Ever moved? |
|---|---|---|---|
| rubric/Capture guidance | 58 | all `3` | **never** |
| rubric/Log entry | 58 | all `3` | **never** |
| rubric/Result triage | 58 | 57×`3`, 1×`null` | **never** |
| rubric/Tool selection | 58 | 57×`3`, 1×`2` | once (`_005`, 08-20) |
| rubric/URL generation | 58 | 56×`3`, 2×`2` | twice (`_002`, both F4) |
| base/Completeness | 73 | all `3` | **never** |
| base/Correctness | 73 | 71×`3`, 2×`2` | twice (`_002`, both F4) |
| base/Tool Arguments | 73 | 58×`3`, 1×`2`, 14×`null` | once (`_005`, 08-20) |

`make judge-report SKILL=search-external-sites` flags six of eight on the
latest log alone.

So the entire discriminating power of this skill's rubric is **two markdowns on
one test, both of them F4**. Everything else is a row of threes.

### The deletion analysis, per `rubric-critic` § "What to flag" §1

The agent requires naming what would still catch a regression on the axis
before recommending a delete. Taking them in order of how clear the answer is:

**rubric/Log entry — narrow it, do not delete it.** This dimension is dead
because the validators got there first, item by item:

| Log entry bullet | Already caught by |
|---|---|
| "No log entry" (fail) | `test_positive_appends_external_site_log_entry` |
| "wrong site" (fail) | the five `test_log_site_*` validators |
| `url_generated`, `capture_received: false` (pass) | `test_url_generation_log_entry_shape` |
| "`completed`/`skipped` while a capture is outstanding" (fail) | `test_capture_pending_item_not_terminal` (#1226) |

Seven of the nine validators in `test_search_external_sites.py` exist to assert
what this dimension's bullets describe. What no validator covers is its
*partial* bullet — an entry that is present but vague ("searched records"
without site or year), and a narration that contradicts the status it wrote.
That half is genuinely judge-shaped. **Recommend:** strip the pass and fail
bullets that duplicate the validators, keep the vagueness-and-narration axis,
and say in the dimension text that the mechanical shape is gated elsewhere so
the judge stops re-confirming it.

**rubric/Result triage — a fixture gap, not a rubric defect.** No test in the
corpus supplies a capture. The dimension's own text concedes it: "Most tests
end at URL generation, before any capture exists … a clean deferral is a
**pass**, never a partial." Every turn in the corpus is a no-capture turn, so
the dimension is *specified* to return 3 every time. It cannot move by
construction — `rubric-critic` flag #3, "a dimension no test could ever fail
on." Deleting it would remove grading for the whole second half of this skill's
workflow (steps 5 and 6, roughly 90 lines of `SKILL.md`) at the moment someone
finally writes a capture-present test. **Recommend:** keep it, and add the
capture-present test. As an interim, its own text already permits `null` on a
no-capture turn — making `null` the instruction rather than the permission
would turn 57 meaningless threes into honest N/As and stop the flatness from
masking the gap. That interim is not free: per `eval/CLAUDE.md`, a rubric
`null` on a positive test is the top-priority signal for the review sample's
targeted slot, so it would claim that slot every run for a reason already known.

**rubric/Capture guidance — rewrite so it can fail; do not delete.** Nothing
else catches this axis. There is no validator asserting capture-workflow text,
and the base dimension that would nominally cover it (Completeness) is itself
73 for 73. The axis is real — a capture instruction that omits the
scroll-to-bottom step produces a truncated PDF, which is one of the five rows
in `SKILL.md`'s own "Handling capture problems" table. It is flat because the
bar is "instructions exist and name specific record types", which every run
clears. `rubric-critic` is explicit that where nothing else would catch the
axis, the answer is to rewrite the dimension so it can fail rather than delete
it. **Recommend:** raise the bar to the four steps `SKILL.md` actually
prescribes — lazy-load scroll, print-to-PDF, upload, and the login-wall retry —
so an instruction missing one of them scores partial.

**rubric/Tool selection — keep, watch.** One movement in 58, on `_005`,
coincident with `base/Tool Arguments` moving on the same test-run. That is one
data point and it produced no signal a base dimension did not already carry. Not
enough to act on either way; another two run logs will settle it.

**base/Completeness — not this skill's to fix.** 73 for 73 here. It is a base
dimension, project-global, and `rubric-critic` routes those to the maintainer
rather than proposing an edit. Recording it as an observation with a question
attached: is base/Completeness flat across other skills' corpora too, or only
where the mechanical half is already validator-gated as it is here?

**Note for whoever applies any of this:** deleting or rewriting a dimension
moves the skill's weighted mean, because the changed dimension's scores enter
or leave the denominator. Trend comparisons across that boundary are not
like-for-like, and the run log that follows should say so.

## F6 — nothing in this repo has ever loaded a URL this skill generates

The skill's entire product is a URL, and no check anywhere — harness, CI, eval,
Vitest — ever requests one. The mock MCP server returns fixtures; the judge
reads the URL as text; the validators assert the string is non-empty. A site
that renamed a query parameter would break every search this skill produces and
turn every subsequent nil into false absence evidence, with all eleven required
checks green.

This is a `nothing-checks` gap in the strict sense, and it is not fixable in
CI — these sites prohibit automated access, which is the reason the skill exists
in this shape. What *is* mechanisable is the half that does not need the
network: the five URL templates in `SKILL.md` name their parameters explicitly,
so a validator can assert every key in a generated URL's query string is one
that site's template documents (V5 in issue #1950). That catches a swapped
parameter name — `birth_place` sent to Ancestry, which expects `birthplace` —
which loads fine and silently ignores the filter. It does not catch the site
changing its own API. Nothing offline can.

The only real signal for that is a human clicking a generated URL and recording
what came back. **That is the one genealogical call this dive cannot make for
you**, and it is why the URL-template rows in the prohibition list are marked
uncheckable.

## F7 — the shared "writes only what it owns" helper has zero call sites

`eval/harness/validators/validators_lib.py` exports
`assert_only_writes_to_sections(before, after, owned, …)`. Repo-wide, **nothing
calls it.** `assert_log_append_only` fares slightly better: one caller,
`test_research_plan.py`.

Meanwhile `search-external-sites`'s `SKILL.md` states its section boundary
twice — "This skill writes only `log[]` entries and the plan-item status" and
"It does not write source or assertion entries" — and the boundary with
`record-extraction` is load-bearing (it is the whole reasoning behind the
`external_site` scoping in the #1519 fix). Two lines of Python would bind both
statements. V7 and V8 in issue #1950.

## F8 — a scheduling collision with #1933, filed today

**Read this before looking at the next run log for this skill.**

Issue #1933 (opened 2026-08-26, `developer`, unassigned) reports that
`ut_search_external_sites_008` now fails every run because the skill never
fires through the Skill tool — `activated: False`, `skills_invoked: []` — while
**every graded dimension scores 3**. Three runs on 2026-08-26 reproduce it,
including one on a clean `HEAD`. The `SKILL.md` snapshot hashes identical to the
two runs that passed on 08-20 and 08-24, so nothing in the repo changed.

In all five committed run logs this dive read, `_008` shows `activated: True`
and `pass`. So the flip is newer than the committed corpus, and the next paid
run of this suite will show `_008` red for a cause this branch did not create
and cannot fix. Say so in the PR body; a reviewer reading a red `_008` next to
four dirty snapshot files will otherwise read it as a regression from this work.

---

## F9 — step 2b never runs on nine of eleven search tests

Found by running the prohibition list mechanically against all 15 runs of
`v1_2026-08-26_23-13-30`, after the annotation pass agreed with every grade.

`SKILL.md` step 2b is mandatory and load-bearing:

> Before you present any external-site result as a source, run
> `collections_search` for the same place and window … **Never present a
> competitor as the source for a collection FamilySearch holds.** Ground any
> statement about which collections or census years exist in this
> `collections_search` result, never in memory.

**It was called in 2 of the 11 URL-generating runs.** The nine that skipped it
are every test on the `mid-research-flynn` scenario; the two that made the call
are `_fhk` and `_pic`, the only two on `ma-state-census-external`.

That split tracks the fixture declarations exactly:

| Scenario | Tests | Declares a `collections_search` fixture | Called it |
|---|---|---|---|
| `ma-state-census-external` | `_fhk`, `_pic` | yes (`collections-search-massachusetts-census`) | 2 of 2 |
| `mid-research-flynn` | nine | **no** | 0 of 9 |

`collections-search-schuylkill.json` and `collections-search-pennsylvania.json`
both already exist in `eval/fixtures/mcp/`. No Flynn test lists either.

`_002` and `_fhk` are the cleanest pair: near-identical prompts ("Generate a
MyHeritage search URL to look for …"), same skill, same step. One ran step 2b,
one did not.

**Not proven, and the distinction matters.** Two scenarios against nine is a
correlation, not a cause — the model cannot see which fixtures are declared, so
something else may drive it. The next step is falsifiable and cheap: add
`collections-search-schuylkill` to the Flynn tests' `mcp_fixtures` and
re-measure. If they then call it, this is a corpus gap. If they still don't,
step 2b is a skill defect and the prose needs strengthening.

**The annotation is not at fault, and neither is the judge.** `rubric.md`'s
Tool selection dimension enumerates `place_search` → `external_links_search` →
`research_log_append` and **never mentions `collections_search`**. A `3` is
correct against the rubric as written. The gap is that the rubric does not grade
a mandatory step, which is a third instance of this dive's recurring shape: the
rule exists in prose, and nothing that grades or checks anything knows about it.

Deliberately **not** fixed on this branch. Either repair — declaring the
fixtures or extending the dimension — is inside the run-log snapshot and buys a
second paid run for a question this run cannot answer anyway.

## F10 — a FindMyPast parameter the skill invented (CONFIRMED, live)

`_004` generated a FindMyPast URL carrying **`yearofbirthrange=5`**, which is
not one of the seven parameters `SKILL.md`'s FindMyPast template documents.

**Resolved 2026-08-26 by loading the URL in a browser** — the only correctness
signal that exists for this skill's output, and the one thing no CI job here can
produce.

The generated URL:

```
https://www.findmypast.com/search/results?firstname=Patrick&lastname=Flynn&yearofbirth=1845&yearofbirthrange=5&keywordsplace=Ireland
```

FindMyPast rendered the search form with **Year Of Birth 1845** and **"Give or
take: ± 2yrs"** — its default. Four parameters bound; `yearofbirthrange`
did not. The skill asked for a ±5-year window and silently got ±2.

The correct spelling, recovered by setting the range in the form and reading
the address bar back:

```
https://www.findmypast.com/search/results?firstname=patrick&lastname=flynn&yearofbirth=1845&yearofbirth_offset=5&keywordsplace=ireland&keywordsplace_proximity=5&sid=999
```

- **`yearofbirth_offset`** is the give-or-take, not `yearofbirthrange`.
- **`keywordsplace_proximity`** is the location radius — its own parameter,
  defaulting to 5. This answers the open question from the screenshot: the stray
  `5` was **not** consumed as a radius. The invented parameter was inert, not
  actively corrupting a different filter.
- **`sid`** is session state and must never be emitted by a generated URL.

FindMyPast's convention is `<param>_offset` for a give-or-take and
`<param>_proximity` for a place radius. The form carries the same dropdown on
Year Of Death and Year, so `yearofdeath_offset` and `year_offset` very likely
follow — **not recorded in the template**, because only the two above are
confirmed by an observed URL and this dive does not write inferred parameters
into a file the skill treats as authoritative.

### Why this one matters more than its size

The skill logs its search as though the ±5 window applied. It did not. A
narrower window than intended returns fewer records; if it returns none, step 6
records `outcome: "negative"` — GPS exhaustiveness evidence generated by a
parameter that was never real.

This is F6 with a confirmed instance. Nothing in this repo — harness, CI, eval,
Vitest — could have caught it, because nothing has ever loaded a URL this skill
generates. **V5 in issue #1950 now has a live reproducing case**, which moves it
from a preventive guard to a confirmed-bug guard.

### Second-order observation, needing a genealogist's read

Every result row in the returned set showed **"—" under Year Of Birth**, against
the record set *Ireland, Directories And Almanacs 1844-1928*. If that collection
carries no birth year at all, a birth-year filter does nothing on it whatever
its spelling — which would make the correct next move a different collection,
not a corrected parameter. Recorded as an open question, not a finding.

### Status

The `SKILL.md` template row is **not yet corrected** — that edit is inside the
run-log snapshot and would invalidate `v1_2026-08-26_23-13-30`, which is already
run and annotated. See "Cost and state".

## F12 — the rubric rule is addressed to a judge that cannot read it

Found in review of PR #1954 by florencemashipei, verified here. **This is F10's
defect turned on this dive's own fix**, and it is the more instructive of the
two.

`rubric.md` now tells the judge to "check `conflicts[]` in the scenario's
`research.json`". The judge never sees that file. Its prompt slots are
`{rubric} {judge_context} {before_state} {scenario_readme} {user_message}
{skills_invoked} {text_response} {file_changes_summary} {tool_calls}
{validator_failures}`, and of those:

- `_summarize_before_state` in `eval/harness/harness/orchestrator.py` renders
  **only `sources`**,
  from research.json and tree.gedcomx.json. Its docstring is explicit that it
  exists for citation-fabrication checks. No `conflicts`.
- `_summarize_changes` renders added/modified/deleted entries; this skill never
  writes `conflicts`, so none appear.
- `builtin_tool_calls` — the model's own `Read` of research.json — is written to
  the run log but not passed to the judge.
- The scenario README names both candidate values and never the winner.

So the judge's only route to `preferred_assertion_id` is **the skill's own
output**. The rule is graded on the defendant's testimony.

The evidence is in the two runs this branch commits:

| Run | `_002` encoded | Skill said | URL generation |
|---|---|---|---|
| `v1_2026-08-26_23-13-30` | `Ireland` | "Ireland per resolved conflict c_001" | 3 |
| `v1_2026-08-27_00-08-56` | `Pennsylvania` | "No conflicts are on file for Patrick's birth year or place" | **3** |

Both scored 3. The judge adopted whichever the skill asserted, including the
false one — `c_001` is on file, resolved, Ireland preferred. The tell was
already present in run 1, where `_004` scored 3 with the rationale "No conflicts
exist in the project for birthplace": right answer, reasoning that contradicts
the fixture.

**What this means for F4's claim.** The lane-2 half of the F4 fix does not bind.
The behavioural half does (the rate moved 33% to 11%), but the rubric cannot
independently catch a violation, and the one live test of that says so. Do not
read this skill's 15-of-15 and 14-of-15 runs as evidence the rubric fails
violations. It has been exercised once and did not fire.

**Where it goes.** Issue #1956 (harness lane, filed by the reviewer) adds a
`conflicts[]` block to `_summarize_before_state`. That file is outside the
run-log snapshot and `judge_prompt_hash` covers only `judge/prompt.md`, so the
fix costs no paid run. Until it lands, V1 in issue #1950 is the only mechanism
that decides this axis, and it decides it deterministically rather than by
persuasion.

## Four rubric-wording gaps the reviewer found, all latent

Recorded here so the next run of this skill can fold them in; none is fixed on
this branch, because the prose is frozen by two paid runs and fixing them later
costs the same single run.

- **`moot` is misclassified.** `conflict_status` is `unresolved | resolved |
  moot`. Both `SKILL.md` and `rubric.md` say "any other status → still
  contested → omit". Per `conflict-resolution/SKILL.md`, `moot` means later
  evidence made the conflict irrelevant, usually because the disputed person
  was someone else. Under a moot conflict the skill would drop the place
  forever and the rubric would mark a correct URL partial. No fixture carries
  one today. Two-word fix.
- **Identity conflicts fall through.** The rule keys on `disputed_attribute`,
  which the schema requires only for `conflict_type: "fact"`; identity
  conflicts carry `null` and put the dispute in `identity_question` free text.
  `flynn-identity-geographic` (c_002, c_003), `flynn-identity-geographic-thin`
  and `flynn-multi-conflict` (c_002) all have them today, and the first is an
  identity conflict *about geography* — exactly the place-parameter risk.
  Either scope the rule to `conflict_type: "fact"` deliberately, or extend it.
- **Two entries can name the same attribute.** `eval/tests/e2e/ferber-grandparents`'s
  reference project has c_001 and c_002 both on `birthplace`. Precedence is
  undefined if their statuses differ. Suggested: any non-resolved entry naming
  the field wins.
- **The `partial` bullet was not updated with the `fail` bullet.** Where an open
  conflict makes omission correct, the old bullet still reads "missing a search
  parameter the plan item specified → partial", contradicting the new block on
  the same page.

A fifth, on the validator rather than the rubric: scoping
`test_no_external_search_or_log_on_routeaway_negative` to `external_site`
entries is right for `_012` but quietly loosened `_011`, which previously
asserted no new log entry of any kind — a real gate, since `research-plan`
never writes `log`. Both share the `no-search-no-write` tag. A second tag on
`_012` would restore it.

## Cost and state

Nothing paid has been spent on this dive. The free half — this document, the
prohibition list, the rubric analysis, and every edit on the branch — cost
nothing.

Seven of the run log's 49 snapshot files are dirty, so the snapshot is stale
and one `make eval-skill SKILL=search-external-sites` is required before merge:

```
packages/engine/plugin/skills/search-external-sites/SKILL.md
packages/engine/plugin/skills/search-external-sites/references/repository-types.md
packages/engine/plugin/skills/search-external-sites/references/search-strategy-external.md
eval/tests/unit/search-external-sites/negative-record-in-hand.json
eval/tests/unit/search-external-sites/rubric.md
eval/tests/unit/search-external-sites/ancestry-census-search.json
eval/tests/unit/search-external-sites/myheritage-url-generation.json
```

Seven files, **one** run — they all sit in the same snapshot, which is why the
F4 lane-2 edit was made before the run rather than after. Deferring it would
have bought a second full run for the same money's worth of signal.

The `rubric.md` changes recommended under F5 — narrowing Log entry, raising
Capture guidance's bar, and the Result triage `null` question — are **not**
applied. Unlike the F4 edit they are not corrections to a wrong grade; they
change what the rubric measures, and doing that in the same run as a behavioural
fix would make the run log unreadable as evidence for either. They should land
with the next iteration, once this run establishes whether the F4 rule holds.

Two things the run will show that are **not** this branch's doing:

- `ut_search_external_sites_008` red on activation — issue #1933, filed
  2026-08-26, reproduced on a clean `HEAD`.
- `_002`'s birthplace grade moving in either direction — that is the F4 rule
  and the rubric change being exercised, which is the point of buying the run.
