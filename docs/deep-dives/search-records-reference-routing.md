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
| Fuzzy place (default) vs. exact place | **tool** — same clause: three-level upward expansion, `.exact` descent unmeasured |
| What place expansion actually costs | delete — already in `SKILL.md`'s "Exact-match qualifiers" and the `birthPlaceExact` description |
| Filter-based place restriction | delete — `f.*Place` is *"not reachable through `record_search`"*; the file said so itself |
| Multi-place / multiple events | delete — cardinality is likewise unreachable; `surnameAlt`/`givenNameAlt` are the only pair, already on the tool |
| Fuzzy date behavior | **tool** — ±2 birth/marriage/death, ±5 any/residence, "state the span as a range" |
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

### `search-strategy-levers.md` — 23,776 → **13,984 B**, 7 reads

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

### `name-search-mechanics.md` — 11,909 → **9,967 B**, 2 reads

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

### `collection-quirks.md` — 8,336 → **5,984 B**, 29 reads (the most-read of the nine)

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

## What nothing checks

- **That the census fetch fires in production.** ADR-0012's Enforcement is
  "None". `test_census_wiki_fixture_actually_used` covers the unit tier only,
  across the 16 tests whose search is a census search.
- **The non-US branches of the Step 2 block.** All 11 census scenarios in this
  suite are US, so `England_Census` and every other `{Country}_Census` ship
  unexercised by the unit suite.
- **The country resolution.** Every census plan item in the corpus is
  `{County}, {State}` and names no country, so the model resolves it. That is
  `docs/architecture.md`'s "the US federal census is the unstated default"
  appearing in the fixture data rather than in a prompt. `search-records` grants
  no place tool, so there is no tool-side resolution available.
