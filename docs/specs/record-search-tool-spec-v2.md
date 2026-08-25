# Record Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's historical record index for
a person. The caller passes clues — a name, a year, a place, the
name of a parent or spouse — and gets back a ranked list of records
that might describe that person, with the key facts on each record
(name, dates, places, family) and links the user can open.

Requires authentication (OAuth tokens obtained via the `login`
tool). Uses the lower-level FamilySearch search service at
`/service/search/hr/v2/personas`.

**Its sibling is `person_search`** (`docs/specs/person-search-tool-spec.md`),
which searches the FamilySearch **Family Tree** — a conclusion graph of
user-maintained tree persons — at `platform/tree/search`. Different endpoint,
different objects: this tool returns records, that one returns tree persons.

The two share **18 identically-named `*Exact` parameters** out of 22 here and 21
there, and the pairing has been a trap: same names, and for a long time two
incompatible stories about what they did. They now mean **the same thing**, stated in
both specs — see *Input → Person fields → The exact-match rule* in either. The
figures behind the rule were measured against **this** endpoint's index; the tree
endpoint has no probe, so `person_search` states the rule on the lead's authority. Four `*Exact` parameters exist
only here (`anyPlaceExact`, `anyYearExact`, `otherGivenNameExact`,
`otherSurnameExact`) and three only there (`fatherBirthPlaceExact`,
`motherBirthPlaceExact`, `parentBirthPlaceExact`).

**When a change touches this family, it touches both tools.** A measurement taken
against one endpoint does not transfer to the other on its own, so measure both
or say which one you measured.

The tool is the **find** primitive of the genealogy toolkit. It
chains naturally with the other tools:

```
places(query: "Alabama")        // confirm which place is meant
  ↓
collections(query: "Alabama")   // find which collections cover it
  ↓
search({ surname, collectionId, ... })  // find a person inside
```

### Anchor rule (design note)

A search must include at least one of these anchor fields:

- `surname`
- `recordCountry`
- `batchNumber`

A search with only `givenName`, only `collectionId`, only a place,
or only a kin name is rejected. The search service throttles
unanchored queries because they're expensive — anchoring on
something that meaningfully narrows the candidate pool keeps the
tool fast and useful.

`batchNumber` joined the list on 2026-08-12. It was deliberately kept
off it when the parameter was added a week earlier — that call was made
before the interaction below was measured, and the measurement reverses
it. Two findings, live against `/service/search/hr/v2/personas` and
reproducible with `dev/probe-batch-anchor.ts` (which derives every
verdict below from its own run, and prints NOT MEASURED rather than a
direction when a leg fails):

- **A batch anchors on its own.** `q.batchNumber` with no other field
  is accepted upstream and returns just that batch's extraction —
  about two thousand records for `B01883-5`, two for `8317102`. It is
  the cheapest filter the API takes, so the cost rationale above never
  applied to it.
- **Requiring a companion field was actively harmful.** The natural
  companion is `recordCountry`, and a country that does not match the
  batch returns **0** — the same signal the docs give for a *wrong
  batch*, so the failure is silent and misreads as an empty parish.
  Batch shape carries no country information at all — `B01883-5` is a US
  batch, and nothing in the token says so. The correct country changes nothing
  (identical counts), so the parameter could only hurt.

Net: send a batch alone. `surname` still narrows within it normally
(`B01883-5` + `Smith` cuts to about three dozen).

---

## Input

Inputs are grouped by purpose. Every field is optional individually,
but the anchor rule above must be satisfied.

### Person fields

| Field | Type | Description |
|-------|------|-------------|
| `surname` | string | Family name. The strongest anchor for genealogy queries. |
| `givenName` | string | Given (first) name. |
| `surnameAlt` | string | Alternate family name (e.g., maiden name when also searching by married name). |
| `givenNameAlt` | string | Alternate given name. |
| `sex` | `"Male"` \| `"Female"` \| `"Unknown"` | Sex of the person. Case-insensitive — `"male"` is normalized to `"Male"`. |
| `surnameExact` | boolean | Restricts the surname to its exact spelling — see the exact-match rule below. Applies to `surnameAlt` too when both are set. **Narrows the count, reorders the records it keeps, and can drop the target**: read over complete sets the exact result is a strict subset of the fuzzy one, so it cannot surface a record a fuzzy search buried (measured on `surname` in marriage populations only). |
| `givenNameExact` | boolean | Restricts the given name to its exact spelling — see the exact-match rule below. Applies to `givenNameAlt` too. Excludes period diminutives (`Betty` for `Elizabeth`); pass a variant as its own `givenName` instead. **The exclusion direction is the lead's (2026-08-17), not measured**: the artifact records only the fuzzy REACH — `N.verdict:diminutiveReach` = REACHED, and section E's membership tests — never that `.exact` drops them. The ruling sourced it, which is why the description states it flatly. |

#### The exact-match rule

One rule, belonging to the search engine rather than to this endpoint — with one
measured exception, on `surname`:

> **Without `exact=on` on a name field**, results include fuzzy matches, and
> records where **that field is empty** — for `givenName` and for a father's,
> mother's, parent's or spouse's name (`other` not measured), but **not** for
> `surname`, where an unqualified value drops surname-empty records outright.
> **With `exact=on`**, whatever its own field admits is excluded.

**What is measured, and what is not.** The relative half is enumerated on this
endpoint for four kinship families: `R.verdict:keep-silent` HOLDS, and the
presence requirement is CONFIRMED in each of
`R.verdict:father .exact requires the relative to be present`,
`R.verdict:spouse .exact requires the spouse to be present`,
`R.verdict:mother .exact requires the relative to be present` (one population —
the other indexes no mother given names at all) and
`R.verdict:parent .exact requires the relative to be present`;
`F.verdict:relative .exact requires the relative to be present` is the
independent father measurement. `other` is the exception:
`R.verdict:other names behave like the four kinship families` reads NOT
MEASURED — excluded by decision, not untried, being a co-occurrence term rather
than a kinship one. The fuzzy half is enumerated too:
`B.verdict:exact surfaces records fuzzy does not` reads NO — exact is a strict
subset.

**The two principal fields behave oppositely, and that is the surprise.** The
artifact leaves this open — `T.verdict:all name fields behave alike` reads *"NOT
MEASURED — the per-field verdicts are withheld under RULE 0"* — so it was measured
directly on 2026-08-20 with the unmatchable-token method R and S validated, via
`dev/explore-name-empty-field-leg-records.ts`:

