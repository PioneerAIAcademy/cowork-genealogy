# Person Quality Tool — Implementation Spec

## Overview

An MCP tool that reads a person's **data-quality score** from
FamilySearch's person-quality-score service and returns the per-issue
findings to the LLM and tries to keep the LLM's context lean.

Given a FamilySearch tree-person ID, the tool calls the quality scores
endpoint, reads the live (non-dismissed) `issues`, maps each issue's
`(issueType, conclusionType)` to an English sentence template (sourced
from the FamilySearch "Data Quality Score – English Sentence Templates"
table; see `Person-Data-Quality-Score-Sentences.pdf`), interpolates the
issue's data fields into the template, and returns the finished
sentences.

Requires authentication (OAuth tokens from the `login` tool). The MCP
code is HTTP-only — it does not import any FamilySearch internal code.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personId` | string | Yes | Tree-person id. A FamilySearch person id (e.g. `"KD96-TV2"`) is scored; any other id is answered without a network call — see "Non-FamilySearch ids" below. camelCase at the MCP boundary, per repo convention. |
| `detail` | boolean | No | Opt in to the per-fact and per-source breakdown. Defaults to `false`, and when it is off the response is byte-identical to what it was before the flag existed. |

Example:
```json
{ "personId": "KD96-TV2" }
{ "personId": "KD96-TV2", "detail": true }
```

> Unlike `person_ancestors`, `personId` is **required** — there is no
> "current user" default. Quality scoring always targets a named person.

---

## Non-FamilySearch ids

An id that is not a FamilySearch person id is answered **before** the token is
read and **without** a network call:

```json
{ "ok": false, "reason": "not_familysearch_id",
  "errors": ["No FamilySearch quality score was retrieved for this person."] }
