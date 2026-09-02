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
with post-fix runs. Re-measured counting only `mid-research-flynn` URLs the
skill itself emitted — its text response and the arguments it sent, never a
URL echoed back to it in a fixture's `research_query` response, which is a
`log[]` entry the scenario already carried and not something the skill wrote:

| | Flynn URLs encoding a birthplace | encoded the rejected value | |
|---|---|---|---|
| **Pre-fix** (`v1_2026-08-20_21-55-13`, `v1_2026-08-20_22-45-06`, `v1_2026-08-24_09-59-31`) | 15 | **5** | **33%** |
| **Post-fix** (`v1_2026-08-26_23-13-30`, `v1_2026-08-27_00-08-56`, `v1_2026-08-27_12-50-50`) | 13 | **2** | **15%** |

The five pre-fix misses are `_002` three times, `_009` once and `_007` once.
Both post-fix misses are `_002`, on `v1_2026-08-27_00-08-56` and on
`v1_2026-08-27_12-50-50`.

**Provenance of the pre-fix row: all three files are now gone from the committed
corpus.** `DEFAULT_KEEP_CANDIDATES = 5` prunes as new runs land, and the three
pre-fix logs fell off in two waves — `v1_2026-08-20_21-55-13` when
`v1_2026-08-27_12-50-50` was written, then `v1_2026-08-20_22-45-06` and
`v1_2026-08-24_09-59-31` when the two `subscriptions-access-enum` runs landed.
Zero pre-fix logs remain committed, so neither this row nor F12's
`judge_prompt_hash` table can be re-derived from the working tree at all.

Recover them from git history — all three are readable without a checkout:

| File | Commit |
|---|---|
| `v1_2026-08-20_22-45-06` | `25b0f434` |
| `v1_2026-08-24_09-59-31` | `25b0f434` |
| `v1_2026-08-20_21-55-13` | `25b0f434^` |

```sh
git show 25b0f434:eval/runlogs/unit/search-external-sites/v1_2026-08-20_22-45-06.json
```

The 33% is unchanged — it was measured over all three when all three were
present, and nothing about the measurement moved. An earlier note here said the
rate was "3 of 9 over the two surviving pre-fix logs"; that sentence is now void,
since none survive. Quote the three-log figure above and recover the files if you
need to check it.

**What counts as the rejected value, if the table is ever quoted.** Two of the
five pre-fix hits encode `birthplace=Schuylkill+County%2C+Pennsylvania` rather
than a bare `Pennsylvania` — wrong field granularity *and* the rejected value.
They are counted here because a county-qualified Pennsylvania asserts the same
rejected birthplace and produces the same false filter, which is what F4 is
about. On a strict bare-value reading the pre-fix figure is 3 of 15 (20%) and
the movement is 20% → 15% rather than 33% → 15%; both post-fix misses are a
bare `Pennsylvania`, so the two readings converge after the fix. Raised by the
reviewer of
#1954; the counting above is the one this finding rests on, but the distinction
belongs beside the number rather than behind it.

`_fhk` and `_pic` are excluded from both rows: they run on
`ma-state-census-external`, which carries no `conflicts[]`, so their
`Massachusetts` value is an ordinary parameter and correct.

**Read this as directional, not settled, and weaker than it first looked.**
Thirteen post-fix observations is a small sample, and both misses are on the
test most prone to it. The honest claim is that the rate moved from about a
third to about a seventh, not that the defect is closed. **The third post-fix
run moved the figure the wrong way** — 1 of 9 became 2 of 13 — which is what a
small sample does and is the reason this row is quoted with its denominator
rather than as a headline percentage. What would settle it is V1 in issue
#1950, which decides the question deterministically instead of by rate.

**The recurrence is on file, graded.** `_002` on `v1_2026-08-27_12-50-50`
scored **1** on both base/Correctness and rubric/URL generation, and the
annotation confirms both at 1. That is the first time this dive's own headline
defect has been caught by the graded corpus rather than by a human reading
URLs, and it happened only because the same run restored the conflict state to
that test's `judge_context` (F12). The prose rule in `SKILL.md` was in force
for all three post-fix runs and did not prevent it.

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

## F11 — an Ancestry ranking claim I could not support, tested and withdrawn

Raised in review of PR #1954 by Gennecis, tested against the live site, and
resolved by deleting the prose rather than defending it.