- **`givenName` keeps them.** Three unmatchable tokens each retain ~251 of a pool of about six thousand (spread under 2%, which is S's control separating silence from fuzzy reach);
  58 of 60 sampled retained rows are given-name-empty, on the typed parts AND on the
  `fullText` cross-check the surname leg below uses — the two agree exactly, so no
  row had a given name misfiled under another part type; `.exact` takes it to 0.
- **`surname` drops them.** A bound surname-empty record — `fullText` "Escolastica",
  one Given part, zero Surname parts — is present in a 1,100-row set read to the end,
  and each of three unmatchable tokens returns an **empty set**. Zero rows, so this is
  not a ranking artifact.

One explanation to rule out, because it is the intuitive one and it is wrong:
**not** "`surname` is a required anchor, so a surname-empty record is never put in
front of you." `surname` is one of three anchors, and the pool above is anchored on
country, type, date and place with no name term at all — 1,100 records, surname-empty
ones among them.

The retention counts and the 1,100-row Brazil pool are not in
`dev/measured-figures.json`; the script is the trail until a probe section records
them. The exact value lives in the artifact, as
`Y.impossiblePools:birth[0].poolTotal`, which re-measures each run — so it is not
pinned here — for the same Pocklington pool.

The lead states the rule as the search engine's rather than this endpoint's, from
FamilySearch internals. See `docs/specs/person-search-tool-spec.md` → *Person fields* → *The
exact-match rule* for what is and is not established there — no probe covers that
endpoint — and for two instrumentation traps specific to it. **The same rule, the same parameter names, the same
meaning** on both tools; that is why it is stated in both specs rather than
cross-referenced from one.

**Two carve-outs.** *Places* are a different mechanism — `*PlaceExact` stops
upward expansion to parent jurisdictions, which is neither fuzz, initials, nor an
empty field. (Whether it still descends to child localities is stated in the
original spec prose but is recorded by no verdict; treat it as unverified.) *Years* are the exception, and the artifact now measures why.
`H.verdict:index-silent personas exist` reads **NO** and
`H.verdict:an unqualified range admits estimate overlaps` reads **YES**: there is
no record carrying "no indexed year". A persona with no year of its own carries an
estimated date *range*, derived from the dated facts of others on the record, and
an unqualified range matches it by overlapping that estimate, while
`.exact` (`H.verdict:.exact requires the indexed date inside the range`) keeps only
records whose indexed date falls inside the range.
`N.verdict:payload-silent means index-silent` reads **NO** for the same reason —
the payload not exposing a year does not mean the index holds none. Measured by a
disjoint-band membership instrument (`dev/probe-search-qualifiers.ts` sections H
and Q) on enumerated pools across four record families plus a non-parish US census
control; the tree endpoint reproduces it (section P). So a year range behaves like
the other qualifiers after all: without `birthYearExact` a range admits
estimate-overlap matches; with it, only records dated inside the range survive.

Setting `surnameAlt` or `givenNameAlt` performs a UNION — the result
set includes records that match the primary name AND records that
match the alternate name. Useful for women whose maiden and married
names are both worth searching. If just `surnameAlt` is populated
but not `givenNameAlt`, the MCP server code sets `givenNameAlt =
givenName` before sending. Similarly, if `givenNameAlt` is populated
but not `surnameAlt`, the code sets `surnameAlt = surname`.

### Life event fields

Each event group (birth, death, marriage, residence, any) has a
year range and a place, with corresponding `Exact` toggles.

| Field | Type | Description |
|-------|------|-------------|
| `birthYearFrom` | number | Lower bound of birth-year range. Pair with `birthYearTo`. |
| `birthYearTo` | number | Upper bound of birth-year range. Pair with `birthYearFrom`. |
| `birthYearExact` | boolean | When `true`, the year range is matched exactly (no fuzz). |
| `birthPlace` | string | Birth place name. |
| `birthPlaceExact` | boolean | When `true`, the place is matched exactly (no expansion to parent jurisdictions). |
| `deathYearFrom` | number | Lower bound of death-year range. |
| `deathYearTo` | number | Upper bound of death-year range. |
| `deathYearExact` | boolean | Strict match on the death-year range. |
| `deathPlace` | string | Death place name. |
| `deathPlaceExact` | boolean | Strict match on the death place. |
| `marriageYearFrom` | number | Lower bound of marriage-year range. |
| `marriageYearTo` | number | Upper bound of marriage-year range. |
| `marriageYearExact` | boolean | Strict match on the marriage-year range. |
| `marriagePlace` | string | Marriage place name. |
| `marriagePlaceExact` | boolean | Strict match on the marriage place. |
| `residenceYearFrom` | number | Lower bound of residence-year range (census-style anchor). |
| `residenceYearTo` | number | Upper bound of residence-year range. |
| `residenceYearExact` | boolean | Strict match on the residence-year range. |
| `residencePlace` | string | Residence place name. |
| `residencePlaceExact` | boolean | Strict match on the residence place. |
| `anyYearFrom` | number | Lower bound of an event-year range that matches any event type (use when the event type is unknown or doesn't matter). |
| `anyYearTo` | number | Upper bound of any-event-year range. |
| `anyYearExact` | boolean | Strict match on the any-event-year range. |
| `anyPlace` | string | Place name for an event of any type. |
| `anyPlaceExact` | boolean | Strict match on the any-event place. |

Year inputs are 4-digit years. The search engine ignores month and
day even if supplied.

**The `*Exact` toggles in this table change the result count.** A place toggle
stops upward expansion to parent jurisdictions
(and is generally said to still descend to child localities, though no verdict
records that half — see the carve-outs above); a year toggle hardens the range. What an unqualified range actually matches is broader than records dated inside it: a record with no year of its own carries an *estimated* date range (derived from the dated facts of others on the record) and is returned whenever that estimate overlaps the range, so there is no year-silent record a range keeps regardless of where it sits — `H.verdict:index-silent personas exist` reads NO and `H.verdict:an unqualified range admits estimate overlaps` reads YES. `.exact` keeps only records whose indexed date is inside the range (`H.verdict:.exact requires the indexed date inside the range`), dropping the estimate-overlap matches. So a year range IS a reliable include/exclude lever for those records — unqualified admits them, `.exact` drops them — measured on the record index for the birth, death and marriage families. Record-index **residence** is collection-dependent, not uniformly precise. In one disjoint-band pool every row carried its own date (`Q.bands:records-residence`, 198/198), so a range found no estimate overlaps and `.exact` dropped nothing — and that is the *single* residence pool `Y.verdict:generalises past birth (impossible-range)` reads (`YEAR_BAND_SECTIONS` in the probe), which is why it records DOES NOT GENERALISE. The non-parish control reads the other way: in `Q.bands:records-uscensus-residence` an unqualified range admits estimate overlaps and `.exact` drops a meaningful fraction of the band matches, and the impossible-range residence block (`Q`/Geach pool) shows undated residence records kept by overlap and dropped by `.exact`. So residence behaves like the other families wherever records are dated only through others; only where every row already carries its own date is `.exact` a no-op. The tree endpoint (`person_search`) reproduces the estimate-overlap mechanism for all four families. Two caveats remain: a cohort that is not always small — up to roughly a quarter of a pool in the census sweeps — carries no indexed date in the swept span at all, so no bounded range reaches it and the results must be read back rather than trusted to a range to gather them; and whether `.exact` also drops *in-range approximate* dates is unmeasured. Neither toggle was measured surfacing a
record a fuzzy search buried, and for the `surname` family — the only one
diffed over complete sets — it cannot: the exact result there is a strict
subset of the fuzzy one. What `.exact` *does* do to the records it keeps is
reorder them (see the section-B table below). For the place toggle the only
ranking observation is a single target, which ranked first with and without
it; that is narrower than a statement about ranking in general. Unqualified place
expansion is aggressive enough that a county scope barely discriminates —
which is what makes these toggles useful mainly where a total has to mean
something, such as an exhaustiveness claim. Measured figures are under
"What `.exact=on` actually does" in the API reference.

### Family member fields

| Field | Type | Description |
|-------|------|-------------|
| `spouseGivenName` | string | Spouse's given name. |
| `spouseSurname` | string | Spouse's family name. |
| `spouseGivenNameExact` | boolean | Strict match on the spouse's given name. |
| `spouseSurnameExact` | boolean | Strict match on the spouse's family name. |
| `fatherGivenName` | string | Father's given name. |
| `fatherSurname` | string | Father's family name. |
| `fatherGivenNameExact` | boolean | Strict match on the father's given name. |
| `fatherSurnameExact` | boolean | Strict match on the father's family name. |
| `motherGivenName` | string | Mother's given name. |
| `motherSurname` | string | Mother's family name. |
| `motherGivenNameExact` | boolean | Strict match on the mother's given name. |
| `motherSurnameExact` | boolean | Strict match on the mother's family name. |
| `parentGivenName` | string | Parent's given name when sex unknown. |
| `parentSurname` | string | Parent's family name when sex unknown. |
| `parentGivenNameExact` | boolean | Strict match on the parent's given name. |
| `parentSurnameExact` | boolean | Strict match on the parent's family name. |
| `otherGivenName` | string | A given name appearing alongside the searched person, of unknown relationship. |
| `otherSurname` | string | A family name appearing alongside the searched person, of unknown relationship. |
| `otherGivenNameExact` | boolean | Strict match on the other given name. |
| `otherSurnameExact` | boolean | Strict match on the other family name. |

**A relative name does not require the relative to be present.** Left
unqualified, these fields keep records that match, keep records where
that relative was never indexed, and drop records naming a *different*
relative. That is deliberate — absence in an index is not disconfirming,
and sparse entries frequently omit parents — but it means a
father-anchored hit may contain no father at all. Setting the
corresponding `*Exact` requires the relative to be present and match,
which drops the silent records along with variant forms the unqualified
search did reach. Measured
figures are under "What `.exact=on` actually does" in the API reference.

`other*` is for cases where the caller knows two names appear
together in a record but doesn't know the formal relationship.

### Record-source fields

| Field | Type | Description |
|-------|------|-------------|
| `collectionId` | string | A FamilySearch collection ID — the `id` string returned by the `collections_search` tool (e.g., `"1743384"`). |
| `imageGroupNumber` | string | Image group number of a specific digitized volume (e.g., `"004010852"`). Also accepts split DGS format (e.g., `"004010852_001_M9QY-X6Y"`). Use the `volume_search` tool first to find the image group number. |
| `batchNumber` | string | IGI batch number (e.g., `"M01048-5"`) — the extraction batch behind a legacy parish register. Sent as `q.batchNumber`. **Obtained from the `batchNumber` field on a previous result** (see the response section); before that field existed there was no way to get one, which is why the strategy was documented on five surfaces and executable on none. A very strong filter and the canonical way to enumerate one parish: send it ALONE and it returns that batch's records, and adding a name searches within the batch. It satisfies the anchor rule by itself — combining it with `recordCountry` or `recordSubdivision` is rejected by `validateInput`, because a country that does not match the batch silently returns 0 (shape carries no country information, so there is nothing to guess it from). A nonexistent batch returns 0 rather than being ignored, so a nil means the batch is wrong, not that the parish is empty. Paging stops at `offset + count = 4999`, so a batch bigger than that cannot be walked end to end — partition it with `surname`, not by paging deeper. Shape varies: a batch may lead with a digit or with a letter, and may carry a trailing `-digit`. Attested live: `B01883-5`, `M01048-5`, and the all-numeric `8317102`. `C050761` appears in older documentation as a letter + 6 digits example and is not attested here; the tool validates nothing, so this list bounds the evidence, not the input. Always pass it as a quoted string, keeping any leading zeros; pass it exactly as the source gives it, do not reject or reformat one on shape, and treat no shape rule here as exhaustive. |
| `recordCountry` | string | Country where the record was created (e.g., `"United States"`, `"England"`). |
| `recordSubdivision` | string | State or province within the country (e.g., `"Alabama"`). Requires `recordCountry`. |
| `recordType` | `"birth"` \| `"marriage"` \| `"death"` \| `"census"` \| `"immigration"` \| `"military"` \| `"probate"` \| `"other"` | Type of record. |
| `maritalStatus` | `"Married"` \| `"Single"` \| `"Divorced"` \| `"Widowed"` | Marital status. Case-sensitive. Many records leave this field blank, so filtering on it excludes records where the field is unfilled. |
| `isPrincipal` | boolean | Filters by the searched person's role inside each record. `true` returns only records where the matched person is the **principal subject** of the record (e.g., the bride or groom on a marriage certificate, the deceased on a death certificate, the child on a birth certificate). `false` returns only records where the matched person is named but is **not** the principal (e.g., listed as a parent on a child's birth certificate, as a spouse on a death certificate, as a witness on a marriage). When the parameter is **omitted**, both principal and non-principal mentions are returned (the broadest set). |

**What `isPrincipal` actually does (background for the LLM caller):**
Every FamilySearch persona record (one indexed row from one historical
document) has exactly one *principal* person — the main subject the
record is about — and zero or more *non-principal* people mentioned
alongside (parents on a birth record, witnesses on a marriage, surviving
relatives on a death record). The search engine matches the name query
against *any* person in *any* record — both principals and
non-principals. `isPrincipal` then filters that match set:

- `isPrincipal=true` → only records where the matched person is the
  main subject. Use when building a profile of the person directly:
  *"find John Smith's own birth, marriage, death records."*
- `isPrincipal=false` → only records where the matched person is
  mentioned but isn't the main subject. Use to discover collateral
  relatives: *"find records that name John Smith as a parent, spouse,
  or witness"* — the principals of the returned records will be his
  children, his spouse, etc.
- Omitted → both. The broadest set, ranked by match quality.

For most natural-language searches, omit the parameter — only set it
when the caller's intent specifically requires one role or the other.

### Pagination

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Results per call. Max 100. **Default 50 when `subjectId` is supplied, 20 otherwise.** The default is coupled to ranking on purpose: a deep pool is worth fetching only because the re-ranker cuts it back host-side. Fetching 50 without ranking hands the model 50 raw stubs to triage, which is the cost this default exists to avoid. |
| `offset` | number | Pagination offset. Default 0. The combined value `offset + count` must be at most 4999. |

### Examples

Specific person:
```json
{
  "surname": "Lincoln",
  "givenName": "Abraham",
  "birthYearFrom": 1809,
  "birthYearTo": 1809,
  "birthPlace": "Kentucky"
}
```

Marriage records in a specific collection:
```json
{
  "surname": "Smith",
  "givenName": "John",
  "collectionId": "1743384",
  "marriageYearFrom": 1850,
  "marriageYearTo": 1859,
  "isPrincipal": true
}
```

Maiden + married name (UNION):
```json
{
  "givenName": "Mary",
  "surname": "Lincoln",
  "surnameAlt": "Todd"
}
```

The tool auto-pairs alt names — supplying just `surnameAlt: "Todd"` is
enough; the tool fills `givenNameAlt = "Mary"` (copied from
`givenName`) before sending so the API receives a complete alternate-name
pair. Same in reverse if `givenNameAlt` is set without `surnameAlt`.
See *Alt-name handling* under *FamilySearch API Reference* for the
wire-level mechanics.

Country-scoped death-year range:
```json
{
  "surname": "Smith",
  "recordCountry": "United States",
  "recordType": "death",
  "deathYearFrom": 1900,
  "deathYearTo": 1920
}
```

Strict surname + birth-place match:
```json
{
  "surname": "Smyth",
  "surnameExact": true,
  "birthPlace": "Hodgenville, Kentucky",
  "birthPlaceExact": true
}
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input fields the caller supplied. |
| `totalMatches` | number | Total records matching the query in the corpus. |
| `paginationCappedAt` | number | The hard limit on how many results are reachable through pagination (4999). When `totalMatches > paginationCappedAt`, the rest are unreachable — narrow the query. |
| `returned` | number | Number of results in this response (≤ `count`). |
| `offset` | number | Echo of the input offset (0 if not supplied). |
| `hasMore` | boolean | `true` when more pages are available (the response includes a `links.next`). |
| `rankingSkipped` | string \| undefined | Present **only** when `projectPath` was supplied and `subjectId` was not. Names the two features that therefore did not run, and how to get them. **Serialized before `results`** — see below. |
| `results` | RecordSearchResult[] | The ranked results, best-scoring first. |
| `jurisdictionHints` | object \| undefined | Present **only** on a marriage search that did not find the subject, made with both `projectPath` and `subjectId`. See below. |

### `rankingSkipped` — saying so when no subject was named

Host-side ranking (`ranked`) and `jurisdictionHints` are both gated on
`subjectId`. When it is absent both silently do nothing: no error, no note,
nothing in the response or the run log to say a feature was bypassed.

Measured `subjectId` coverage across the six graded `jimmie-jewel-neal` runs is
**59 of 171 `record_search` calls (34.5%)** — by run, in order: 0%, 0%, 0%, 100%,
55%, 39%. `search-records/SKILL.md` already carries four "pass `subjectId`"
instructions, and the tool's own schema says *"supply it for any search where you
know which tree person you are looking for, which is nearly all of them"*. So the
answer is not a fifth instruction: this is the same decay curve that motivated
folding ranking into `record_search` in the first place, and a field re-delivered
on every call is immune to the compaction that erodes prose.

**The condition is `projectPath` present and `subjectId` absent — and nothing
else.** No tree read, no name/date matching, no attempt to judge whether the
search "looked like" it was about a tree person. That test is a heuristic, and
gating the signal on an unvalidated heuristic would bias the very coverage
measurement the signal exists to produce. A caller running a legitimate broad
survey gets one extra short field; whether a given omission was legitimate is
answered at analysis time from the args already in the run log. `make
e2e-compaction` is the corpus-scale version of that analysis, split by
compaction segment.

Falsiness, not `=== undefined`, is the test on `subjectId`, because the ranking
gate is itself `input.subjectId &&`. Matching it exactly is what stops the field
claiming ranking was skipped when it ran, or the reverse.

#### Key order

`rankingSkipped` is emitted **before `results`** in the response object. `results`
is by far the largest field, so anything serialized after it is the first thing any
size bound drops. The motivating evidence: across the 46 `record_search` calls in
`run-2026-07-31_13-02-13` the existing `ranked` **field** appears in the run log
**0 times**, though 18 of those calls supplied `subjectId` and **14 were actually
ranked** (the other 4 were nil searches, where staging returns `null` so the
`out.staged &&` half of the ranking gate never fires).

**The capture fix does not obviate this, though a first draft of this section
claimed it mostly did.** Key preservation only helps a capture that *has* keys. Of
the 1544 tool results in the six committed runs, **434 arrive as a plain string,
238 of them over the threshold** — for those `_summarize_response` applies only the
string bound, there is nothing to preserve, and position is fully decisive. A
further 11 hit `_RUNLOG_MAX_CHARS` and degrade to a head cut of the summary. So the
ordering matters for roughly 16% of captures, not the 0.7% that draft asserted.
`record_search` itself lands in the plain-string class whenever its response comes
back as the MCP over-limit error.

Two further consumers keep the ordering load-bearing regardless: the model's own
context window, and anything else that bounds this response without the harness's
key preservation. #1073's Definition of Done requires the ordering in any case.

The capture side was widened in the same change
(`eval/harness/e2e/orchestrator.py::_summarize_tool_response` now summarizes by
key rather than head-truncating at 497 chars). Both halves are kept: the response
is read by more than one consumer, and only one of them was fixed.

That capture carries a hard invariant — **it never emits a shorter capture than
the old head-truncation would have.** A response that already fit is passed
through verbatim, and where a key-preserving summary comes out shorter than a
497-char prefix would (a long list of small items) the longer of the two is kept.
Both halves are needed: an unconditional summarize narrowed 91 of 284 real tool
results, because `_summarize_response` samples any list past three entries.

**The invariant is a LENGTH floor, not a content guarantee, and content loss does
happen.** Two mechanisms can drop something the old head cut kept while the floor
still holds: `_summarize_response` samples any list past three entries, and its
depth cap replaces anything nested past 8 levels with a `_truncated_for_depth`
marker. A verified instance, in `run-2026-07-31_13-02-13` — a 3928-char response
whose old 500-char capture contained `"type":"Birth","date":"08 Nov 1919"` and
whose new 2165-char capture does not, because that fact was the 4th entry of a
7-entry list. So the honest claim is "never emits a *shorter* capture", full stop.
Do not extend it to "captures everything it used to"; an earlier version of this
section asserted zero content loss and was wrong.

**Size cost.** Captured response text grows **2.16x** across the 1544 tool results
in the six committed runs. `run-<ts>.json` is committed to git, so that is the
price of the change, stated rather than discovered later.

That 2.16x is the whole cost. `_summarize_tool_response` has exactly one caller —
`tool_calls[].response_summary`. It had a second until #1238, which rendered the
tool-call `args` into `run-<ts>.transcript.md`; #1238 removed both the transcript
and that call site, so no other artifact grows.

**`response_summary` now has two shapes.** Under the verbatim threshold it keeps
the raw MCP envelope, in which the tool's document is an escaped string; over it,
the document is unwrapped into real JSON keys. Consequences, and the reason
`docs/specs/e2e-test-spec.md` §15 ("Evidence to read, in order", step 4) carries a
matching caveat: **741 of the 1544 captures (48%) differ from what the old code
produced**, so the first run after this lands shows a changed `response_summary` on
half of all calls against every earlier baseline — which that spec's triage rule
would otherwise read as an agent regression. And grepping a *quoted* key misses the
escaped form, while grepping the bare name over-matches agent prose (`ranked`
appears 4 times in `run-2026-07-31_13-02-13` as narrative text and a `Grep`
pattern, against 0 occurrences of the actual field). Neither form is reliable
alone.

#### What this does not do

`rankingSkipped` is a nudge, not a structural anchor — it neither rejects the
call nor blocks a downstream step. Unit tests prove the field is emitted; **they
prove nothing about whether coverage rises.** The only signal for that is the
next live `make e2e-run TEST=jimmie-jewel-neal`, and the number to compare is
coverage %, not "the field appears".

### `jurisdictionHints` — where else to look when a marriage search does not find the subject

A marriage is filed where the wedding happened, not where the couple later
lived, and a couple usually married **before** they migrated. So a nil marriage
search in one jurisdiction is a prompt to try the couple's *earlier* places, not
a finding that no record exists.

The tool computes those places itself rather than relying on the caller to
remember the rule. This is the same reasoning as host-side ranking: a documented
step decays under compaction, a tool contract does not. Measured basis: across
four scored `jimmie-jewel-neal` benchmark runs, every marriage search stayed in
the family's later residence — the jurisdiction the tree's own marriage fact
named — while the answering record sat in the husband's birth state, a fact
already present in the same tree.

Fires when **all** of: the search was marriage-scoped (`recordType: "marriage"`,
or any `marriagePlace` / `marriageYearFrom` / `marriageYearTo`); the search did
not find the subject — either `totalMatches` is 0 **or** ranking reported
`subjectResolvable: false`; the search was scoped to a place **narrower than a
country**; and both `projectPath` and `subjectId` were supplied.

The sub-country condition matters more than it sounds. A country-wide nil means
the record is not in that country's indexed collections, so naming counties inside
it is noise — and an unscoped search never missed anywhere at all, which makes the
note's "did not find the subject in the place searched" simply untrue. Both are the
same situation and both are suppressed. Across the six committed `jimmie-jewel-neal`
runlogs, **9 of 26** marriage-scoped searches carried no place scope whatsoever, so
this is the common shape, not an edge case.

`subjectResolvable: false` is set by **two** branches of `rank-search-matches.ts`,
and the hint deliberately fires on both. One is a scoreable subject against a pool
that holds no match (a real negative). The other is a subject too thin to
discriminate — no dated or placed fact — where the scores are noise. Those two
need opposite responses from the caller *about the ranking*, but they want the same
response here, and the thin-subject case may be the more valuable of the two: in
genealogy you often cannot enrich the subject, because not knowing the missing
information is precisely why you are stuck. A spouse's places are exactly the
borrowed context that unsticks it. Distinguishing them later wants an explicit
field on `RankSearchMatchesResult`, not sniffing the `diagnostic` string.

A nil-**only** trigger was tried first and is too narrow: in one verification run
it fired once, at 121 of 180 minutes. Note that both triggers need `subjectId`, so
a caller that omits it gets neither the hint nor host-side ranking — measured
`subjectId` coverage across the six graded runs is **59 of 171 calls (34.5%)**:
0% / 0% / 0% / 100% / 55% / 39%. That bounds how often either can fire at all. Do
not read a run with low coverage as evidence about the trigger width.

**The trigger width has not been re-evaluated since, and is still owed a run.**
Widening from nil-only to `nil || subjectResolvable === false` was decided against
`run-2026-07-30_23-05-46`, which carried 55% coverage — so the binding constraint
in that run was reachability, not width. The verification run that followed
(`run-2026-07-31_13-02-13`) fired the hint **0 times**: 6 of its 7 marriage
searches omitted `subjectId`, and the one that supplied it found its subject, so
the trigger correctly stayed quiet. That run is therefore evidence about coverage
and no evidence at all about width. `rankingSkipped` is the nudge aimed at
coverage; once a run lands with materially higher coverage, re-read this section
and check whether the wider trigger now fires too often. Until then, treat the
width as untested rather than settled.

| Field | Type | Description |
|-------|------|-------------|
| `searchedPlace` | string | Echo of the place actually searched: `marriagePlace` when given, otherwise `recordSubdivision` + `recordCountry` joined (see "Place matching"). Never absent — `isSubCountryPlace()` gates the hint and returns `false` for `undefined`, so the hint cannot exist without a place. |
| `candidates` | JurisdictionCandidate[] | Other places these people are on record as having been, ordered by distance from the search's date window (see below). **Capped at 8** — the tail of a distance-ordered list is its least useful part, and this lands in a response whose assembly elsewhere strips `gedcomx` and hoists `collectionTitle` for context economy. The jurisdiction already searched is excluded, including differently-spelled and **narrower** forms of it; a **broader** place is kept, since a wider search reaches the other localities inside it. |
| `note` | string | Plain-language statement of the rule, so the reason travels with the data — including that these are places to look, never evidence. |

Each `JurisdictionCandidate`: `place` (as written, `standard_place` preferred),
`earliestYear` (number \| null), `whose` (the `persons[].id` that contributed the
fact), `fromFact` (e.g. `Birth`, `Residence`, `Marriage`).

Both spouses contribute, which is the point: the decisive place is frequently
the *other* spouse's birthplace, which the subject's own facts never mention.

#### Ordering: distance from the marriage's date window, not earliest-first

With a `marriageYearFrom`/`marriageYearTo` window the candidates sort:

1. places dated at or before the window, **most recent first** — the last known
   location before a wedding is the best guess for where it happened
2. undated places
3. places dated **after** the window, last — they say nothing about the wedding

With no window in the arguments there is no proximity signal, and the ordering
falls back to earliest-first across the whole set.

**Earliest-first over the whole set was the original design and is wrong.** It
ranks by absolute age, so a place tied to a much later marriage can top the list
on nothing but a small birth year.

Verified harmful in `jimmie-jewel-neal` run `run-2026-07-30_23-05-46`. Under
earliest-first the order was South Carolina (1847, the subject's *third*
husband's birthplace), **Georgia (1855, the subject's own birthplace)**, Yell,
Arkansas (1857, the birthplace of the husband who mattered). The caller pivoted
to candidate #2: searches carrying a Georgia place argument went from **0 before
the hint fired to 12 after**, and the two wrong parents it then minted were found
in those Georgia records. A run of the same fixture *without* the hint
(`run-2026-07-30_14-32-18`) had correctly declined to name parents at all, so the
ordering did not merely fail to help — it converted a cautious run into an
over-claiming one.

Re-derive from the run rather than trusting a summary: count place arguments on
`record_search` **tool_use** entries only. An earlier reading of this same run
reported nine South Carolina searches; there were **zero**. That figure came from
matching the string anywhere in a transcript line, which also catches
`extraction_append`, `research_log_append` and subagent prompts describing census
people who merely *happened to be born* in South Carolina.

The current ordering demotes Georgia to #4, below the Yell, Arkansas entry that
holds the answer — i.e. it fixes the real failure path, not the one first
reported. Ranking is the load-bearing part of this feature: treat a change to it
as a behavioural change and re-verify against a live run, not unit tests alone.

#### Place matching

> **Live-run exemption for tokenizer-only changes.** The mandate above — treat a
> ranking change as behavioural and re-verify against a live run — has one
> measured exception. A `placeParts`/tokenizer change is exempt when **nothing a
> run would actually feed to `placeParts` tokenizes differently** before and after.
> That is exactly two input classes, and the criterion must be checked against
> both:
>
> 1. **Tree facts** — `place`/`standard_place` in every
>    `eval/tests/e2e/*/starting-tree.gedcomx.json` (what the harness stages) **and**
>    every `*.final-tree.gedcomx.json` in `eval/runlogs/` (the run's *mutable* tree
>    is what `record_search` reads, not the starting one). Note `standard_place ||
>    place` — the standardized form wins where both exist.
> 2. **Recorded search arguments** — `marriagePlace` and `recordSubdivision` in
>    `eval/runlogs/e2e/`, which is where `searchedPlace` comes from.
>
> Deliberately **not** in the criterion: `unstripped-tree.gedcomx.json` (an
> authoring artifact, never staged into a run), `research.json` assertion places,
> README prose, and transcript text. A change may move those and still qualify —
> which is exactly what happened below, so read the two classes above as the whole
> test, not as a summary of a wider scan.
>
> Applied twice. **First** for the `\bco\.?\b` fix below, and the numbers are the
> criterion run verbatim: **class 1 — 1623 distinct tree-fact places** (1405 from
> `starting-tree.gedcomx.json`, the rest across 144 `*.final-tree.gedcomx.json`),
> **0 changed**; **class 2 — 54 distinct recorded search arguments, 0 changed**.
> Exempt.
>
> **Second, 2026-08-19**, for the three qualifier-stripping defects below (the
> ASCII-only boundary, the internal qualifier that fused two locality levels into
> one token, and `CO` the postal abbreviation): **class 1 — 1007 distinct
> tree-fact places, 0 changed**; **class 2 — 61 distinct recorded search
> arguments, 0 changed**. Exempt.
>
> Class 1 is `standard_place || place` **per fact**, so a raw `place` is skipped
> wherever the fact carries a `standard_place`: the tokenizer reads the standardized
> form, and measuring the raw one reports changes that cannot happen. The criterion
> lives at `dev/probe-placeparts-criterion.ts` — run it *after* merging `main`, since
> the counts move with the corpus, and read its header for why it collects what it
> collects.
>
> The postal-abbreviation change moves nothing in either class, because neither
> holds a `CO`: of class 1's 12 places whose last comma-part is two letters, the 9
> uppercase ones are `UT`, `NY`, `FL`, `MT` and `LA`, and the rest are `Ny`, `Ca`
> and `Ma`; class 2 has none at all. Neither class holds a place with a standalone
> `co` token. A **wider scan** — every `place`/`standard_place` under
> `eval/tests/e2e` and `eval/runlogs`, which is outside the criterion by design —
> finds 9 such places, including the leading-qualifier Irish forms `"Co Kilkenny"`
> and `"Co Down"` in `eval/runlogs/e2e/butler-ancestry/`. All 9 still strip;
> `placeParts` was run over each rather than eyeballed. Deliberately not quoted
> here: a count of files scanned. Three reviewers produced three different numbers
> for it and it decides nothing — the distinct-string counts are the measurement.
>
> Seven strings *did* change elsewhere in `eval/` — run-log outputs, one fixture
> README line, and two `unstripped-tree.gedcomx.json` files. That is why the
> criterion is scoped to the two input classes rather than to a corpus-wide diff: a
> wider scan is the wrong test and would have refused an exemption that is correct.
> A live run here would have sampled run-to-run jitter rather than the change.
>
> **Unexercised is not unreachable, and the distinction is the whole point.** Real
> FamilySearch tree data does spell counties this way — `ruse-children`'s
> `unstripped-tree.gedcomx.json` carries `place: "Seneca Co., O."` and
> `mcaloney-mother`'s carries `"Hants Co.,Nova Scotia,Canada"` — so a fact whose
> `standard_place` is absent would put the abbreviated form straight into
> `placeParts` (`marriage-jurisdictions.ts` reads `standard_place || place`). That
> has not happened in the corpus: of the 10,730 placed facts across every tree
> file, the 150 with no `standard_place` contain no `co` token. A change that moves
> a tokenized value any fixture actually feeds to `samePlace` still needs the live
> run. This exemption is not a general licence to skip one.

`searchedPlace` is the caller's `marriagePlace` when given, otherwise
`recordSubdivision` + `recordCountry` joined — the caller usually scopes a marriage
search with the latter pair, and reading only `marriagePlace` left the exclusion
inert on most real searches.

A country term alone does not count as a scoped place: `isSubCountryPlace()` gates
the hint, and it is exported from `marriage-jurisdictions.ts` rather than duplicated
here because `placeTokens` deliberately collapses the distinction it tests (its
empty-fallback makes a country-only place look like any other single-token place).

`isSubCountryPlace` returns `boolean` and is deliberately **not** a
`place is string` type predicate. The predicate is unsound in its negative branch —
`isSubCountryPlace("United States")` is `false` while the argument is plainly a
string — so it would let TypeScript narrow an `else` to `undefined`. Callers that
need the string narrowed test `!== undefined` themselves; that explicit check is
what makes `jurisdictionHints.searchedPlace` a sound required `string`.

**The `Co.` qualifier, and why the first spelling of the regex was wrong.**
`placeParts` consumes `County`/`Co` **as a part separator** — not as a deletion —
through `stripCountyQualifier`, which matches
`/(?<![\p{L}\p{N}_-])(county|co)(?![\p{L}\p{N}_-])(\.?)/giu` and decides per match
whether to replace it with `","`. The abbreviation's dot is part of the qualifier
and must be consumed with it, so `\.?` sits **outside** the closing assertion. The
original `\bco\.?\b` could not do that: after matching `co.` the trailing `\b`
fails, so the engine backtracks to bare `co`, leaving a `"."` that survives the
empty-string filter and counts as a locality. Asserting the boundary first and
eating the dot after is the fix. Because a single `\.?` now follows one shared
assertion covering both spellings, `"County."` strips clean as well — under
`\bcounty\b` it left the same stray dot.

That stray token had two effects, and the reported one was the smaller. It made
`isSubCountryPlace("Co., USA")` return `true`, so a country-wide search read as
scoped — the failure this guard exists to prevent. More importantly it made
`placeParts("Hill Co., Texas")` return `["hill .", "texas"]`, so `samePlace` did
not match a tree place of `"Hill, Texas, United States"`: the **exclusion** failed
and the jurisdiction a search had just come back empty on was offered back as an
alternative (with its sub-places alongside it). It also split one jurisdiction into
two candidates, since `placeTokens(...).join("|")` is the dedupe key.

Reachable in principle — real tree data spells counties this way, and a fact with
no `standard_place` feeds the abbreviated form straight into `placeParts` — though
nothing in the corpus exercises it, which is why the fix qualified for the live-run
exemption at the top of this section. Pinned by two tests in
`tests/utils/marriage-jurisdictions.test.ts`: the `isSubCountryPlace` case, and an
exclusion case scoped `"Hill Co., Texas"` that pins the root cause rather than the
symptom.

**Why the boundary is a `[\p{L}\p{N}_-]` lookaround pair and not `\b`.** JavaScript's
`\b` is defined over `[A-Za-z0-9_]`, so every non-ASCII letter — and the hyphen —
reads as a word edge, and a leading `co` matches as a whole word *inside the place's
own name*: `"Coïmbra, Portugal"` tokenized as `["ïmbra","portugal"]`, `"Coévrons,
France"` as `["évrons","france"]`. `\p{L}` alone is **not** sufficient, and this is
the part worth not re-deriving: `-` is not a letter either, so
`"Co-operative Township, Ohio"` still lost its first two letters. Both alternatives
carry the same class — leaving `county` ASCII-only would be an asymmetry the next
reader has to work out. The mangling is *symmetric*, which is why it is invisible
through `marriageJurisdictionCandidates`: `"Coïmbra"` reduced to `["ïmbra"]` whether
it arrived as the searched place or as the candidate, so the exclusion still matched
and no behavioural assertion could fail. `placeParts` is exported for that reason
alone — the tokens are the only level at which this defect is observable.

**Why the qualifier is a separator, not a deletion.** The qualifier marks a locality
boundary whether or not a comma also marks one. Deleting it fused the levels into a
single token — `"Hill Co. Texas"` became `["hill texas"]` — which no comma-separated
spelling of the same jurisdiction can ever equal, so `samePlace` never matched
`"Hill, Texas, United States"` and the exclusion failed. Replacing it with `","`
makes `"Hill Co. Texas"`, `"Hill County Texas"` and `"Hill, Texas"` all reduce to
`["hill","texas"]`. Note that collapsing whitespace *before* the strip was a
second-order symptom of the same defect, not its cause: it left the two spaces that
used to flank the qualifier, so fixing only the spacing yields `["hill texas"]` —
tidier, still unmatched, no behaviour changed. Whitespace is therefore collapsed
after the split.

**`CO` the postal abbreviation, and the ruling that governs it (lead, 2026-08-13).**
`CO` is also Colorado's postal abbreviation, and the model does write postal
abbreviations. Eating it reduced `"Denver, CO"` to `["denver"]`, and since
`samePlace` is a subset test, a Colorado-scoped search that came back empty
**suppressed a tree place of `"Denver, Iowa"` from its own candidate list** —
deleting precisely the alternative jurisdiction this hint exists to surface. The
qualifier is therefore stripped when **any** of these holds, and kept otherwise:
(1) it carries a dot; (2) another token follows it in the same comma part; or (3) it
is spelled with a lowercase `o`. So it survives only as bare uppercase `CO` ending
its comma part.

Three options were considered and each fails alone: requiring the **dot** breaks
`"Hill Co Texas"`; the **token-follows** test alone breaks `"Hill Co., Texas"`,
because the dot ends that comma part; and a **postal-abbreviation set** is fifty
entries to maintain against a signal already present in the string. Knowingly
accepted: `"Denver, Co"`, Colorado written with a lowercase `o`, still strips and so
still compares equal to `"Denver, Iowa"` — the price of catching `"Hill Co"`, which
has no other tell. Do not "fix" that without reopening this ruling.

**The inverse cost, and why it is not accepted.** Keeping `co` as a token has a
second consequence that review caught, and it is the more common of the two:
`["denver","co"]` is not a subset of `["denver","colorado"]`, so a `CO`-scoped
search stopped excluding its own **spelled-out** tree place and offered
`"Denver, Colorado, United States"` straight back as a candidate — the very failure
the `Co.` paragraph above says this tokenizer exists to prevent, arriving from the
other side. It was first read as a documentation-only cost on the grounds that
matching `CO` to `Colorado` needs the fifty-entry postal-abbreviation set the
ruling rejected. **That reasoning is wrong, and the trap is worth naming:** the set
was rejected as a way to decide *whether to strip*, and by the time a bare `co`
survives tokenization the ruling has already decided it is Colorado and nothing
else. Only the comparison is left, so it costs one mapping, not fifty.
`placeTokens` therefore compares a surviving `co` as `colorado`. `placeParts` is
untouched — `"Denver, CO"` still tokenizes as `["denver","co"]` — so the ruling and
every assertion resting on it stand. Net effect: a postal abbreviation now neither
suppresses a same-named place in another state nor resurfaces its own.

**A kept qualifier is still a boundary.** The keep branch first returned the match
bare, which left it fused into the token before it — `"Hill CO, Texas"` tokenized as
`["hill co","texas"]`. That is wrong under both readings (the county abbreviation
wants `["hill","texas"]`, Colorado wants `["hill","co","texas"]`, neither wants one
fused token), and it was the internal-qualifier defect surviving in the one branch
that had stopped honouring the separator rule. The kept match is wrapped in
separators instead. Not an all-caps-only case, as first supposed: any place with an
uppercase standalone `CO` and text before it in the same comma part hits it.

Two consequences for anyone editing `stripCountyQualifier`. The strip must run
**above** the `.toLowerCase()`, because that call destroys the case signal the rule
rests on. And the `i` flag makes the match read as case-insensitive when the
*decision* is case-sensitive: matching is deliberately case-blind so the callback
can inspect the spelling it captured (`word !== "CO"`). A pattern that looks
case-insensitive and is not is exactly the trap this note exists to flag.

It is compared to each candidate on comma-separated tokens, lowercased, with
`County`/`Co.` consumed as a further part separator — except bare uppercase `CO`
ending its comma part, which is kept — and the country term dropped unless it is
all that remains.
The match is **one-directional**: a candidate is excluded only when it is equal to
or **narrower** than what was searched. So `"Hill County, Texas"` excludes
`"Hill, Texas, United States"`, and searching `"Texas, United States"` excludes
every Texas place in the tree — but searching `"Yell County, Arkansas"` **keeps**
`"Arkansas, United States"`, because a statewide search is a different search that
reaches the other counties. Dropping a locality level when the narrow one comes back
empty is the highest-value broadening move available, so the bidirectional version
of this test deleted exactly the lead the feature exists to surface.

Exact string comparison was the original behaviour and let the jurisdiction just
searched reappear as its own alternative, because callers spell places the way
FamilySearch's search expects while the tree stores standardized forms.

**Advisory and best-effort.** A missing or malformed `tree.gedcomx.json`, an
unknown `subjectId`, or a spouse absent from `persons` all leave the field off
entirely — never an error. Ranking degrading must not take the search down with
it, and neither must this.

Implementation: `packages/engine/mcp-server/src/utils/marriage-jurisdictions.ts`.

Each `RecordSearchResult`:

| Field | Type | Description |
|-------|------|-------------|
| `recordId` | string | The record-persona ARK in canonical form (e.g., `"ark:/61903/1:1:6K9K-3HN9"`). Feed directly to `record_read`'s `recordId` input, the record-match tools' `id`, or `source_attachments`' `uris`. |
| `personName` | string \| undefined | The person's name as written on the source record. Undefined when the upstream record carries no display name and no fallback name form. |
| `score` | number \| undefined | Relevance score within this query. Higher means better-ranked. Use for sorting within a result set. Not comparable across different queries. |
| `confidence` | number \| undefined | A 1–5 confidence band on this result, where 5 is highest. Surface for transparency; rank with `score`. |
| `sex` | string \| undefined | `"Male"`, `"Female"`, or undefined. |
| `birthDate` | string \| undefined | Birth date as written on the record (e.g., `"12 February 1809"` or `"1809"`). |
| `birthPlace` | string \| undefined | Birth place as written. |
| `deathDate` | string \| undefined | Death date as written. |
| `deathPlace` | string \| undefined | Death place as written. |
| `events` | Event[] | All other extracted facts that aren't already surfaced as birth/death (residence, immigration, marriage, etc.). |
| `collectionId` | string \| undefined | The ID of the collection this record belongs to. Undefined when the upstream record carries no Collection-typed `sourceDescriptions[]` entry. |
| `collectionTitle` | string \| undefined | Human-readable collection name. Undefined under the same conditions as `collectionId`. |
| `collectionUrl` | string \| undefined | Link to the collection page on FamilySearch (a web page, not an ARK). Undefined under the same conditions as `collectionId`. |
| `recordTitle` | string \| undefined | Human-readable description of the source record. |
| `recordArk` | string \| undefined | The source record's ARK in canonical form (the `1:2:` entry, e.g. `"ark:/61903/1:2:HSJG-CLNF"`). Distinct from `recordId`, which is the `1:1:` persona ARK. |
| `treeMatches` | TreeMatch[] | Suggested matches between this record persona and existing FamilySearch Family Tree people. Sorted by `stars` descending. Empty array when the upstream entry has no `hints`. |
| `gedcomx` | SimplifiedGedcomX \| undefined | The matched persona's record converted from the entry's raw `content.gedcomx` to the simplified GedcomX format (via `toSimplified`, see `simplified-gedcomx-spec.md`). Carries the faithful record shape — names, facts, source descriptions — for downstream tools that need more than the flattened summary fields. Undefined when the entry has no `content.gedcomx`. |
| `primaryId` | string \| undefined | The `id` of the focus persona within `gedcomx.persons[]` (the person this result represents). Lets a downstream consumer pick the right person out of a multi-person record. Undefined when the represented persona carries no `id`. |
| `relativeTerms` | RelativeTerms \| undefined | Per-relative answer to "is the relative I searched on actually named on this record?" Present only when the caller supplied a relative *name*; see [`relativeTerms`](#relativeterms--whether-the-relative-you-anchored-on-is-actually-there) below. |
| `batchNumber` | string \| undefined | The extraction batch this record came out of (e.g. `"M01048-5"`), read off the entry's `content.gedcomx.fields[]`. Feed it straight back as the `batchNumber` **input** to enumerate the rest of the batch. Undefined on any record that does not trace to an extraction batch, which is most of them — **absence carries no information** and is not a statement about the collection. See [`batchNumber`](#batchnumber--the-only-route-to-a-batch-you-can-enumerate) below. |

Output fields keep the `Date` naming because they hold the date as
written on the record — which can include month and day even though
inputs are year-only.

### `relativeTerms` — whether the relative you anchored on is actually there

A relative-name term is sent with `m.queryRequireDefault=on`, which FamilySearch
reads as **must not contradict**, not *must carry*. A record that names no
father at all therefore survives a father-anchored search. That is correct —
absence in an index is not disconfirming, and sparse entries routinely omit
parents — but it means a hit can be *consistent with* William while saying
nothing about him, and nothing in the response used to distinguish the two. The
write-up then reads "confirming her father William" on a record that never
mentions him: false, and filed as though well-sourced. `relativeTerms` carries
the distinction as data.

Emitted only for prefixes the caller supplied a **name** for, and omitted
entirely when none were. The `*Exact` booleans do not count — `fatherGivenNameExact`
with no `fatherGivenName` sends no father constraint, so there is nothing to
report on.

```jsonc
"relativeTerms": {
  "father": { "status": "present", "name": "Wm. Neal" },
  "mother": { "status": "absent" }
}
```

| Status | Meaning |
|---|---|
| `present` | The record names a relative in this role. `name` carries theirs. |
| `absent` | The record names no such relative. **The case this field exists for.** |
| `unknown` | Could not be determined. Never guessed. |

**`present` is not a match verdict.** The tool does not re-run FamilySearch's
fuzzy matcher and must not claim to have. It reports that a relative in this
role exists and gives the name, so `Wm.` against a query of `William` is visible
and checkable by the caller. A status word asserting a match the tool never
performed would recreate this field's own failure mode one layer up.

**`unknown` beats a wrong `absent`, always.** A wrongly denied relative reads as
*disconfirming* evidence, which is worse than silence. Four situations return
`unknown`:

1. The persona could not be identified inside the graph (no `primaryId`).
2. The persona was matched by the `principal === true` fallback rather than by
   ARK. A live probe showed this anchor turns a silent record into an
   apparently contradicting one when the search matched the relative themselves:
   resolving "the father of the principal" returns the searched person.
3. The entry carries no relationship graph — `gedcomx` absent, `relationships`
   absent, **or** `relationships: []`. An empty array is not "resolves cleanly
   and yields nobody"; it cannot be told apart from relationships never being
   returned.
4. A parent exists whose sex is not provably `Male` or `Female` — see below.

**Resolution rules**, all anchored on the matched persona:

| Prefix | Rule |
|---|---|
| `father` | ParentChild parent whose `gender` is exactly `"Male"` |
| `mother` | ParentChild parent whose `gender` is exactly `"Female"` |
| `parent` | Any ParentChild parent, regardless of sex — mirrors `q.parentGivenName` |
| `spouse` | The **other** endpoint of a Couple row in which the persona is an endpoint |
| `other` | Any co-person whose **name** matches the query — no relationship role exists to resolve against |

`father` and `mother` are **sex-derived**, and resolve in three ordered
branches: `present` if a parent of that sex is on the record; else `unknown` if
any parent's sex is indeterminate (`gender` absent, the literal `"Unknown"` that
`simplifyGender` emits for a non-Male/Female URI, or an endpoint id naming
nobody in `persons[]`); else `absent`.

The order is the safety property, and both halves of it are load-bearing.
Checking indeterminacy *before* absence means "we could not establish the sex"
never becomes a denial. But `absent` must stay reachable: **a record naming only
the mother genuinely is evidence that no father was indexed**, and that is the
signal this field exists to surface. Collapsing the rule to a single "not
provably Male → unknown" predicate destroys it on exactly the records carrying
the most information — 20 of 384 surveyed real results sit in that cell.

For `parent` and `spouse`, an endpoint that is missing or resolves to no entry
in `persons[]` yields `unknown`, not `absent`.

`spouse` reports the endpoint that is **not** the persona; a Couple row is
symmetric and the persona may be either `person1` or `person2`, so reading a
fixed side would report the searched person as their own spouse. When both
endpoints are the persona, the answer is `unknown`. When two rows qualify, the
first in document order wins — `name` is one name, not a list.

`name` is joined from `names[0]`'s `given` and `surname` (`simplifyName` writes
no `fullText`, so the parts must be joined) and tolerates a missing half. If the
join yields nothing the status is still `present` **without** a `name`: presence
is established by the relationship, not by the name.

**`other` is the exception to all of the above, and its status vocabulary is
genuinely narrower.** `q.otherGivenName` names a co-occurring person of
*unspecified* relationship, so there is no relationship role to resolve against
and the only available question is whether some co-person's **name** answers the
query. Names are compared exactly, ignoring case and punctuation (`Wm.` matches
` wm `, but not `William`).

That asymmetry is deliberate. "Some other person is on this record" would be a
useless rule — every one of the 384 surveyed real results is multi-person, since
search entries carry the whole household — and would make `other` a constant
`present` naming an arbitrary bystander.

| Status | When |
|---|---|
| `present` | A co-person's name matches. A real positive; `name` says who. |
| `unknown` | Co-people exist, none matches by name. |
| `absent` | The record carries **no** co-person at all. Rare, but legal. |

A name miss is `unknown`, never `absent`: we compare exactly while FamilySearch
matched fuzzily, so a `Wm.`-vs-`William` miss means "could not confirm", not
"not on this record". The `absent` that *is* reachable for `father`/`mother`/
`spouse` rests on the record positively naming someone else in that role, and no
such evidence exists here — so no such denial is offered.

`other` reads `persons[]` rather than the relationship graph, so `unknown`
trigger 3 (no graph) does not apply to it: a record with no `relationships` can
still answer an `other` term.

**Survives staging.** Resolved inside `mapEntry` before the staged slim block
deletes `gedcomx`, so it reaches both the inline stub and the sidecar payload.
`rank_search_matches` carries it onto the ranked stub verbatim.

Each `Event`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | The fact type as a short label (e.g., `"Birth"`, `"Residence"`, `"Marriage"`, `"Immigration"`). |
| `date` | string \| undefined | Date as written on the record. |
| `place` | string \| undefined | Place as written. |
| `value` | string \| undefined | Free-text value for non-event facts (e.g., `"US Citizen"` for a Nationality fact). |

Each `TreeMatch`:

| Field | Type | Description |
|-------|------|-------------|
| `treePersonId` | string | Bare Family Tree person ID this record may correspond to (e.g., `"GQWZ-GPX"`). The full tree-person ARK is `ark:/61903/4:1:<treePersonId>` if the caller needs to reconstruct it. |
| `stars` | number | Match confidence on a 0–5 scale, where 5 is highest. |

Example:

```json
{
  "query": {
    "surname": "Lincoln",
    "givenName": "Abraham",
    "birthYearFrom": 1809,
    "birthYearTo": 1809,
    "birthPlace": "Kentucky"
  },
  "totalMatches": 432,
  "paginationCappedAt": 4999,
  "returned": 1,
  "offset": 0,
  "hasMore": true,
  "results": [
    {
      "recordId": "ark:/61903/1:1:QPRC-WPBZ",
      "personName": "Abraham Lincoln",
      "score": 5.4236,
      "confidence": 4,
      "sex": "Male",
      "birthDate": "12 February 1809",
      "birthPlace": "Hardin, Kentucky, United States",
      "deathDate": "14 April 1865",
      "deathPlace": "Washington, Washington County, District of Columbia, United States",
      "events": [
        { "type": "Residence", "date": "1860", "place": "Springfield, Illinois" }
      ],
      "collectionId": "5000016",
      "collectionTitle": "United States, Social Security Numerical Identification Files (NUMIDENT), 1936-2007",
      "collectionUrl": "https://familysearch.org/collections/5000016",
      "recordTitle": "Entry for Abraham Lincoln, \"United States, Social Security...\"",
      "recordArk": "ark:/61903/1:2:HSJG-CLNF",
      "treeMatches": [
        { "treePersonId": "GQWZ-GPX", "stars": 5 }
      ],
      "primaryId": "p_1",
      "gedcomx": {
        "persons": [
          {
            "id": "p_1",
            "ark": "ark:/61903/1:1:QPRC-WPBZ",
            "facts": [
              { "type": "Birth", "date": "12 February 1809", "place": "Hardin, Kentucky, United States" },
              { "type": "Residence", "date": "1860", "place": "Springfield, Illinois" }
            ]
          }
        ],
        "sources": [
          { "title": "United States, Social Security...", "url": "https://familysearch.org/collections/5000016" },
          { "title": "Entry for Abraham Lincoln, \"United States, Social Security...\"" }
        ]
      }
    }
  ]
}
```

---

### `batchNumber` — the only route to a batch you can enumerate

The `batchNumber` **input** (see the record-source fields above) is the canonical
way to enumerate one parish: send it alone and it returns that batch's records.
It shipped without any way to *obtain* a batch number. The references prescribed
the strategy on five surfaces, `search-records` has no web access, and no tool
returned one — so the workflow was executable nowhere. This field closes
that loop:

1. find one record by name in the collection (an ordinary indexed search);
2. read `batchNumber` off a hit that has one;
3. send it alone — enumerate the rest of the batch.

**Read off `content.gedcomx.fields[]` on the entry ROOT.** The same `fields` key
also hangs off persons, names, facts, places and source-description coverage,
where it carries `PR_AGE`, `Role` and spatial data — never a batch.

**Matched on `labelId === "FS_UDE_BATCH_NBR"`, never on the field's `type` URI.**
The type suffix is spelled **both** `UdeBatchNbr` and `UdeBatchNumber` depending
on the collection — measured live 2026-08-13, `q.batchNumber=B01883-5` and the
English IGI batch `M01048-5` return the former while collection `1494474`
(Germany) and the all-numeric batch `8317102` return the latter, with nothing
caller-visible to predict it from. `labelId` was `FS_UDE_BATCH_NBR` on every
record measured, in both spellings. A matcher written to whichever spelling the
first collection you probe happens to use returns nothing on the collections
using the other, and **a batch present upstream but unread here is
indistinguishable from a record that has none**, so the miss is silent. Do not add a `type` check
"for safety" — it would carry that same risk forward to a third spelling while
excluding nothing, since no other field uses this labelId.

**Presence is per RECORD, not per collection and not per record type.** Over an
ordinary indexed search anchoring on no batch (surname + country, 10 hits per
record type): birth 0/10, census 0/10, marriage 4/10. Widening the marriage leg
to 20 hits, collection `1618491` ("New York, County Marriages") returned **7 with
a batch and 11 without** — one collection holding both kinds. Two consequences
the caller has to know:

- **Absence means nothing.** Not "this collection has no batches", not "this
  record cannot be enumerated from". Never report a missing `batchNumber` as a
  finding.
- **Scan the hits.** Step 2 above is "read it off a hit that has one", not "read
  it off the top result" — the first hit may legitimately carry none inside a
  collection that is full of them.

Evidence trail: `dev/probe-batch-field.ts`, which computes every verdict above
from its own run rather than restating these numbers. `BatchLocality` is a
sibling field on the same array and is **deliberately not surfaced**: it would
read as an invitation to pass `recordCountry` alongside a batch, which
`validateInput` rejects and which the anchor-rule design note measured as inert
at best and silently destructive at worst.

Carried onto `rank_search_matches`' ranked stubs as well — a search that supplies
`subjectId` returns `ranked`, and that is the projection the caller reads.

---

## Tool Schema

The advertised schema for `record_search` is **not duplicated here.** Read it at
[`packages/engine/mcp-server/src/tools/record-search.ts`](../../packages/engine/mcp-server/src/tools/record-search.ts) —
it is the only copy the model ever sees, and a paste of it in this file has no
reader that the source does not serve.

A verbatim copy used to live here and drifted: it was not updated alongside the
tool, no check compared the two, and prose written against the stale block
contradicted the shipped descriptions. Do not reintroduce one. If a rendered
schema is ever wanted in the docs, generate it from `allToolSchemas` at build
time the way `packages/schema/src/enums.generated.ts` is generated — never by
hand.

The anchor rule is enforced inside `validateInput`, not via JSON
Schema's `required` (which can only require single fields, not
"one of these N").

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry
point for all authenticated tools. Do not re-implement token
plumbing.

If the user is not authenticated, `getValidToken()` throws an
LLM-instruction error directing the user to call the `login`
tool. The tool handler should let this error propagate (same
try/catch pattern as other tools in `index.ts`).

---

## FamilySearch API Reference

**Endpoint (auth required):**

```
GET https://www.familysearch.org/service/search/hr/v2/personas
Authorization: Bearer <access_token>
Accept: application/json
Accept-Language: en
User-Agent: <browser-like user agent string>
```

**Required headers:**

- `Authorization: Bearer <token>` — without it, the API returns
  401.
- `User-Agent: <browser-like string>` — without it, the WAF
  (FamilySearch's web firewall) returns 403. Use the same
  browser-style constant the `collections_search` tool uses.
- `Accept-Language: en` — without it, place names in some response
  fields can come back in the user's session locale.

**Default flags sent on every request:**

| Flag | Value | Purpose |
|-----|------|---------|
| `m.queryRequireDefault` | `on` | Treats every `q.*` term as a required filter. Without this, most `q.*` terms only rerank the result list without narrowing it. **This flag is the only "required" mechanism the API offers** — there is no per-field qualifier. `q.<field>.required=on` is rejected outright (`400 {"errors":["Unable to map supplied value=required to term modifier"]}`), so a caller cannot make one term required and another optional. Because the tool sends the flag unconditionally, **every supplied `q.*` term is already a hard requirement** — but "required" means the record must not *contradict* the term, not that it must carry it. For the searched person's own surname this collapses to *must match* — an unqualified `surname` drops records with no indexed surname (measured 2026-08-20) — while an unqualified `givenName` keeps given-name-empty records, so the two principal fields differ; see *The exact-match rule* above. Either way a nil result means one of the terms **on the person you searched** did not match. For a field a record can omit, silence is not a contradiction and those records are kept: an unmatchable `fatherGivenName` still returned about 441,000 of a roughly 456,000 baseline, dropping only the records that named a *different* father. See "Relative names keep records where the relative is absent" below. `f.*` filters apply either way; only `q.*` terms are governed by the switch. Verified live 2026-08-04 on `q.surname=Zsigmondy&q.surname.exact=on` (634 hits): adding a gibberish given name, an impossible 1700–1710 birth range, or Alaska as the birthplace returned **6 / 4 / 4** with the flag and **634 / 634 / 634 — unchanged** without it. Each added term was ignored outright. |
| `m.defaultFacets` | `off` | Tells the server not to compute facet aggregations. The tool doesn't consume facet data; turning them off speeds up broad queries by up to 9×. |

**Tool input → API parameter mapping:**

| Tool input | API parameter |
|------------|---------------|
| `surname` | `q.surname` |
| `givenName` | `q.givenName` |
| `surnameAlt` | `q.surname.1` (with auto-pair: see Alt-name handling below) |
| `givenNameAlt` | `q.givenName.1` (with auto-pair) |
| `sex` | `q.sex` |
| `surnameExact=true` | `q.surname.exact=on` (and `q.surname.exact.1=on` if `surnameAlt` is set) |
| `givenNameExact=true` | `q.givenName.exact=on` (and `q.givenName.exact.1=on` if `givenNameAlt` is set) |
| `birthYearFrom` | `q.birthLikeDate.from` |
| `birthYearTo` | `q.birthLikeDate.to` |
| `birthYearExact=true` | `q.birthLikeDate.exact=on` |
| `birthPlace` | `q.birthLikePlace` |
| `birthPlaceExact=true` | `q.birthLikePlace.exact=on` |
| `deathYearFrom` | `q.deathLikeDate.from` |
| `deathYearTo` | `q.deathLikeDate.to` |
| `deathYearExact=true` | `q.deathLikeDate.exact=on` |
| `deathPlace` | `q.deathLikePlace` |
| `deathPlaceExact=true` | `q.deathLikePlace.exact=on` |
| `marriageYearFrom` | `q.marriageLikeDate.from` |
| `marriageYearTo` | `q.marriageLikeDate.to` |
| `marriageYearExact=true` | `q.marriageLikeDate.exact=on` |
| `marriagePlace` | `q.marriageLikePlace` |
| `marriagePlaceExact=true` | `q.marriageLikePlace.exact=on` |
| `residenceYearFrom` | `q.residenceDate.from` |
| `residenceYearTo` | `q.residenceDate.to` |
| `residenceYearExact=true` | `q.residenceDate.exact=on` |
| `residencePlace` | `q.residencePlace` |
| `residencePlaceExact=true` | `q.residencePlace.exact=on` |
| `anyYearFrom` | `q.anyDate.from` |
| `anyYearTo` | `q.anyDate.to` |
| `anyYearExact=true` | `q.anyDate.exact=on` |
| `anyPlace` | `q.anyPlace` |
| `anyPlaceExact=true` | `q.anyPlace.exact=on` |
| `spouseGivenName` | `q.spouseGivenName` |
| `spouseSurname` | `q.spouseSurname` |
| `spouseGivenNameExact=true` | `q.spouseGivenName.exact=on` |
| `spouseSurnameExact=true` | `q.spouseSurname.exact=on` |
| `fatherGivenName` | `q.fatherGivenName` |
| `fatherSurname` | `q.fatherSurname` |
| `fatherGivenNameExact=true` | `q.fatherGivenName.exact=on` |
| `fatherSurnameExact=true` | `q.fatherSurname.exact=on` |
| `motherGivenName` | `q.motherGivenName` |
| `motherSurname` | `q.motherSurname` |
| `motherGivenNameExact=true` | `q.motherGivenName.exact=on` |
| `motherSurnameExact=true` | `q.motherSurname.exact=on` |
| `parentGivenName` | `q.parentGivenName` |
| `parentSurname` | `q.parentSurname` |
| `parentGivenNameExact=true` | `q.parentGivenName.exact=on` |
| `parentSurnameExact=true` | `q.parentSurname.exact=on` |
| `otherGivenName` | `q.otherGivenName` |
| `otherSurname` | `q.otherSurname` |
| `otherGivenNameExact=true` | `q.otherGivenName.exact=on` |
| `otherSurnameExact=true` | `q.otherSurname.exact=on` |
| `collectionId` | `f.collectionId` |
| `imageGroupNumber` | `q.filmNumber` |
| `batchNumber` | `q.batchNumber` |
| `recordCountry` | `q.recordCountry` |
| `recordSubdivision` | `q.recordSubcountry=<recordCountry>,<recordSubdivision>` (joined with a comma, no space) |
| `recordType` | `f.recordType=N` (`"birth"`=0, `"marriage"`=1, `"death"`=2, `"census"`=3, `"immigration"`=4, `"military"`=5, `"probate"`=6, `"other"`=7) |
| `maritalStatus` | `f.maritalStatus` |
| `isPrincipal` | `q.isPrincipal=true` or `=false` |
| `count` | `count` |
| `offset` | `offset` |

URL-encode each value with `encodeURIComponent`.

**Alt-name handling:**

The API requires `q.surname.1` and `q.givenName.1` to be paired
together (cardinality `.1` works as a pair under
`m.queryRequireDefault=on`). The tool fills the missing half
automatically before sending:

- If `surnameAlt` is set but `givenNameAlt` is not, the tool sets
  `givenNameAlt = givenName` before building the URL.
- If `givenNameAlt` is set but `surnameAlt` is not, the tool sets
  `surnameAlt = surname` before building the URL.

This is a server-side helper, not a caller obligation — the caller
can supply just one alt and the tool ensures the API receives a
correctly paired set.

**Modifier syntax:**

The API supports modifiers on `q.*` terms using a dot-separator
pattern: `q.<term>.<modifier>` and `q.<term>.<modifier>.<cardinality>`.

- `.exact=on` — strict matching instead of fuzzy. Used by the
  `*Exact` boolean inputs.
- `.from=YYYY` / `.to=YYYY` — date-range bounds on date terms. Used
  by the `*YearFrom` / `*YearTo` inputs.
- `.1` — alternate value for the term (cardinality). Used by
  `surnameAlt` / `givenNameAlt`.

Modifiers stack with cardinality. Example: `q.surname.exact.1=on`
applies exact matching to the alternate surname.

The suffix order matters and only one form works: `q.surname.exact.1=on`
is accepted, while `q.surname.1.exact=on` is rejected
(`400 {"errors":["Unable to map supplied value=1 to term modifier"]}`).
One subtlety the tool already handles: setting only the primary exact
alongside a `surnameAlt` reverts to the fully fuzzy count (measured
31,606 against 445), which is why `surnameExact` emits both
`q.surname.exact=on` and `q.surname.exact.1=on` when an alternate is set.

**What `.exact=on` actually does — measured, not inferred:**

Live measurements against `/service/search/hr/v2/personas`, 2026-08-04,
re-measured 2026-08-08 and — for the legs that were re-done over complete
result sets rather than samples — 2026-08-10/11, reproducible via
`packages/engine/mcp-server/dev/probe-search-qualifiers.ts` — **with four
exceptions the script has no section for**, which were measured during the
original probe session under query shapes it does not run: the `14,095 → 51`
pool pair and the `251,867 → 3` batch-number pair (both quoted in
`search-strategy-levers.md` / `collection-quirks.md`, not here), and the
`31,606 vs 445` alternate-surname pair above. Each *behaviour* was re-verified live on
2026-08-08 (a batch number still cuts a multi-million-hit search to double
digits and a nonsense batch still returns 0 rather than being ignored; a
primary `.exact` alongside an untagged `surnameAlt` still reverts to the fuzzy
count exactly). Only the figures are unreproducible from this script — do not
cite them as probe output.
These are the figures the tool's schema descriptions in
`src/tools/record-search.ts` summarize, and they contradict the
intuition the qualifier family invites.

**`.exact=on` REMOVES records and REORDERS the ones it keeps.** Measured
over COMPLETE result sets on pools small enough to read to the end
(`dev/probe-search-qualifiers.ts` section B), scoring each shared record's
position among the shared set in fuzzy order against its position in the
exact list — both run 1..N, so removal cannot itself move anything:

| Population (`surname`, marriage) | Fuzzy → exact rows | Exact-only rows | Records displaced |
|---|---|---|---|
| Brazil / `Bochenek` | 521 → 81 | **0** | **0** |
| England / `Pocklington` | 469 → 423 | **0** | **54**, the largest by 34 positions; 6 of them cross rows carrying a *different* relevance score |

Exact-only is 0 in both: every record the exact search returns is already
in the fuzzy set, so `.exact` is a strict **subset** and cannot surface a
record a fuzzy search buried. That half is settled — but only for the
`surname` qualifier, and only in marriage populations. The reordering half
is real too: 54 records move against a same-query noise floor of 0, so any
prose claiming the qualifier leaves the order alone is contradicted here.

Count inflation is a separate, totals-only argument (no enumeration
required): `Zsigmondy` 108,848 → 634 (172×), `Mingazzini` 40,908 → 1,796
(23×), `Geach` roughly 18.5 million → about 23,200 (**799×**).

For places, no displacement diff was run. What section C recorded is one
target's rank: a county-scoped marriage search measured **about 35,500 fuzzy
against 2 exact, with the target ranked first in both** (rank measured by
record id, not by name). Read that as a single-target observation, not as a
general statement about place ranking.

**Consequences per family:**

| Family | Unqualified behavior | What `.exact=on` costs |
|---|---|---|
| `surname` | Filters, and expands loosely to spelling neighbours | **Can drop the target.** On a record indexed `Neill`, `q.surname=Neal` returns it and `q.surname=Neal&q.surname.exact=on` returns **0**. Fuzzy matching is the mechanism that bridges an index misspelling — the commonest reason a record cannot be found |
| `givenName` | Filters, and expands. It bridges standardized abbreviations (an unqualified `fatherGivenName=William` returned `Wm:52 Wm.:31` in a 300-result survey, re-measured 2026-08-08 after a father-detection fix in the probe). It also reaches period diminutives: membership tests on 2026-08-08 (probe section E) returned the diminutive's own record from the fuzzy search for the formal name 8 times out of 8, across Elizabeth→Betty, Margaret→Peggy and Mary→Polly. **The limit is rank, not coverage** — each record was ranked only within its own pool — the best at rank 347 in a pool of 1,019 (2 of the 8 fell inside the 500-deep scan), the other six unseen within that scan in pools of 55,514, 90,037 and 219,494, so a top-N sample cannot establish what the expansion reaches (an earlier revision of this row concluded "no `Betty`" from exactly such a sample). Narrowing works: with the query narrowed on the surname to a 227-row set read in full, the bound `Betty` record was present, at rank 103. Nothing widens the expansion — qualifiers only subtract — so to surface a diminutive, narrow the query until the pool is scannable or search it as its own `givenName` value. **Initials, in the one direction that is measured:** an initials *value* reaches its transposition — `I.verdict:.exact pins the initials ORDER` is CONFIRMED (ENUMERATED), the transposed record present in the fuzzy set and absent from the `.exact` set, both read to the end. Whether a **spelled-out** query reaches records indexed as initials only is unmeasured, and `I.verdict:fuzzy swallows initials into spelled-out names` reads NO for the converse direction, so do not state it. The sampled `J W:66 W J:29` forms breakdown is a 100-row sample of a 1,025,885-row pool and is indicative only | Excludes every variant, including the nicknames the default *does* reach; the abbreviation figures in the middle column are a 300-row sample of a pool too large to enumerate, so treat the size of that loss as indicative |
| relative names (`father*`, `mother*`, `spouse*`, `parent*`, `other*`) | **Keep-matching / keep-silent / drop-contradicting** — see below. Enumerated for `father*`, `spouse*`, `mother*` and `parent*`, on marriage records in two countries (Brazil, England) — see the exact-match rule above for which verdict covers which family. `other*` is excluded by decision, not untried: `R.verdict:other names behave like the four kinship families` reads NOT MEASURED | Drops the silent records *and* variant forms the unqualified search did reach: on a pool read in full, `João Baptista` and `Thiago J` are present unqualified and absent from the `.exact` set. Whether it drops indexed **abbreviations** specifically is NOT MEASURED — that enumerated unqualified set contained no abbreviated form to drop, and the `Wm:52 Wm.:31` of 300 that stood here is a sample of a pool too large to enumerate |
| `<event>Place` | Expands upward far enough that a county scope barely discriminates — from the same query, the **wrong** Arkansas county returned the same total as the right one to within 0.1% (about 35,500 each). Two *different* English counties measured counts 0.001% apart (`dev/explore-wildcard-scope.ts`), so treat an unqualified county scope as no scope at all | It makes the count meaningful. Its effect on ordering was not measured beyond one target, which ranked first either way. Useful mainly where a total has to mean something (an exhaustiveness claim) |
| `<event>Year` | An unqualified range matches by **estimate overlap**: a record with no year of its own carries an estimated date range (from the dated facts of others on it) and is returned whenever it overlaps — so no record is kept regardless of the range (`H.verdict:index-silent personas exist` = NO), and an unqualified range reliably *includes* estimate-dated records — for the birth, death and marriage families; record-index **residence** is collection-dependent (`Q.bands:records-residence` = every row dated, `.exact` changes nothing, so `Y.verdict:generalises past birth (impossible-range)` = DOES NOT GENERALISE reads that one pool; `Q.bands:records-uscensus-residence` = `.exact` drops a meaningful fraction), behaving like the rest wherever records are dated only through others. `any` was never tested | `.exact` keeps only records whose indexed date is inside the range, dropping the estimate-overlap matches — a reliable *exclude* (`H.verdict:.exact requires the indexed date inside the range`). A cohort that is not always small — up to roughly a quarter of a census pool — has no indexed date in the swept span and is reached by no bounded range, so read the results back rather than trust a range to gather them; whether `.exact` also drops in-range *approximate* dates is unmeasured. Use only with a firm date |
| `recordCountry` | **Already strict** — `q.recordCountry=Narnia` returns 0 rather than being ignored | No flag exists and none is needed |
| `recordSubdivision` | **Already strict**, measured the same way as `recordCountry`: a nonexistent subdivision returns 0 rather than being ignored, and a real one (`Alabama`) cut a 14,035,394 country total to 342,439. Note the scope — this establishes only that the value is *honoured*, not how a place scope EXPANDS. Whether dropping to a state-level scope rescues a search that nils at county level is a separate, unfinished place investigation and is not answered here | No flag exists and, on this evidence, none is needed |

**Relative names keep records where the relative is absent.** This is
correct as designed, and worth stating because it is invisible to the
caller. A 300-result survey on the father's given name — **SAMPLED**, from a
pool far too large to enumerate, so read the columns as indicative and the
enumerated version below as the finding:

| Query | Results naming a father | Top father names |
|---|---|---|
| baseline (no father term) | 262 | `John:54 William:22 James:17` |
| `q.fatherGivenName=William` | 283 | `William:192 Wm:52 Wm.:31` |
| …plus `.exact=on` | 295 | `William:294` (no `Wm`/`Wm.`) |
| real but rare (`Zachariah`) | 7 | `Zachariah:2 Zachie:1 Zacharius:1` |
| gibberish father name | **1** | `Jno:1` |

Re-measured 2026-08-08. The earlier figures (104 / 287 / 300 / **0**) were
artifacts of the probe's father detection falling back to a role regex —
`person.gender` is an object, so a string comparison against it never fired.
The column counts records that *name* a father, which is a lower bound on
father-bearing: a record can carry an indexed parent with no readable name.
Measured the same day, the gibberish row names no father in 299 of 300 but
only 292 carry no indexed parent at all.

The gibberish row — 1 father-bearing result of 300 sampled — points the
same way, and the question was then settled by enumeration rather than
sampling. Reading whole result sets to the end on two marriage populations
(Brazil / `Bochenek`, 521 rows; England / `Pocklington`, 469 rows) and on the
`father`, `spouse`, `mother` and `parent` families: an unmatchable name left
**zero** records naming a different relative, retained exactly the records the
baseline was silent about, and — wherever the baseline held a real relative
name to draw from — a real name returned matching records. Retention therefore
equals the baseline's silent share: for `father`, 70.2% against 70.2% (Brazil)
and 92.8% against 92.8% (England); for `mother`, 70.1% against 70.1% and 99.1%
against 99.1%; for `parent`, 70.1% against 70.1% and 92.8% against 92.8%; for
`spouse`, 10.2% against 9.8% and 81% against 81%. That is what makes the
between-relative difference an artifact of how often each is indexed, not a
property of the parameter. The one leg not exercised is the real-name control
for `mother` in England: that pool indexes no mother given name at all, so there
was none to draw — the keep-silent side still held (99.1% against 99.1%), and
the presence requirement is confirmed for `mother` on Brazil alone.

So an unqualified relative name keeps matching records, keeps records where
that relative was never indexed, and drops contradicting ones — the right
trade, since absence in an index is not disconfirming and sparse entries
often omit parents. **A caller cannot currently tell the first case from the
second:** a father-anchored hit may contain no father at all.

These semantics are **not** unit-testable — the URL-shape tests assert
the string the tool builds, never that FamilySearch honors it. They are
reproduced by `dev/probe-search-qualifiers.ts`.

**Response shape:**

```
response.results                                              -> total match count
response.index                                                -> current offset (0-based)
response.links.next?.href                                     -> next-page URL (omitted on last page)
response.entries[]
  .id                                                         -> persona ID (e.g. "6K9K-3HN9")
  .score                                                      -> relevance score (number)
  .confidence                                                 -> 1-5 (number)
  .hints[]                                                    -> tree-person match suggestions
    .id                                                       -> ark of a tree person (e.g. "ark:/61903/4:1:GQWZ-GPX")
    .stars                                                    -> 0-5 match confidence
  .content.gedcomx.persons[]                                  -> can have multiple entries on household records
    .principal                                                -> boolean (multiple principals possible per record)
    .id                                                       -> internal ID (e.g. "p_298200778681")
    .display                                                  -> pre-normalized fields
      .name                                                   -> string
      .gender                                                 -> "Male" | "Female"
      .birthDate                                              -> string (e.g. "12 February 1809")
      .birthPlace                                             -> string
      .deathDate                                              -> string (when known)
      .deathPlace                                             -> string (when known)
      .role                                                   -> "Principal" | other
    .names[0].nameForms[0].fullText                           -> fallback name
    .gender.type                                              -> URL form (often missing)
    .facts[]
      .type                                                   -> URL, e.g. "http://gedcomx.org/Birth"
      .date.original                                          -> string
      .place.original                                         -> string
      .value                                                  -> string (for non-event facts)
    .identifiers["http://gedcomx.org/Persistent"][0]          -> ark URL of the persona
  .content.gedcomx.sourceDescriptions[]
    [0]                                                       -> the COLLECTION
      .resourceType                                           -> "http://gedcomx.org/Collection"
      .about                                                  -> "https://familysearch.org/collections/{id}"
      .titles[0].value                                        -> collection name
    [1]                                                       -> the RECORD
      .titles[0].value                                        -> record description
      .identifiers["http://gedcomx.org/Persistent"][0]        -> record ark URL
```

Some entries have multiple persons (e.g., census records list a
whole household). The mapping logic below picks the right person
for the entry.

---

## Mapping Logic

For each `entry` in `response.entries`:

1. **Find the persona this entry represents.** Take the entry's
   `id` (e.g., `"6K9K-3HN9"`) and find the person in
   `entry.content.gedcomx.persons[]` whose
   `identifiers["http://gedcomx.org/Persistent"][0]` ends in that
   ID. If no match, fall back to the first `principal: true`
   person. If still no match, skip the entry.

2. `recordId` ← the persona's Persistent ARK
   (`person.identifiers["http://gedcomx.org/Persistent"][0]`), normalized to
   canonical `ark:/61903/1:1:...` form. Falls back to constructing
   `ark:/61903/1:1:<entry.id>` when the represented person carries no
   Persistent identifier.

3. `personName` ← `person.display?.name`, falling back to
   `person.names[0].nameForms[0].fullText`.

4. `score` ← `entry.score`. `confidence` ← `entry.confidence`.

5. `sex` ← `person.display?.gender` if present (already `"Male"`
   or `"Female"`); otherwise the last path segment of
   `person.gender?.type`; otherwise undefined.

6. `birthDate` ← `person.display?.birthDate`, falling back to the
   `original` field of the `person.facts[]` entry whose `type`
   ends in `"/Birth"`. Same pattern for `birthPlace`, `deathDate`,
   `deathPlace`.

7. `events[]` ← every `person.facts[]` whose type isn't Birth or
   Death:
   - `type` ← last path segment of `fact.type`
   - `date` ← `fact.date?.original`
   - `place` ← `fact.place?.original`
   - `value` ← `fact.value`
   - Skip facts with none of date / place / value.

8. (The persona ARK is surfaced as `recordId`; see step 2. There is no
   separate URL field.)

9. **Collection fields** ← from the `sourceDescriptions[]` entry
   whose `resourceType` is `"http://gedcomx.org/Collection"`:
   - `collectionUrl` ← `sd.about`
   - `collectionId` ← parsed from the URL path
     (`/collections/{id}` → `id`)
   - `collectionTitle` ← `sd.titles[0].value`

10. **Record fields** ← from the next `sourceDescriptions[]` entry
    (typically `[1]`):
    - `recordTitle` ← `sd.titles[0].value`
    - `recordArk` ← `sd.identifiers["http://gedcomx.org/Persistent"][0]`,
      normalized to canonical `ark:/61903/...` form

    Both are undefined if the record-level entry is missing.

11. `treeMatches[]` ← `entry.hints?.map(h => ({
    treePersonId: <h.id with the "ark:/61903/4:1:" prefix stripped>,
    stars: h.stars }))`, sorted by `stars` descending. The
    extraction is "take everything after the last `:`" — e.g.,
    `"ark:/61903/4:1:GQWZ-GPX"` → `"GQWZ-GPX"`. Empty array when
    `hints` is absent.

12. `gedcomx` ← `entry.content.gedcomx` passed through `toSimplified()`
    (`src/utils/gedcomx-convert.ts`). The output conforms to
    `SimplifiedGedcomX` as defined in `simplified-gedcomx-spec.md`. Omitted
    when the entry has no `content.gedcomx`.

13. `primaryId` ← `person.id` (the persona resolved in step 1). It always
    matches one of `gedcomx.persons[].id`, since `toSimplified` preserves
    person ids. Omitted when that persona carries no `id`.

14. `batchNumber` ← the `text` of the first value in
    `entry.content.gedcomx.fields[]` whose `labelId` is `"FS_UDE_BATCH_NBR"`.
    Read off the RAW gedcomx, not `result.gedcomx`: `toSimplified` does not
    carry the root `fields[]` into the simplified document. Matched on
    `labelId` alone — **not** on the field's `type` URI, which is spelled both
    `UdeBatchNbr` and `UdeBatchNumber` across collections. Only the ROOT array
    is read; the `fields` on persons/names/facts/places carry other content.
    Omitted when no such field is present, which is the common case. See
    [`batchNumber`](#batchnumber--the-only-route-to-a-batch-you-can-enumerate).

**Top-level fields:**

- `query` ← echo of input (only fields the caller supplied).
- `totalMatches` ← `response.results`.
- `paginationCappedAt` ← `4999` (constant).
- `returned` ← `entries.length`.
- `offset` ← `response.index ?? 0`.
- `hasMore` ← `response.links?.next?.href != null`.
- `results` ← the mapped `RecordSearchResult[]`.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No anchor field present | Throw: `"search needs at least one anchor: surname, recordCountry or batchNumber. Searches without an anchor are too expensive on the FamilySearch API."` |
| `batchNumber` combined with `recordCountry` or `recordSubdivision` | Throw: `"do not combine batchNumber with recordCountry or recordSubdivision: a batch anchors on its own, and a record-jurisdiction filter that does not match the batch silently returns 0 (indistinguishable from a wrong batch). Drop them and send the batch alone; narrow with surname if needed."` |
| `count` outside `[1, 100]` | Throw: `"count must be between 1 and 100."` |
| `offset` negative | Throw: `"offset must be non-negative."` |
| `offset + count > 4999` | Throw: `"offset + count must be <= 4999 (FamilySearch search depth limit). Narrow the query instead of paging deeper."` |
| Year input not a 4-digit year | Throw: `"<field> must be a 4-digit year (e.g., 1809)."` |
| `<event>YearFrom` without `<event>YearTo` (or vice versa) | Throw: `"<event>YearFrom and <event>YearTo must be provided together."` |
| `<event>YearFrom > <event>YearTo` | Throw: `"<event>YearFrom must be <= <event>YearTo."` |
| `recordSubdivision` without `recordCountry` | Throw: `"recordSubdivision requires recordCountry."` |
| `sex` not in `{Male, Female, Unknown}` (case-insensitive) | Throw: `"sex must be 'Male', 'Female', or 'Unknown' (case-insensitive)."` |
| `maritalStatus` not in the four allowed values (case-sensitive) | Throw: `"maritalStatus must be exactly one of: 'Married', 'Single', 'Divorced', 'Widowed' (case-sensitive)."` |
| `recordType` not in the eight allowed values | Throw: `"recordType must be one of: birth, marriage, death, census, immigration, military, probate, other."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error. |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"FamilySearch search blocked the request. The User-Agent header was rejected by the WAF — check that the MCP server is running an unmodified build."` |
| API returns 400 | Read response body as JSON, extract `body.errors[]`, join with `; `. Throw: `"FamilySearch search rejected the query: ${detail}."` Fall back to a generic message if the body isn't parseable. |
| API returns 429 or 5xx | Transient. Retried with backoff (3 attempts). If still failing after retries, surfaced via the network/timeout terminal error below — NOT returned as a short/empty result set. |
| Request times out (per-attempt `AbortSignal.timeout`, 25s) or `fetch` rejects (network error) | Transient. Retried with backoff (3 attempts). If still failing, throw: `"FamilySearch record search did not complete after 3 attempts (network timeout or transient error): ${detail}. This is a transient failure, NOT an empty result — coverage is unknown."` The distinguishable message is the point: a timed-out search must never look like an exhaustive one that found little. |
| API returns other non-OK status (non-retryable, e.g. 404 or other 4xx) | Throw: `"FamilySearch search API error: ${status} ${statusText}"`. (429/5xx do NOT reach here — see the retried row above.) |
| API returns 200 with empty `entries` | Return `{ ..., totalMatches: <upstream>, returned: 0, results: [], hasMore: false }`. |

---

## Caching

No caching. Search queries are query-specific and high-cardinality
— caching wouldn't pay off and would risk staleness when new
records are added.

---

## Files

### `packages/engine/mcp-server/src/types/record-search.ts`

API response types (`FSSearchResponse`, `FSSearchEntry`, `FSPerson`,
`FSDisplay`, `FSFact`, `FSSourceDescription`, `FSHint`, `FSField`,
`FSFieldValue`) and tool I/O types (`RecordSearchInput`,
`RecordSearchResult`, `RecordSearchEvent`, `TreeMatch`,
`RecordSearchToolResponse`).

`FSField` / `FSFieldValue` declare the entry-level `fields[]` array that
`FSGedcomx` now carries — the batch number's home.

### `packages/engine/mcp-server/src/types/relative-terms.ts`

`KinPrefix`, `KinTerm`, `RelativeTermStatus`,
`RelativeTermFinding`, `RelativeTerms`. A third module rather than either
tool's own types file: `types/record-search.ts` already imports from
`types/rank-search-matches.ts`, which imports nothing, so declaring these in
either and importing from the other would make the two mutually importing.

### `packages/engine/mcp-server/src/tools/record-search.ts`

- `recordSearchToolSchema` — MCP tool schema (the JSON above).
- `recordSearchTool(input)` — main entry point: validate, authenticate,
  fetch, map, return.
- `validateInput(input)` — anchor rule + per-field validation.
  Throws LLM-aimed errors.
- `applyAltNameAutoPair(input)` — fills the missing alt half
  (`givenNameAlt = givenName` if only `surnameAlt` is set; mirror
  for the inverse).
- `buildSearchUrl(input)` — query-parameter builder. Maps each
  input field to its `q.*` / `f.*` parameter, applies `.exact`
  modifiers, encodes values, applies the default `m.*` flags.
- `mapEntry(entry, terms?)` — `FSSearchEntry → RecordSearchResult` mapping
  (the 11-step procedure above). `terms` is the `KinTerm[]` from
  `suppliedKinTerms` — a prefix plus the names the caller gave, which `other`
  resolves against; omitted, no `relativeTerms` is emitted.
- `extractEvent(fact)` — `FSFact → RecordSearchEvent`.
- `findRepresentedPerson(entry)` — the persona match used in step 1 of mapping.
  Returns `{ person, anchor }`, where `anchor` is `"ark"` for a positive
  identification and `"principal"` for the fallback guess. `relativeTerms`
  refuses to resolve on a `"principal"` anchor.
- `suppliedKinTerms(input)` — which relative terms the caller supplied a *name*
  for, and the names. Ignores the `*Exact` booleans. `other` needs the names
  themselves; the four role-based prefixes ignore them.
- `resolveRelativeTerms(gedcomx, primaryId, terms, anchor)` — pure resolver
  over the simplified doc. See the `relativeTerms` section above.
- `parseUpstreamErrorBody(body)` — pull `errors[]` from a 400
  response body.

### `packages/engine/mcp-server/src/index.ts`

Register `recordSearchTool` following the existing tool pattern (import,
ListTools, CallTool — same as `place_search`, `collections_search`).

---

## Testing

### `tests/tools/record-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns ranked results for surname + givenName | Happy path |
| 2 | Returns results for country-scoped search (`recordCountry` only, no surname) | Anchor rule — recordCountry qualifies |
| 3 | Returns results for surname + alt-name UNION (`surnameAlt` only) | Single-alt UNION + auto-pair fills `givenNameAlt` |
| 4 | Returns results for surname + alt-name UNION (`givenNameAlt` only) | Auto-pair fills `surnameAlt` |
| 5 | Throws when no anchor is supplied (only givenName + birthPlace) | Anchor rule rejection |
| 5a | `batchNumber` alone satisfies the anchor rule | Batch anchors by itself |
| 5b | The anchor error names `batchNumber` | Error must not omit an accepted anchor |
| 5c | Rejects `batchNumber` combined with `recordCountry` | Structural anchor for the pairing rule — prose alone decays (architecture.md §3.1) |
| 5e | Rejects `batchNumber` combined with `recordSubdivision` | Same class of jurisdiction filter, same silent-zero risk; caught in one step rather than via the requires-recordCountry detour |
| 5d | Allows `batchNumber` combined with `surname` | 5c must not be satisfied by rejecting every companion field |
| 6 | Throws when count > 100 or count < 1 | Bound check |
| 7 | Throws when offset + count > 4999 | Pagination cap |
| 8 | Throws when `<event>YearFrom` is supplied without `<event>YearTo` | Range pair validation |
| 9 | Throws when `<event>YearFrom > <event>YearTo` | Range order validation |
| 10 | Throws when `recordSubdivision` is supplied without `recordCountry` | Subdivision pair validation |
| 11 | Throws on `sex` other than Male/Female/Unknown (case-insensitive) | sex enum validation |
| 12 | Throws on `maritalStatus` other than the four allowed values (case-sensitive) | maritalStatus enum validation |
| 13 | Throws on `recordType` other than the eight allowed values | recordType enum validation |
| 13a | Throws on an inherited `Object.prototype` key (`"constructor"`) as `recordType` | recordType enum validation, own-property only |
| 13b | Never emits a non-numeric `f.recordType`, even when `buildSearchUrl` is called without `validateInput` | Emit-site invariant |
| 14 | Builds URL with all `q.*` params correctly | Param mapping |
| 15 | `surnameExact=true` emits both `q.surname.exact=on` and `q.surname.exact.1=on` when `surnameAlt` is set | Modifier + cardinality stack |
| 16 | `birthYearExact=true` emits `q.birthLikeDate.exact=on` | Year-exact mapping |
| 17 | `birthPlaceExact=true` emits `q.birthLikePlace.exact=on` | Place-exact mapping |
| 18 | `recordSubdivision` is composed into `q.recordSubcountry=<country>,<subdivision>` | Subdivision composition |
| 19 | `recordType="marriage"` maps to `f.recordType=1` | Record-type enum mapping |
| 20 | Default flags `m.queryRequireDefault=on` and `m.defaultFacets=off` are sent on every request | Default flag enforcement |
| 20a | The `.exact=on` **semantics** documented under "What `.exact=on` actually does" are NOT asserted here — the URL-shape rows above check the string the tool builds, never that FamilySearch honors it. Reproduced by `dev/probe-search-qualifiers.ts` against the live API | Live-behavior evidence trail (deliberately outside vitest) |
| 21b | `imageGroupNumber` maps to `q.filmNumber` | Film-number param mapping |
| 21c | `imageGroupNumber` accepts split DGS format | Split DGS format passthrough |
| 21d | `batchNumber` maps to `q.batchNumber` | Batch-number param mapping |
| 21e | `batchNumber` passes through unaltered whatever shape it is given (letter + 6 digits, dashed, all-numeric, leading zero) | Shape passthrough — the tool must not reformat a batch, and a leading zero must survive |
| 21 | Throws auth error when not authenticated | Auth propagation |
| 22 | Throws on 400 with extracted error-body detail | API validation errors |
| 23 | Falls back to generic 400 message when body isn't parseable | Defensive parsing |
| 24 | Throws on 401 with re-login guidance | Token-expired path |
| 25 | Throws on 403 with WAF/UA guidance | WAF rejection |
| 26 | Returns empty results when entries is empty | Zero-match handling |
| 27 | Maps entry → RecordSearchResult correctly using `display{}` first, `facts[]` fallback | Field mapping |
| 28 | Surfaces `treeMatches` from `entry.hints` sorted by stars descending | Tree-match surfacing |
| 29 | Resolves the represented persona by ark suffix when there are multiple principals | Multi-principal handling |
| 30 | Sets `hasMore: true` when `links.next` exists | Pagination flag |
| 31 | Echoes `totalMatches` and `paginationCappedAt` correctly | Total-count surfacing |
| 35 | `father: absent` when the record names only the mother | **The issue's case.** `absent` must stay reachable |
| 36 | `father: absent` when the record names no parents at all | The other route to `absent` |
| 37 | `father: present` with the parent's name | Positive path |
| 38 | `unknown`, not `absent`, when the parent carries no `gender` key | False-denial guard (shape 1) |
| 39 | `unknown`, not `absent`, when `gender` is the literal `"Unknown"` | False-denial guard (shape 2) |
| 40 | The sex gate does not leak into the sex-agnostic `parent` prefix | Prefix isolation |
| 41 | `unknown` for every prefix when the persona has no id | `unknown` trigger 1 |
| 42 | `unknown` for every prefix on the `principal` anchor fallback | `unknown` trigger 2 |
| 43 | `unknown` when `relationships` is missing **or** `[]` | `unknown` trigger 3 |
| 44 | `mother` is not satisfied by a male parent | Sex discrimination |
| 45 | `spouse` reports the *other* Couple endpoint, not the persona | Couple symmetry |
| 46 | `spouse: unknown` when both endpoints are the persona | Degenerate Couple row |
| 47 | `spouse: absent` when there is no Couple row | Negative path |
| 48 | `name` joins given + surname and tolerates a missing surname | Name derivation |
| 49 | `relativeTerms` emitted only when a relative *name* was supplied | `*Exact` alone does not count |
| 50 | `other` resolves by name match against co-people | No relationship role exists |
| 51 | `other` is `unknown`, not `absent`, when no co-person name matches | Exact compare vs FS's fuzzy one |
| 52 | `other` matches across case and punctuation | `Wm.` vs ` wm ` |
| 53 | `other` is `absent` only when the record has no co-person | The one reachable denial |
| 54 | `other` still answers when the relationship graph is missing | It reads `persons[]`, not the graph |
| 55 | Survives the staged slim block, inline **and** in the sidecar on disk | The integration the design turns on |
| 56 | `batchNumber` read when the type is spelled `UdeBatchNbr` | One of the two live spellings |
| 57 | `batchNumber` read when the type is spelled `UdeBatchNumber` | The other live spelling — a one-spelling matcher misses these collections |
| 58 | Read on an unknown type spelling, keyed on `labelId` alone | Pins the design: a third spelling must not silently return nothing |
| 59 | Person-level `fields` (`PR_AGE`, `Role`) never yield a batch | Only the gedcomx ROOT array is the batch's home |
| 60 | Field omitted entirely on a record that traces to no batch | Absence is not a value; most records have none |
| 61 | Read past other root fields (`FilmNumber`, `RecordGroup`, `UniqueId`) | Position independence within the array |
| 62 | Survives the staged slim block, inline **and** in the sidecar | The staged case is the normal one; proven by sabotage |
| 63 | Reaches `ranked[].batchNumber` on a `subjectId` search | The projection a subject-named search actually reads |

Numbering continues from 31; 32–34 are the staging/`rankingSkipped` tests added
after this table was last extended. Cases 35–55 cover `relativeTerms`; 56–63
cover `batchNumber`.

### Smoke-test script

```bash
cd packages/engine/mcp-server
npx tsx dev/try-record-search.ts Lincoln Abraham
npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809
npx tsx dev/try-record-search.ts Smith --collection 1743384 --marriage-year 1830 1850
npx tsx dev/try-record-search.ts --given Mary --country "United States"  # surname-less + country anchor
npx tsx dev/try-record-search.ts Lincoln --alt Todd --given Mary    # maiden+married name
npx tsx dev/try-record-search-film.ts Smith --film 004010852       # film-number filter
npx tsx dev/try-record-search-film.ts Smith --film 004010852 --given John --birth-year 1850

npx tsx dev/probe-batch-field.ts   # evidence trail behind `batchNumber`
```

---

## Verification

### Automated

```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- `search({ surname: "Lincoln", givenName: "Abraham", birthYearFrom: 1809, birthYearTo: 1809, birthPlace: "Kentucky" })` — top results should be Abraham-Lincoln-named records with `collectionId`, `collectionTitle`, and (for many) `treeMatches` populated.
- `search({ recordCountry: "United States", givenName: "John" })` — should succeed (recordCountry is an anchor).
- `search({ givenName: "John" })` — should fail with the anchor-rule error.
- `search({ surname: "Lincoln", count: 200 })` — should fail with the count-bound error.
- `search({ surname: "Lincoln", offset: 4998, count: 3 })` — should fail with the pagination-cap error (sum 5001).
- `record_search` without logging in — should return the auth error.

### Manual Layer 2 (Claude Code)

- *"Search FamilySearch for Abraham Lincoln, born 1809 in Kentucky."* — Claude calls `record_search` with a tight birth-year range, surfaces the top results.
- *"Find John Smith in Alabama marriage records from the 1830s."* — Claude chains `collections_search` then `record_search`, scoping by `collectionId` + `marriageYearFrom`/`marriageYearTo`.
- *"Look for Mary Todd Lincoln by both her names."* — Claude calls `record_search` with `surname: "Lincoln"` + `surnameAlt: "Todd"` (auto-pair fills `givenNameAlt`).
- *"Show me records that have a tree-person match suggested."* — Claude inspects `treeMatches` in returned results.

### Manual Layers 3 + 4 (Cowork via WSL2 + native Windows)
Standard end-to-end testing per `docs/testing-guides/oauth-tool-testing-guide.md`
template. Detailed playbook in `docs/testing-guides/search-tool-testing-guide.md`.

---

## What changed from v1 (summary for reviewers)

For anyone comparing this against `docs/specs/search-tool-spec.md`,
the headline changes:

1. **Endpoint switched** from `/platform/records/personas` to
   `/service/search/hr/v2/personas`. Reasons: 100× corpus,
   `f.collectionId` works, cleaner errors. Trade-off: leaner
   per-entry shape, browser-UA requirement.
2. **Anchor rule replaces "surname required"**: `surname`,
   `recordCountry` or `batchNumber` qualifies — and nothing else.
   Reflects the throttling concern (cheap anchors required). An
   earlier draft of this list also named `collectionId`,
   `maritalStatus`, a year-range and `requireFields`; none of those
   was ever accepted by `validateInput`, and the canonical statement
   is the "Anchor rule (design note)" section above.
3. **`collectionId` is a first-class input** (single value only,
   not array — multi-collection results aren't balanced).
4. **`requireFields` modifier input added**. Upgrades any
   `q.*` hint to a hard filter via `.require=on`.
5. **`recordCountry`, `maritalStatus`, `birthYearFrom/To` filter
   inputs added** (true narrowing filters from the search service's
   `f.*` family).
6. **`surnameAlt` / `givenNameAlt` inputs added** for alternate-name
   workflow (cardinality `.1` UNION semantics).
7. **`treeMatches` output field added** — surfaces FS's own
   tree-person match suggestions.
8. **`collectionId`, `collectionTitle`, `collectionUrl` outputs
   added/fixed** — derived from `sourceDescriptions[0]` (the
   collection entry), not the v1-mislabeled `/externalId/easy/` URL.
9. **`recordArk` output added** — the per-record source ark (`1:2:`),
   distinct from the persona ark (`recordId`, `1:1:`). Both in canonical
   `ark:/61903/...` form.
10. **`personaApiUrl` output dropped** — search service has no
    equivalent re-fetch URL. The persona ark itself is the
    persistent identifier.
11. **`birthDate`, `birthPlace`, `deathDate`, `deathPlace`
    surfaced as top-level RecordSearchResult fields** (previously buried
    in `events[]`). Sourced from `display{}` for normalization.
12. **Mapping logic uses `display{}` first**, falls back to
    `facts[]` only when fields are missing. Simpler and more
    reliable.
13. **Mapping finds the persona by ark suffix**, not by picking
    the first principal. Fixes the multi-principal records issue
    flagged in v1 review.
14. **Date inputs are year-only** — same finding as v1, here
    re-confirmed for the search service.
15. **No 204 handling needed in v1** of the tool (defensive code
    only) — search service never returns it in our probes.
16. **400 errors come from response body, not Warning header** —
    simpler error parser than v1 (no Warning-header regex).
17. **Pagination cap is `offset + count >= 5000`**, not v1's
    `offset >= 4999`.
18. **`Accept-Language: en` header** required to prevent locale
    leak in `display{}` strings.
19. **Browser User-Agent header** required (WAF) — same constant
    as `collections_search`.

Everything in this spec is grounded in evidence from probe scripts
under `packages/engine/mcp-server/dev/probe-svc-*.ts` (run April 30 – May 4,
2026, ~170 queries total).
