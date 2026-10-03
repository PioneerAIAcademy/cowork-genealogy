# `search-records/references/` — where all 101 sections went

**Read this before converting `search-records` to an agent (issue #2243).** It is
the per-section record issue #2123 owed, and it is what tells you which of the
three surviving files you are folding and why each one survived.

**Result:** nine files, 90,915 bytes → **three files, 29,935 bytes (−67%)**.
`SKILL.md` 61,270 → 64,412. **Folded artifact 152,185 → 94,347 (−38.0%).**

Routes are ADR-0012's, in its order — **tool, wiki, body, delete**. "Tool" means
the passage now lives in an MCP tool's own description or precondition, where it
binds every caller and costs no retrieval. Read counts are from the committed
e2e corpus (477 run logs) except where marked *unit*, which is
`docs/architecture.md` §3.3's positive-fixture figure.

---

## Deleted — 6 files, 46,567 bytes

### `place-date-mechanics.md` — 17,582 B, 16 sections, **0 reads**

| Section | Route |
|---|---|
| (title) · Place parameters · Date parameters · Relationship parameters · Other parameters | delete — container headings |
| Standardized places | **tool** — `record_search` tool-level PLACES clause |
| Fuzzy place (default) vs. exact place | **tool** — same clause. It carried the deleted file's nominal "three jurisdiction levels" at first; the shipped description now states the measured behaviour instead (a county scope barely discriminates), and `.exact` descent stays unmeasured |
| What place expansion actually costs | delete — already in `SKILL.md`'s "Exact-match qualifiers" and the `birthPlaceExact` description |
| Filter-based place restriction | delete — `f.*Place` is *"not reachable through `record_search`"*; the file said so itself |
| Multi-place / multiple events | delete — cardinality is likewise unreachable; `surnameAlt`/`givenNameAlt` are the only pair, already on the tool |
| Fuzzy date behavior | **tool, minus its figure** — "state the span as a range" is on the tool; the file's "±2 birth/marriage/death, ±5 any/residence" is **not**, and was removed as unsourced. `measured-figures.json` does not carry it and it contradicts the estimate-overlap mechanism `birthYearExact`'s own description states — the same defect as the retired "3 jurisdiction levels" |
| Date granularity | **tool** — only the year is matched; day and month discarded |
| Exact year | delete — `birthYearExact`'s description carries the estimate-overlap mechanics |
| Event types | **tool** — the `birthLike`/`deathLike`/`marriageLike`/`residence`/`any` families, plus "a typed date+place pair must match the same event" |
| Available fields | delete — every reachable relative field is a named parameter with its own description |
| Narrowing behavior | delete — `SKILL.md`'s "Relative-name anchors" block carries it, and each `*Exact` description carries its own half |

The three "unreachable" sections are why this file read zero and why deleting it
loses nothing a caller can act on: they documented upstream constructs the tool
does not expose.

### `census-field-availability.md` — 11,736 B, 20 sections, **0 reads (0/25 unit)**

| Section | Route |
|---|---|
| US federal census · 1790–1840 · 1850 · 1860 · 1870 · 1880 · 1890 · 1900 · 1910 · 1920 · 1930 · 1940 · 1950 | **wiki** — `United_States_Census`, and its own per-year `United_States_Census_{year}` links |
| England & Wales census · 1841 · 1851 onward | **wiki** — `England_Census`, which carries more than this file did (1921, 1931, the 1939 Register) |
| Applying this | **body** — Step 4: state what the schedule recorded, label the rest inferred **for any uncollected field**; a missing field is not a defective record; a blank field that did exist is meaningful; state censuses follow their own schedules; an immigration-year mismatch is not automatically a conflict |
| Phrasing a pre-1880 household | **tool (already)** — `requirePre1880CensusHedge` in `research-log-append.ts` refuses the unhedged claim at the write boundary, and `test_pre1880_census_structure_marked_inferred` grades it. `rubric.md` forbids the judge re-grading it |
| Sources | delete — superseded by the probe table below |

**Read the gate's real scope before trusting it.** It skips Ireland, Canada,
Denmark, Norway, Sweden, Germany and Prussia (`relationshipColumnFrom` → `NaN`);
skips "censuses" plural with no staged payload; skips possessive kinship; covers
no uncollected field other than household structure; and reads `notes` only. It
was narrowed further on 2026-09-29 (PR #3027, issue #2945), which deleted its
whole-note fallback — so an unhedged pre-1880 claim phrased without an adjacent
census year is now caught by nothing in the engine. **That is why the "Applying
this" craft had to be folded rather than booked as covered.**

### `data-collection-standards.md` — 6,587 B, 13 sections, 1 read

| Section | Route |
|---|---|
| Scope of Collection | **body** — GPS Grounding: collect what contradicts the hypothesis as carefully as what supports it |
| Source Classification · Original vs. Derivative | delete — Step 7 already says index entries are derivative pointers |
| Why This Matters for Search | **body** — Step 7: the four index failure modes (transcription error, partial indexing, differing standardisation, lost context) |
| Information Quality Assessment | delete — informant proximity and primary/secondary are `record-extractor` and `person-evidence` lanes |
| Handling Negative Search Results · When absence is meaningful · is NOT meaningful · Recording negative results | delete — Step 8 item 4 already carries the three conditions |
| Evaluating Database Quality Before Searching | **body** — Step 8 item 4(b), which demanded the judgement and gave no method |
| Note-Taking Discipline | delete — `record-extraction`'s lane |
| Evidence Types to Watch For | delete — direct/indirect/negative classification is `person-evidence`'s lane |

### `research-log-protocol.md` — 5,052 B, 4 sections, 2 reads

| Section | Route |
|---|---|
| (title) · Rules | delete — Rules 1, 2, 3, 5 and 7 are already Step 5 |
| Rules → canonical `query` keys | **body** — Step 5. A bare sentence holding an ARK is rejected *before* the tool runs, wasting the turn |
| The fields you supply | delete — every field is a named `research_log_append` parameter |
| When record-extraction writes log entries | delete — another skill's rule |

### `research-log-standards.md` — 4,661 B, 11 sections, **0 reads**

Overlaps `research-log-protocol.md` section for section. Purpose, the nine
elements, the element→schema map, all five Rules subsections and Evaluating Log
Completeness: **delete** — the map points at fields `research_log_append`
assigns itself, and completeness is `research-exhaustiveness`'s job. One line
folded to GPS Grounding: a log holding only positive results is a red flag.

### `validation-protocol.md` — 949 B, 1 section, 1 read

**Delete, folding nothing.** Its entire content is already two bullets under
"Important rules" — the write tools validate before persisting, and
`check-warnings` does not apply to this skill. The file said the second about
itself. It was also the last copy in the plugin.

---

## Kept and slimmed — 3 files, 29,935 bytes

Each survived because no route takes it, and each says below what *would* retire
it. Issue #2243 folds these into the agent body.

### `search-strategy-levers.md` — 23,919 → **13,984 B**, 7 reads

| Section | Route |
|---|---|
| Quick-reference: the `*Exact` qualifiers, and its six subsections | **delete** — a third statement of what the tool description and `SKILL.md` both carry. Its one unique passage (`recordCountry`/`recordSubdivision` are already strict; a nil at one place level does not settle another) went **to the tool** |
| (the `q.*` crosswalk) | **delete** — it existed only because the examples were written in `q.*`; they are camelCase now |
| Default strategy · Decision rules by hit count · Name levers · Place levers · Date levers · Filter levers · Cluster / FAN club levers · Zero-hit escalation priority · "Reasonably exhaustive" exit criteria | **stays** |

**Why it stays:** the ladder is GPS Element 1 made operational — it *is* what
"reasonably exhaustive" means as an instruction. The wiki does not carry our own
API craft (ADR-0012), and nothing in it can be decided from the tool's inputs
and outputs *as a description*.

**What would retire it:** a computed `nextLevers` payload on a nil
`record_search`, which passes ADR-0011's first question — the applicable levers
are a function of the query shape and the result count alone. Deferred
deliberately: it is an engine change, needs roughly twenty nil fixtures
re-captured before the unit suite can see the payload at all, and wants its own
paid run. `docs/architecture.md` §3.3 measured a payload on a call the agent
already makes at 289/289 adoption against a contradicting body, so this is the
stronger channel, not a consolation.

**Do not reflow the lever tables casually.** `tests/packaging/lever-anchor-shapes.test.ts`
parses every Name- and Filter-lever row and runs it through the real
`validateInput`; the per-row "set `recordCountry` or `batchNumber` as the anchor"
phrases and the literal string `"Anchor reminder before using any lever below."`
are load-bearing for it, and a row whose wording stops matching is *skipped*
rather than failed — the `checked.length === 6` pin is the only thing that makes
that visible.

### `name-search-mechanics.md` — 12,021 → **9,967 B**, 2 reads

| Section | Route |
|---|---|
| (the crosswalk, and the `surnameExact`/`givenNameExact` paragraphs) | **delete** — now on the tool |
| Quoted values | **delete** the quoting half — measured inert (`dev/measured-figures.json` §K: an unbalanced quote returns the identical total). Heading **renamed** to "Unsupported syntax" rather than deleted, because the live boolean-operator rule sits under it |
| (four struck-through refuted constraints) | **delete** — summarised in one sentence instead of four dead bullets |
| Wildcards · Default fuzzy matching · Surname-only and given-name-only · Initials · Middle names · Common indexing error patterns · Common nickname equivalences | **stays** |

**Why it stays:** measured FamilySearch index behaviour that is ours, not the
wiki's, and too long for a parameter description. Two passages are load-bearing
and easy to lose: the "watch the results for a misindexed value" paragraph
(a name read *Alonzo* indexed *Alenae*, *Alorysw*, *Alorze*, *Hanzo* — reachable
by no constructible query, so it is a read-the-results technique the wildcard
table explicitly does not cover), and the "Other patterns" block (suffixes,
particles including `M'`, Hispanic dual surnames, per-culture female surnames).

**What would retire part of it — and an open question for the lead.** The
`get_name_variants` MCP tool landed 2026-09-29 (issue #2325) and serves this
file's nickname table almost exactly: 21 formal names, the same variants. **No
skill or agent grants it** — issue #1828 wires it into `search-full-text`, and
nothing owns wiring it here. Wiring it into `search-records` is a behavioural
change on this skill's paid run and was deliberately not folded into #2123. It
is also not a clean swap: the section's operative finding is that fuzzy *reaches*
diminutives but *rank* hides them, so the move is to search the diminutive as its
own `givenName` — which a tool returning forms does not convey.

**The table also cannot simply be deleted.** `tests/packaging/name-variant-drift.test.ts`
parses it in both directions against `config/given-name-variants.json`, and that
config cites it at **21 line numbers** in its provenance notes. It is the
human-readable seed of a shipped config, not only a prompt.

### `collection-quirks.md` — 8,408 → **5,984 B**, 29 reads (the most-read of the nine)

| Section | Route |
|---|---|
| (the crosswalk) | **delete** |
| England parish registers → the batch-number mechanics | **tool (already)** — `record_search`'s `batchNumber` description carries obtain-one, anchors-alone, the `recordCountry` rejection, nonexistent → 0, the 4999 paging cap, partition-by-surname, and the shape variance |
| Ellis Island → the struck wildcard bullet | **delete** — refuted; the "Still useful" bullet is live and **stays** |
| Common collection IDs | **delete** — `collections_search` is the lookup, and the table already said "verify before use" |
| US Federal Censuses · England parish registers (the rest) · Mexico Civil Registration · Mexico Catholic Church Records · Ellis Island (the rest) · US SSDI · German Lutheran/Catholic · Norway Church Books | **stays** |

**Why it stays, and why the wiki is the wrong home specifically here.** These are
per-collection *indexing-error compensations* — how the FamilySearch index
mis-transcribes, measured by us. Issue #2123's 2026-09-01 probe found the wiki
actively **contradicting** this file: "Life After the IGI" tells the researcher
to abandon batch numbers and search by parish name, the opposite of the measured
guidance. Routing this to `wiki_search` would reintroduce refuted claims into the
highest-traffic search skill.

**Load-bearing passages:** the Norway vowel/`-datter`→`-dr` compensation, which
`ut_search_records_023` grades directly; the "static Legacy collections, no
corrections since 2010" note, which is why a nil there is about the extraction
rather than the parish; the FreeREG/FindMyPast cross-check; and the Mexico
Catholic drop-the-principal lever, which is a different lever from the Mexico
Civil Registration one above it.

---

## The wiki probes, run against the sidecar 2026-09-29

`GET {DEFAULT_WIKI_API_URL}/page/{slug}`; counts are `len(response["content"])`.
These are the sidecar's own pre-crawled corpus, not `familysearch.org` — a page
live upstream is not evidence the corpus holds that slug (ADR-0012 records
`Spain_Names,_Personal` as a 404 beside a 17,545-char `Spain_Naming_Customs`).

| Slug | Chars | |
|---|---:|---|
| `United_States_Census` | 33,782 | shipped fetch; matches the committed fixture exactly |
| `England_Census` | 26,351 | shipped fetch; matches the committed fixture exactly |
| `Norway_Census` | 36,987 | reproduces ADR-0012's recorded figure exactly |
| `Luxembourg_Census` | 6,704 | the `{Country}_Census` rule on the issue's own named test case |
| `United_States_Census_1850` / `_1860` / `_1870` / `_1880` / `_1900` | 8,155 / 9,153 / 13,399 / 12,060 / 7,088 | the per-year follow-up link |
| `Luxembourg_Genealogy` / `_Online_Genealogy_Records` / `_Research_Tips_and_Strategies` | 7,455 / 11,090 / 6,015 | |
| `Dalheim_Online_Genealogy_Records`, `Dalheim_Research_Tips_and_Strategies`, `Remich_Online_Genealogy_Records` | **404** | commune and canton level |

Heading names are **not** uniform across the per-year pages — 1870 uses
`## Content`, 1850 uses `## Contents`. Do not write a rule that keys on one.

**Luxembourg, the probe issue #2123 marked required.** Commune and canton pages
404, so the wiki does not fill the locality gap at that level. But the country
page is not thin, and it answers the alpha tester's report directly: the
1843–1900 collection is listed as **images**, not an index, and town-level
indexing began 1860–1870. The plugin ships zero Luxembourg content
(`grep -rni luxembourg packages/engine/plugin/` → nothing), so the fetch gives
the agent a locality fact it has never had, for a place nobody pre-wrote.

## A per-year census page states relationship availability only when the answer is yes

Measured 2026-10-02 against the committed fixtures; the per-year rows
**re-measured live 2026-10-03** against `wiki_read`, after review pointed out
that the original heading generalized from the 1850 page alone.

| Page | `Relationships` stated? | What it says |
|---|---|---|
| `United_States_Census` (33,782 B) | **yes, by date range** | `\| Relationships \| 1880-1950 \|`, plus "Determine family relationships (more recent than 1880 as shown above)" |
| `United_States_Census_1850` (8,155 B) | **no** | Contents lists no relationship field; Value offers only "Identify probable relationships—be careful!" |
| `United_States_Census_1880` | **yes** | Content lists "Relationship to head of household"; Unique Features opens "Asked the relationship to the head of household" |

That asymmetry is the point, and it is worse than "the per-year pages are
quieter". A per-year page records the column when the schedule **had** one and
says nothing when it did not, so silence on an 1850 page is indistinguishable
from an incomplete page — and the pre-1880 years are exactly the ones the
`pre-1880-census-household` validator grades. The 1850 page contains none of
`no relationship`, `relationship to head`, `head of household`, `infer` or
`not stated`; the 1880 page carries `relationship to head of household` twice,
as a thing the schedule *has*. Neither states an absence — only the country
page does, and it states it for every year at once.

This matters because Step 2's second bullet sends the agent to the per-year
page when the country page "does not settle which fields the schedule
collected" — and for *relationships* the country page does settle it. An agent
that follows that bullet on a pre-1880 relationship question reads a page that
cannot answer it.

**Not established: whether this causes a failure.** Across the
`--runs-per-test 3` scratch runs of 2026-10-02, every run that read only the
country page passed (4 of 4: three at `42df8f6d1`, one on branch), and of the
two that additionally read the per-year page one failed — Fisher p≈0.33, which
is no evidence at all. The content gap above is a fact about the corpus; the
causal claim is not, and was not promoted to one. `ut_search_records_012` was
3/3 at `42df8f6d1` and 2/3 on branch with the cause unidentified.

**The per-year fixtures were load-bearing until they were not, and the reason
matters.** They were read as load-bearing here because the branch agent
followed the bullet-2 link in 2 of 3 runs and a missing fixture returns
`fixture_not_found` (a Type 2 miss) that fails Tool Arguments. That read was
wrong: the generic predicate is a case-insensitive **substring** match on
`United_States_Census`, so it already answers a per-year URL with the country
page. `320f4d098` deleted all five per-year entries on that basis, and no
`pre-1880-census-household`-tagged test carries one today — the paragraph above
has been corrected accordingly. What the deletion costs is named under "What
nothing checks" below.

## `ut_search_records_023` flaps at ~55%, and prose is not the lever

Measured 2026-09-30 across **nine** `--runs-per-test 3` runs on three variants of
the Norway entry. The test asks the skill to apply that entry's surname
abbreviation (`Halsteinsdatter` → `Halsteinsdr`); the mock returns the match for
no other shape.

| Variant of `collection-quirks.md` | per-run | aggregate |
|---|---|---|
| As shipped | fail, pass, pass | pass |
| Pointer moved into `SKILL.md`'s Step 2 pre-work block | fail, fail, pass | fail |
| Norway entry restructured instruction-first, provenance last | fail, pass, pass | pass |
| **Pre-slim file restored** (8,408 B, this PR's own cut reverted) | fail, pass, pass | pass |

**7 pass / 5 fail, wording-independent *and* size-independent.** Both
experimental variants were reverted: neither moved the rate, and an unmeasured
prose change is not worth a paid run.

**The pre-slim row settles a question the first three rows could not.** All
three variants above are variants of the *slimmed* file, so none of them tested
whether this PR's own cut (8,408 -> 5,984 B) caused the failures — and `_023`
passed in all 5 committed run logs predating this PR, which reads like a
regression. Measured 2026-10-02 by restoring the pre-slim file into the current
tree and changing nothing else: **identical per-run outcomes**, and the same
bimodal timing (the failing run 408s of skill time, the two passing ones 205s
and 178s). The Norway entry itself is byte-identical across the slimming — one
trailing blank line — so there was no mechanism for the cut to act through. The
5-of-5 pre-PR record is small-sample luck: at the measured ~1-in-3 rate, five
single runs come back all-green about 13% of the time. Issue #3054 stands as
filed; this PR did not cause it.

**This table is the record — the run logs behind it are not committed and cannot
be.** `.gitignore` excludes `eval/runlogs/unit/*/scratch_*.json`, because a
`--runs-per-test` scratch run is by design a throwaway. So the three runs on the
shipped tree (fail, pass, pass → aggregate `pass`, `flaky: true`), which are what
clears the bar issues #2816 and #2243 set, exist only in this table. Re-derive
rather than ask for the file:

```sh
cd eval/harness && uv run python run_tests.py --test ut_search_records_023 --runs-per-test 3
```

The behaviour is bimodal with no middle. A passing run makes **1–2**
`record_search` calls and 12–15 turns; a failing run makes **9–10** calls and
33–41 turns, wandering the generic lever ladder.

Five explanations were tested and refuted:

| hypothesis | how it was tested | verdict |
|---|---|---|
| The reference is never reached | read-rate across all runs | refuted — read in **9/9** |
| Between-file placement (§3.3's 4/25 point-of-use shape) | moved into the labelled pre-work block | refuted — **worse**, 1/3 |
| Within-file prominence (rule was the tail clause of a 130-word bullet) | restructured instruction-first | refuted — 2/3, unchanged |
| Turn or wall-clock budget | `max_turns` vs actual, `aborted_reason` | refuted — runs concluded and escalated, were not truncated |
| The file is read only after the first nil | read position vs first `record_search` | refuted — read at builtin call 1–3 in **every** run, pass and fail alike |

So the rule is reached, early, in every run, and applied in about half of them.
That is an instruction-**following** limit, which `docs/skill-lifecycle.md` states
directly: *"a rule the model reads is not a rule the model follows."*

**What would fix it, and why it is not fixed here.** ADR-0011 and
`docs/architecture.md` §3.3's 289/289 `craftNotes` result both say the same
thing: a rule that must hold arrives on a call the agent already makes, or
becomes a writer-tool precondition. For this rule that means `record_search`
returning the collection's quirks on a nil that carries a `collectionId`. The
data source is the blocker — these quirks live in a plugin file the engine may
not read at runtime (CLAUDE.md, "Don't reference files across the
`mcp-server` and `plugin` directories at runtime"), and encoding them in the
engine is the record-type × country table ADR-0012 rejects. That needs its own
card and a decision, not a fourth prose attempt — filed as issue #3054.

**Read this before re-wording the Norway entry.** Three variants have been
measured; a fourth needs a mechanism, not a rewrite.

## The ARK sentence was innocent; the "Collect impartially" rewording was not

`2fbd2210c` reverted TWO reworded `SKILL.md` lines together and `ut_search_records_027`
went 4-of-5 failing to 3/3, which this PR first attributed to both. That attribution was
collective and wrong. Isolated 2026-10-02, one variable, three runs per arm:

| Collect impartially | ARK sentence | `_027` |
|---|---|---|
| shortened | shortened | fail, fail, pass (and 2 further fails in full runs) |
| original | original | pass, pass, pass |
| original | **shortened** | pass, pass, pass |

The shortened ARK line sits in both a failing and a passing configuration, so it is not
the cause — the "Collect impartially" rewording is. n=3 per arm: three greens do not
prove innocence (at a 1-in-3 rate that happens about 30% of the time), and the strength
here is the controlled comparison, not the sample size.

**What this licenses, and why it is not applied here.** The shortened ARK wording is
behaviour-neutral on the evidence. It was briefly landed on this branch and has been
**reverted**: it was the only snapshot input to change after the release, which reds
rule 2, and this card's own argument is that finding #9 has no path to land here. A
reworded prompt line is not cosmetic enough to carry on a waiver when the release is
already spent, so the measurement stands as the evidence for whoever applies it on the
follow-up (issue #3125) and `SKILL.md` stays at 64,412, byte-identical to the
tree `v2.json` was released against. A reworded third version would not be covered by
this table. The "Collect impartially" line stays as restored and is NOT a candidate for
the same treatment.

## What nothing checks

- **That the census fetch fires in production.** ADR-0012's Enforcement is
  "None". `test_census_wiki_fixture_actually_used` covers the unit tier only,
  across the 16 tests whose search is a census search.
- **The per-year follow-up, now that its fixtures are gone.** The country page
  is a coarse table: it settles relationship availability for every year at
  once, and settles little else. The per-year detail `census-field-availability.md`
  used to carry — the 1890 schedule loss, the 1900 birth-month column, the 1940
  informant marker — is reachable only through the per-year page, which the
  substring predicate now answers with the country page instead. No unit test
  exercises that path any more, so nothing would show if an agent needed that
  detail and silently did without it. Worth watching on the next run rather
  than pre-emptively re-adding five fixtures that measured as a regression.
- **The non-US branches of the Step 2 block.** All 11 census scenarios in this
  suite are US, so `England_Census` and every other `{Country}_Census` ship
  unexercised by the unit suite.
- **The country resolution.** Every census plan item in the corpus is
  `{County}, {State}` and names no country, so the model resolves it. That is
  `docs/architecture.md`'s "the US federal census is the unstated default"
  appearing in the fixture data rather than in a prompt. `search-records` grants
  no place tool, so there is no tool-side resolution available.