An earlier revision of this branch added a per-site override to
`references/search-strategy-external.md`, telling the skill to open on Ancestry
with a **narrow** search where the existing rule says every site gets a broad
first contact. Its stated reason:

> Its engine weights relatives heavily and degrades gracefully: extra
> parameters rank results rather than filtering them to zero, so a full-detail
> search costs nothing and sorts the best match to the top.

Two claims, and only one of them was mine. **"Weights relatives heavily" is
pre-existing doctrine** — `SKILL.md` already carries "Add relative names when
you have them (Ancestry weights them heavily)" and this dive did not touch it.
**"Extra parameters rank rather than filter, so a full-detail search costs
nothing" was new here, and nothing in the repo supported it.** It was also the
load-bearing half: it is the only reason given for overriding the broad-start
rule, on the busiest site in the table.

**Tested on ancestry.com against `mid-research-flynn`'s own subject.** A search
for `Patrick Flynn` alone, then the same search with birth year 1845, birth
place Ireland, and father Thomas Flynn. **The result count reduced.** Pure
ranking returns the same set reordered; a smaller set means the parameters
filter.

That refutes the operative clause. If adding `1845` removes results, then a
record indexing him as 1847, or giving the birthplace as Pennsylvania because
the enumerator wrote where the family lived, is gone from the list — which is
the loss the broad-start rule exists to prevent. "Costs nothing" is exactly
what the test contradicts.

**Gap — lane 4, withdrawn rather than reworded.** The row is deleted and the
section is byte-identical to `main` again. Rewording would mean asserting a
more careful claim about Ancestry's matching that I have not measured; the
per-field **Exact** toggle almost certainly makes the real behaviour
conditional, and a conditional rule stated without measurement is the same
defect one revision later. If a narrow-start override for Ancestry is worth
having, it needs the F10 treatment: run it, read the result, and quote what the
site did.

This one is recorded because the failure is worth keeping, not the fix. The
claim read as mechanism and was reasoning — and it took a reviewer asking "how
do you know that?" to surface it, on a dive whose own headline finding (F10) is
a parameter the skill invented for the same reason.

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

**What this means for F4's claim.** Written before the
`v1_2026-08-27_12-50-50` run and superseded by it; kept because the reasoning
is what the fix was chosen against. At the time, the lane-2 half of the F4 fix
did not bind: the behavioural half moved the rate (33% to 15% over the three
post-fix runs), but the rubric could not independently catch a violation, and
the one live test of that said so. Do not read this skill's 15-of-15 and
14-of-15 runs as evidence the rubric fails violations — on those runs it had
been exercised once and did not fire. The state-form `judge_context` above
changed that: on `v1_2026-08-27_12-50-50` the rubric rule fired at 1, on its
own terms, quoted in the judge's rationale.

**The baseline moved down, it did not stay flat.** Traced by Gennecis in review
of PR #1954 and confirmed by snapshot hash. Before this branch,
`myheritage-url-generation.json`'s `judge_context` named the answer outright —
"encoding the subject's actual birthplace, Ireland, per assertions a_002 and
a_009, is correct" — and that per-test note was the only thing that ever caught
an F4 violation:

| run | `judge_context` | `judge_prompt_hash` | encoded | URL generation |
|---|---|---|---|---|
| `08-20_21-55-13` | answer key | `0d186137147c` | Schuylkill County, Pennsylvania | 3 |
| `08-20_22-45-06` | answer key | `0d186137147c` | Schuylkill County, Pennsylvania | **2 — caught** |
| `08-24_09-59-31` | answer key | `0d186137147c` | Pennsylvania | **2 — caught** |
| `08-27_00-08-56` | rubric pointer | `c39d70034788` | Pennsylvania | 3 — missed |
| `08-27_12-50-50` | **state** | `c39d70034788` | Pennsylvania | **1 — caught** |

The top three rows are no longer in the committed corpus — retention pruned all
three pre-fix logs (see F4's provenance note above for the commits that still
hold them). The bottom two, which are the controlled pair this finding actually
rests on, are both still committed.

**Read the hash column before drawing the comparison.** The three answer-key
runs all predate #1766's judge prompt, so "2 of 3 with the note, 0 of 1
without" spans two judge prompts and is not a controlled pair. The pair that
*is* controlled is the last two rows: same `judge_prompt_hash`, same fixture,
same rubric, same encoded value, differing only in what `judge_context` says.
That pair is what the conclusion below rests on, and it is the stronger
evidence anyway — 3 to 1 on a single variable.