```

**What counts as a FamilySearch person id.** Four characters, a hyphen, three
characters, drawn from A–Z and 0–9 minus the vowels, compared case-insensitively
after trimming (`isFamilySearchPersonId`, `src/utils/fs-id.ts`, shared with
`match-engine.ts`). Every FamilySearch-shaped person id across the eval scenarios,
the e2e fixtures and the person-quality/person-read MCP fixtures passes (846, none
rejected, 2026-09-24); every reject is a project-local id (`I1`, `P3`) or a
placeholder.

**Why here, and why before the token.** FamilySearch's quality service scores a
person it already holds; it does not score data sent to it. Asked for `I1` it
answers `400 Invalid j-encoded identifier: I1`, and POSTing a person to
`/quality/person`, `/quality/person/scores` or `/quality` returns 404 (probed
2026-09-24). So there is nothing to fetch. Answering before `getValidToken` means
a researcher who is not logged in is never told to log in for such a person, and
it moves the "is this a FamilySearch id?" decision out of every calling skill's
prose into one tested function.

**Why the message says what was done, not what the person is.** `init-project`
gives each person it imports from FamilySearch a local id **and** keeps the
FamilySearch link in `ark` (`{"id": "I1", "ark": "ark:/61903/4:1:MKVT-7XR"}`), and
callers pass the local id. A sentence such as "not on FamilySearch" would be false
for exactly those people. The message names no id and no id type, so a caller that
relays it cannot leak either.

**Known gap.** Because callers pass the local id, an imported person never gets a
FamilySearch quality score even though their FamilySearch id sits in `ark`.
Scoring them means resolving `ark` to the FamilySearch id, which needs the project
tree — outside this tool's contract today.

**The FamilySearch 400 path is unchanged.** An id that passes the shape check but
that FamilySearch still refuses (a mistyped real id) keeps the existing error, so
a researcher's typo is reported as a typo rather than masked as "no score".

---

## Upstream API

### Endpoint

```
GET {HOST}/service/tree/tree-data/quality/person/{personId}/scores
```

**Host: `sg30p0.familysearch.org`** — used in **all environments**, including
production (review decision). Verified 2026-06-29: returns the response shape
below. A clean captured sample lives at
`personal/person-quality/sample-response-KD96-TV2.json` (developer reference;
not shipped).

> Note: dev testing exercised the beta-bearer-token path against `sg30p0`. The
> tool uses `getValidToken(principal)` (production `familysearch.org` OAuth tokens) at
> runtime; a full production-token run through OAuth login was not exercised in
> design, but `sg30p0` is the sanctioned host per review.

> **OPEN — query params:** the PDF shows variants
> (`?limitScope=false`, `?scoresToCalculate=…`). The verified call used none
> and returned all four categories; confirm no params are needed in production.

### Auth & headers

- **Token:** `getValidToken(principal)` from `src/auth/refresh.ts` — the single
  entry point. It auto-refreshes and throws the standard LLM-instruction
  error ("Call the login tool to authenticate.") when no valid session
  exists; the handler lets that propagate. Do **not** re-implement token
  plumbing.
- **`Authorization: Bearer <token>`**
- **`User-Agent`:** `BROWSER_USER_AGENT` from `src/constants.ts`.
  FamilySearch sits behind Imperva and 403s non-browser UAs; the
  `/service/...` web host is the Imperva-fronted surface, so the browser
  UA is required (unlike the `api.familysearch.org` platform host).
- **`Accept: application/json`**

Status codes (verified 2026-06-29) are documented in *Error Handling*.

### Response shape

The **structure and field names** here are observed from the live
`KD96-TV2` response. One field row (flagged below) is sourced from the PDF,
**not** seen in this sample.

Top level: `{ isValid, personScores, visibility }`. All data is under
`personScores`:

| Path | Meaning |
|------|---------|
| `personScores.issues[]` | Live (non-dismissed) issues — the source of the sentences. |
| `personScores.dismissedIssues[]` | Issues the user dismissed. **Excluded from output** (decided in review) — only `issues[]` is rendered. |
| `personScores.completenessScore` / `verifiabilityScore` / `consistencyScore` / `coherenceScore` | Per-category score `{ rawNumerator, displayNumerator, denominator, displayScore, rawScore }`. |
| `personScores.overallDisplayScore` / `overallRawScore` | Overall 0–1 score (e.g. `0.97`). |
| `personScores.segment` | Cohort the score benchmarks against (e.g. `"Norway 1816 - 1920"`). |
| `personScores.pid`, `lang`, `visibility` | Person ID, language, and visibility (`PUBLIC` for a normal visible person). Not included in the output. |
| `personScores.conclusionScores[]` | A **per-fact score breakdown**: one entry per conclusion (each NAME, BIRTH, BURIAL, …) giving that single fact's four sub-scores, plus `affectingIssueIds` = which issues are dragging that fact's score down (e.g. the BURIAL conclusion's completeness is lowered by its `MISSING_EVENT_DATE` issue). It's the granular "why" behind the category scores. **Included only when `detail: true`** (it was excluded outright until the flag existed). 14 entries on `KD96-TV2`; `relationshipId` is present on the 2 MARRIAGE entries only, and absent from entries 0–2, so a reader sampling the first entry will miss it. Every one of the 7 non-empty `affectingIssueIds` joins onto `issues[].id` with no misses. |
| `personScores.sourceClusters` | **An object, not an array** — `{ sourceClusters: [...], conflicts: [...] }`. This row read `sourceClusters[]` and was wrong; a type written from the old row does not compile against the live body. Verified against `KD96-TV2` by `dev/probe-person-quality-detail.ts`. **Included only when `detail: true`.** |
| `personScores.sourceClusters.sourceClusters[]` | The **attached-sources list**: clusters of sources, each source carrying `uri`, `title`, and the conclusions it touches with `agreesWithSource` true/false. It's the evidence behind consistency scoring (does this census/record agree with the tree?). 21 clusters / 28 sources on `KD96-TV2`, sizes `[6, 3, 1×19]`. A single source may repeat the same conclusion id inside its own `conclusions[]` — 13 of the 28 did — so any per-conclusion inversion must dedupe. |
| `personScores.sourceClusters.conflicts[]` | **Which two attached sources disagree, and about what**: `{ sourceUris: [a, b], conflictingFields: [{ name, values }] }`, e.g. `name: "Birth Date"`, `values: ["+1877", "+1876-10-02"]` (values carry a leading `+`, GedcomX formal-date syntax, not a typo). `sourceUris` is always exactly two. Undocumented upstream, and unmodeled here until the flag existed. **Pairwise and heavily duplicated**: 50 entries on `KD96-TV2` encode 5 real disagreements, since one disagreement is restated once per source pair. **Included only when `detail: true`**, and reduced — see Output. |

Each `issues[]` element carries the fields below. The first six rows were
**observed** in the `KD96-TV2` sample; the *Use* column is the proposed
disposition. The **last row is from the PDF, not the sample** — those
issueTypes did not occur for this person.

| Field | Always? | Use |
|-------|---------|-----|
| `issueType` | yes | Template lookup key (e.g. `MISSING_EVENT_DATE`). |
| `scoreType` | yes | Category: `COMPLETENESS` / `VERIFIABILITY` / `CONSISTENCY` / `COHERENCE`. |
| `conclusionType` | yes | Template lookup key + `{conclusionType}` placeholder (e.g. `BURIAL`, `MARRIAGE`, `RESIDENCE`, `NAME`, `GENDER`). |
| `type` | yes | Issue class name (e.g. `EventCompletenessIssue`). *(Proposed: unused.)* |
| `conclusionId`, `id`, `dismissible`, `penalty` | yes | Identifiers / metadata. |
| `originalDate`, `formalDate`, `originalPlace`, `normalizedPlace`, `placeId`, `placeType`, `localizedPlaceType`, `lang` | conditional | Fill `{originalDate}`, `{originalPlace}`, etc. |
| **(from PDF, not in sample)** `actualChildCount`, `profileChildCount`, `actualDays`, `profileDays`, `actualAge`, `profileAge`, `numTagsNeeded`, `sourceTitle`, `parentGivenName`, `spouseGivenName`, `childGivenName`, … | per-issueType | Fill the remaining named placeholders. Field set per issueType comes from the PDF "issue data" column — **unverified against the live API** for these issueTypes. |

---

## Issue → sentence mapping

The core of this tool.

### Template lookup is keyed by `(issueType, conclusionType)`

The PDF gives one row per `issueType`, but several rows split the
sentence by `conclusionType` group, differing only by the indefinite vs
definite article:

- `BIRTH` / `BURIAL` / `CREMATION` / `CHRISTENING` / `DEATH` →
  **"The {conclusionType} …"**
- `MARRIAGE` / `RESIDENCE` → **"A {conclusionType} …"**

Example — `DAY_NOT_SPECIFIED`:
- BIRTH → "The birth date is missing a day."
- MARRIAGE → "A marriage date is missing a day."

So the template map is `(issueType, conclusionType) → template string`,
not `issueType → template`. Implement as a per-`issueType` entry that
either holds one template (when there is no article split — e.g.
`CHILD_COUNT`, which is `conclusionType: N/A`) or selects the article
variant from the conclusionType group.

### Placeholder interpolation

Replace each `{placeholder}` with the matching field from the issue
object:

- `{conclusionType}` ← `conclusionType`, **humanized**: lowercase the
  enum so `MARRIAGE` renders as "marriage". (The API returns an uppercase
  enum; the sentence must read naturally.)
- `{originalPlace}` ← `originalPlace`, `{originalDate}` ← `originalDate`,
  `{actualChildCount}` ← `actualChildCount`, etc. — used verbatim.
- A small set of placeholders are non-trivial (e.g. `{normalizedPlace}`,
  `{collectionName}`); fill from the correspondingly-named field.

### Worked examples (verified against `KD96-TV2` + the screenshot)

| issue | renders as |
|-------|-----------|
| `MISSING_EVENT_DATE` / BURIAL | "The burial date is missing." |
| `MISSING_PLACE_JURISDICTIONS` / MARRIAGE | "A marriage place is missing a city." |
| `MISSING_TAGGED_SOURCE_INFORMATIONAL` / RESIDENCE | "A residence has no tagged sources." |

### Template source & location

The ~70 templates are bundled as a **static data module** in the MCP
server (proposed: `src/tools/person-quality-templates.ts`), transcribed
from the PDF "Issue template" column. No network, no file read at
runtime. A docstring records the PDF as the source of truth so the map
can be re-synced when FamilySearch revises the wording.

> The PDF marks a few rows "Current"/"Proposed" (e.g. `YEAR_NOT_SPECIFIED`
> is moving from "missing a year" to "imprecise") and a few "OLD"/"new"
> for the consistency name-mismatch rows. Transcribe the **current/new**
> wording; note the alternates in the module docstring.

### Missing-template fallback

Some PDF rows have a **blank** or **"Coming Soon"** Issue-template cell
(e.g. `NO_INDEXED_CONCLUSION_SOURCES`, `MISSING_GIVEN_NAME`), and the API
may add `issueType`s not yet in the table. When no template matches
`(issueType, conclusionType)`, emit a generated fallback so the issue is
never silently dropped, e.g.:

> "A {scoreType-category} issue ({issueType}) was found on {conclusionType}."

rendered humanized, e.g. "A consistency issue
(GIVEN_NAME_FIELD_MISMATCH) was found on the name." The handler should
not throw on an unknown issueType.

---

## Output

The tool returns the shape below (**decided in review**): the per-issue
English **sentences** plus a compact score summary, with each issue traceable
to its exact fact. It is one object with two nested arrays — `categories[]`
and `issues[]`. For `KD96-TV2`:

```json
{
  "personId": "KD96-TV2",
  "segment": "Norway 1816 - 1920",
  "overallScore": 0.97,
  "issueCount": 7,
  "categories": [
    { "scoreType": "COMPLETENESS",  "count": 2, "score": 0.91 },
    { "scoreType": "VERIFIABILITY", "count": 5, "score": 1.0 },
    { "scoreType": "CONSISTENCY",   "count": 0, "score": 1.0 },
    { "scoreType": "COHERENCE",     "count": 0, "score": 1.0 }
  ],
  "issues": [
    { "sentence": "The burial date is missing.", "conclusionType": "BURIAL", "conclusionId": "d57d443f-…", "scoreType": "COMPLETENESS" },
    { "sentence": "A marriage place is missing a city.", "conclusionType": "MARRIAGE", "conclusionId": "5ced6592-…", "scoreType": "COMPLETENESS" },
    { "sentence": "A residence has no tagged sources.", "conclusionType": "RESIDENCE", "conclusionId": "e77ececa-…", "scoreType": "VERIFIABILITY" }
  ]
}
```

Where the values come from: `segment`, `overallScore`, and each issue's
`conclusionType` / `conclusionId` / `scoreType` come straight from the API;
`issueCount` and the per-category `count` are derived (counted from
`issues`); `score` is the API category `displayScore`; `sentence` is the
interpolated PDF template. Each issue keeps `conclusionType` + `conclusionId`
so the sentence is traceable to its exact fact.

No human "quality band" (e.g. "High Quality") is emitted: the real
`overallScore` (0–1) is returned so the LLM can describe it, and FamilySearch's
band thresholds are unknown — synthesizing a label risked passing a guessed
value off as official. Add a band later if the true thresholds are confirmed.

*Alternatives considered, not chosen:* sentences-only (a flat `string[]`, no
summary or traceability) and this shape + every raw numeric score.

### The opt-in `detail` block

`detail` is **absent** from the result unless the caller passes `detail: true` —
absent, not empty, so the default payload is byte-identical to what it was before
the flag existed. That is the whole point of the flag: the summary caller
(`check-warnings`) wants a lean per-person answer, while a tree audit wants to
know *which fact* and *which source*, and one tool serves both without either
paying for the other's context.

```json
"detail": {
  "facts": [
    {
      "conclusionId": "d57d443f-…",
      "conclusionType": "BURIAL",
      "score": 0.86,
      "issues": ["The burial date is missing."],
      "sources": [
        { "title": "Christian Peder Hole, \"Minnesota, Deaths, 1887-2001\"",
          "uri": "https://familysearch.org/ark:/61903/1:1:…",
          "agrees": true }
      ]
    },
    { "conclusionId": "…", "conclusionType": "MARRIAGE", "relationshipId": "M5PN-FXR",
      "score": 1, "issues": [], "sources": [] }
  ],
  "conflicts": [
    { "field": "Birth Date",
      "values": ["+1876-10-02", "+1877"],
      "sources": [ { "title": "…", "uri": "…", "agrees": null } ] }
  ]
}
```

**`facts[]` — one entry per `conclusionScores` entry.** `score` is the upstream
`combinedDisplayScore`. `relationshipId` is present only where upstream sends one
(the MARRIAGE conclusions). Expect the result to be **sparse**: only 5 of
`KD96-TV2`'s 14 conclusions have any attached source, so 9 carry `sources: []`.

**`issues[]` inside a fact holds rendered sentences, not ids.** Upstream gives
`affectingIssueIds`, which join onto `issues[].id` — and `id` is not part of this
tool's issue output, so passing the ids through would hand the caller keys that
join to nothing. The join is resolved here and the sentence emitted, which
extends the existing traceability guarantee above rather than inventing a second one.

**`sources[]` is deduped by source `uri`.** Upstream nests source → conclusions,
and one source may list the same conclusion id twice (13 of 28 sources on
`KD96-TV2`). Inverting to conclusion → sources turns that into one source listed
twice under one fact. Deduping by uri is lossless here: of the 21 duplicate
`(conclusion, uri)` pairs, **none** disagreed on `agreesWithSource`.

**`conflicts[]` is reduced, not passed through.** Upstream restates a single
disagreement once per source pair, so the raw list grows quadratically with the
number of sources holding the field — `KD96-TV2` returns **50** entries encoding
**5** real disagreements. Entries are grouped by `(field name, sorted value set)`
and carry every source that took part. Passing the raw list through would flood
the context, which is the failure the original exclusion was guarding against.

**`agrees: false` has never been observed.** Every `agreesWithSource` on the one
person probed so far was `true`, so the disagreement branch is **unverified** —
this spec deliberately says nothing about how it renders. `agrees` is `null`, not
`false`, when upstream omits the field, so an absent value is never reported as
disagreement. On `conflicts[].sources` it is always `null`: the conflict list
names source URIs, not per-conclusion agreement. Probe a person carrying a
disagreement before writing that branch down.

**OPEN — include friendly category labels?** The API returns only
`scoreType`. FamilySearch's UI shows friendlier names. Current behavior:
omit them, return `scoreType`. If we later decide to include them, they'd be
a hardcoded constant using this mapping (read off the UI — *not* from the API):

| scoreType (API) | friendly label (screenshot, not in API) |
|-----------------|------------------------------------------|
| COMPLETENESS | Data Completeness |
| VERIFIABILITY | Source Tagging |
| CONSISTENCY | Source Consistency |
| COHERENCE | Conflict-free Data |

---

## Error Handling

The status codes and response bodies below are **verified** against the
live API (2026-06-29) for the cases tested; the empty-`issues` row is
inferred from the schema.

> **NEEDS VALIDATION:** two gaps remain. (1) The *prescribed handling* — the
> exact error messages and the throw-vs-return choices — is a proposal, not
> confirmed as the desired behavior. (2) Other status codes have **not** been
> observed: `403`, `429`, `5xx`, and a merged-person `301` redirect (which
> `person_ancestors` follows). Confirm both before implementing.

| Condition | Behavior |
|-----------|----------|
| `personId` missing / empty | MCP input schema rejects (`required`); also validate for a clear message. |
| Not authenticated | Let `getValidToken(principal)` throw its LLM-instruction error ("Call the login tool…"). |
| API returns **401** | Throw: `"FamilySearch rejected the access token (401). The session may have expired or been revoked — call the login tool to re-authenticate."` |
| API returns **200** with `visibility: "CALCULATING"`, `isValid: false` (no `personScores`) | The score is computed **asynchronously** and isn't ready yet. **Retry** after a short delay (tool: up to 5 attempts, 2 s apart); the score lands on a later request. If still calculating after the retries, throw `"FamilySearch is still calculating the quality score for ${personId}. Try again in a few seconds."` |
| API returns **200** with `visibility: "TOMBSTONED"` (no `personScores`) | The person was **deleted or merged** into another profile (confirmed with FS). **Terminal — do not retry** (unlike CALCULATING). Throw: `"Person ${personId} is tombstoned in the FamilySearch tree — it has been deleted or merged into another profile — so it has no quality score."` Note: a *merge* may instead surface the surviving profile with a link; a bare `TOMBSTONED` does not by itself distinguish delete from merge — `KD96-TV5` was read this way initially, but the tree-persons redirect (`301` + `Location`) later established that it is a merge into a restricted survivor, not a delete. Contrast `NOT_FOUND` (never existed). |
| API returns **200** with `visibility: "NOT_FOUND"` (no `personScores`) | Person does not exist (or is not visible). Throw a clear message, e.g. `"No quality scores found for person ${personId} (not found or not visible)."` (Do **not** treat as a clean zero-issue person — that case has `personScores` present, see last row.) |
| API returns **400** (malformed ID) | Body is **empty**; read the `warning` response header for detail. Throw: `"FamilySearch rejected the person ID '${personId}' (400): ${warningHeader ?? "invalid identifier"}."` Do not attempt `parseUpstreamErrorBody` on the empty body. |
| API returns other non-OK | Throw: `"FamilySearch quality API error: ${status}."` |
| `personScores` present, `issues` empty | Not an error — return `issueCount: 0` and an empty `issues` array (a clean, high-quality person). *(Not yet observed on a live person; inferred from the schema.)* |
| Unknown `issueType` (no template) | Use the missing-template fallback; do not throw. |

**`NOT_FOUND` does *not* mean "no issues."** Two different states, easy to
confuse:
- **No issues (clean person):** a real, visible person with `personScores`
  present and `issues: []`. The person scored well — render zero issues.
- **`NOT_FOUND`:** `visibility: "NOT_FOUND"` and **no `personScores` at all**
  — the person ID doesn't exist or isn't visible to this user. Nothing was
  scored; this is an error, not a clean person.

---

## Wiring

Standard MCP-tool scaffold (see `CLAUDE.md` and `docs/architecture.md` §3 for
the site list; copy `src/tools/wikipedia.ts`), plus two specifics:
- An extra `src/tools/person-quality-templates.ts` — the static
  `(issueType, conclusionType) → sentence` map (not part of the standard scaffold).
- Tests mock `fetch` and use `personal/person-quality/sample-response-KD96-TV2.json`
  as the fixture.