This branch replaced that note with a pointer to the rubric rule, on the
reasoning that a per-test answer key is not fixture-agnostic. That reasoning
still holds, but the pointer alone hands the decision to a rule the judge
cannot execute: a check that was firing 2 of 3 times fired 0 of 1.

**Fixed on this branch, in a third form.** The note now supplies the *state*
rather than the answer: `c_001` on `birthplace`, `status: "resolved"`,
`preferred_assertion_id: a_002` resolved to the value Ireland, competing value
Pennsylvania rejected, and an instruction to grade the encoded `birth_place`
against the rubric rule using that state. On `v1_2026-08-27_12-50-50` this
caught the violation at **1**, harder than the answer-key form's 2, and the
judge's rationale quotes `rubric.md` rather than the note:

> "Per the URL generation rubric, encoding a value that a resolved conflict
> rejected is a fail."

That distinction is the whole point. Under the old note the rubric rule was
decoration and the note did the work; under this one the rule is what decides,
and the note only supplies the fact the rendered before-state omits. The
fixture-agnostic objection is met in substance: no test file states a verdict.

**This doubles as a pilot of #1902's design**, which proposes exactly this
shape for `_summarize_before_state` — hand over the conflict state, resolve
`preferred_assertion_id` to a value rather than an id, and let the rubric
decide. It works. When #1902 lands, the before-state carries this for every
test and the per-test note becomes redundant and should be deleted; until then
it covers one test out of fifteen.

**Where it goes.** Issue #1956 (harness lane, filed by the reviewer) adds a
`conflicts[]` block to `_summarize_before_state`. That file is outside the
run-log snapshot and `judge_prompt_hash` covers only `judge/prompt.md`, so the
fix costs no paid run. Until it lands, V1 in issue #1950 is the only mechanism
that decides this axis, and it decides it deterministically rather than by
persuasion.

## F13 — the surname-drop ladder step, added without a finding and untested

Raised in review of PR #1954 by Gennecis. Recorded rather than removed, with
its coverage stated.

This branch adds a step to the too-few-results ladder in
`references/search-strategy-external.md`: drop the surname and search on given
name, place and date, guarded by "only worth running when the given name is
distinctive".

**The craft is sound and is why it stays.** A married surname on a woman, an
anglicised or misindexed surname, and patronymic naming where the surname does
not carry across records are three real recovery classes, and the ladder had no
step that reached any of them — every other rung loosens a date or a place and
holds the surname fixed. The distinctiveness guard is the right constraint:
given-name-only on John or Mary returns noise, on Bartholomew or Aoife it is
often decisive.

**What it does not have is evidence.** No finding in this dive produced it; it
came from reading the ladder and noticing the gap. **No test reaches it
either** — no test in this suite carries a retry or zero-results tag, so
nothing in the corpus exercises any rung of the ladder, this one included.

**Gap — lane 4, shipped untested and knowingly.** Acceptable here because the
step is *additive and guarded*: it fires only after a search has already
returned too few results, and only when the given name is distinctive, so the
worst case is one extra search that returns noise. It cannot suppress a result
the current ladder would have found. That is a different risk class from F11,
which overrode an existing rule on an unsupported mechanism claim, and it is
why one was withdrawn and this one was not. If the ladder ever gets test
coverage, this rung should be first in line.

## F14 — libraries and archives were described as a clean split

Raised in review of PR #1954 by Gennecis. A correction with no finding behind
it, recorded for completeness.

`references/repository-types.md` framed libraries and archives as distinct
categories — published works on one side, unpublished manuscripts and personal
papers on the other. That is a teaching simplification rather than how the
institutions actually divide.

**Genealogically the split does not hold**, which is the whole reason the
correction was made: research libraries routinely hold manuscript and archival
collections, and an archive will hold the published transcription volume for
the records it keeps. A researcher told to look for unpublished material only
in archives will miss manuscript collections sitting in a library, and the
reverse.

**Gap — lane 4, no measurement and none needed.** The edit changes a heading to
"tendencies, not a clean split" and adds the two overlaps. There is no
behavioural claim to test: it removes a false dichotomy rather than asserting a
new mechanism. Recorded here so the change has a number, per the review, and
because a future auditor comparing the reference against this dive should not
find an unexplained edit.

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
