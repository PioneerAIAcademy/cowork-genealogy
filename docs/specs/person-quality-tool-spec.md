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
| `personId` | string | Yes | FamilySearch tree-person ID (e.g. `"KD96-TV2"`). camelCase at the MCP boundary, per repo convention. |

Example:
```json
{ "personId": "KD96-TV2" }
```

> Unlike `person_ancestors`, `personId` is **required** — there is no
> "current user" default. Quality scoring always targets a named person.

---

## Upstream API

### Endpoint

```
GET {HOST}/service/tree/tree-data/quality/person/{personId}/scores
```

**Host: `sg30p0.familysearch.org`** (beta — per review decision). Verified
2026-06-29: returns the response shape below. A clean captured sample lives
at `personal/person-quality/sample-response-KD96-TV2.json` (developer
reference; not shipped).

> **NEEDS VALIDATION:** `getValidToken()` issues real `familysearch.org`
> (production) OAuth tokens. Confirm the beta host `sg30p0` accepts those
> tokens — or whether the tool needs a different token source for beta.
> (In design testing, a beta bearer token worked against both hosts; the
> production-token-against-beta path is unconfirmed.)

> **OPEN QUESTION 5 — query params:** the PDF shows variants
> (`?limitScope=false`, `?scoresToCalculate=…`). The verified call used none
> and returned all four categories; confirm no params are needed in production.

### Auth & headers

- **Token:** `getValidToken()` from `src/auth/refresh.ts` — the single
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
`KD96-TV2` response. The notes on *what the tool does with each field*
(keep / drop / use as a template key) are **proposed**, not observed —
they track the Output open questions. One field row (flagged below) is
sourced from the PDF, **not** seen in this sample.

Top level: `{ isValid, personScores, visibility }`. All data is under
`personScores`:

| Path | Meaning |
|------|---------|
| `personScores.issues[]` | Live (non-dismissed) issues. *(Proposed: the source of the sentences.)* |
| `personScores.dismissedIssues[]` | Issues the user dismissed. **Excluded from output** (decided in review) — only `issues[]` is rendered. |
| `personScores.completenessScore` / `verifiabilityScore` / `consistencyScore` / `coherenceScore` | Per-category score `{ rawNumerator, displayNumerator, denominator, displayScore, rawScore }`. |
| `personScores.overallDisplayScore` / `overallRawScore` | Overall 0–1 score (e.g. `0.97`). |
| `personScores.segment` | Cohort the score benchmarks against (e.g. `"Norway 1816 - 1920"`). |
| `personScores.pid`, `lang`, `visibility` | Person ID, language, and visibility (`PUBLIC` for a normal visible person). Dropped by the proposed output. |
| `personScores.conclusionScores[]` | A **per-fact score breakdown**: one entry per conclusion (each NAME, BIRTH, BURIAL, …) giving that single fact's four sub-scores, plus `affectingIssueIds` = which issues are dragging that fact's score down (e.g. the BURIAL conclusion's completeness is lowered by its `MISSING_EVENT_DATE` issue). It's the granular "why" behind the category scores. **Dropped by the proposed output.** |
| `personScores.sourceClusters[]` | The **attached-sources list**: each source (title + ark URI) and which of the person's conclusions it touches, with `agreesWithSource` true/false. It's the evidence behind consistency scoring (does this census/record agree with the tree?). **Excluded from output (decided in review — not important to include).** |

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

## Output (PROPOSED — pick one shape)

The English **sentence** is the core of every option below — it is what gets
sent to the LLM in all three; they differ only in how much (if anything)
wraps it. **Three shapes are proposed (A / B / C); we'd like one chosen.**
If the call is "send the LLM only the sentences," that is Option B — a
perfectly fine outcome. **Recommended: Option A.** (This is Open Question 1.)

> **OPEN QUESTION 2 — is a bare sentence enough to be useful?**
> "The burial date is missing." names the *kind* of problem but not *which*
> conclusion it's on. If a person has more than one burial-related fact, the
> LLM can't tell them apart and has no handle to act on. Options A and C keep
> `conclusionType` + `conclusionId` on each issue, making every sentence
> traceable to its exact fact; Option B drops them and accepts the ambiguity.

### Option A (recommended) — sentences + compact summary, traceable issues

Option A is **one object** with two nested arrays — `categories[]` and
`issues[]`. For `KD96-TV2` it looks like:

```json
{
  "personId": "KD96-TV2",
  "segment": "Norway 1816 - 1920",
  "overallScore": 0.97,
  "qualityBand": "High Quality",
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
interpolated PDF template. `qualityBand` is derived from `overallScore` —
**Open Question 3:** the band thresholds are unknown and it may be dropped.
Each issue keeps `conclusionType` + `conclusionId` so the sentence is
traceable to its fact (Open Question 2).

### Option B — sentences only

The minimal shape: just the interpolated sentences, nothing else. No summary,
no per-issue handles, so issues are **not** traceable (Open Question 2). A
fine choice if the LLM only needs to *read* the problems, not act on a
specific fact.

```json
{
  "personId": "KD96-TV2",
  "sentences": [
    "The burial date is missing.",
    "A marriage place is missing a city.",
    "A residence has no tagged sources."
  ]
}
```

### Option C — Option A + full numeric scores

Everything in Option A, plus every numeric score from the API (each
category's `rawNumerator` / `denominator` / `displayScore`, and
`overallRawScore`). Most complete, largest payload — use only if the LLM
needs the raw numbers.

**Open Question 4 — include friendly category labels?** The API returns
only `scoreType`. FamilySearch's UI shows friendlier names. If we decide to
include them, they'd be a hardcoded constant using this mapping (read off
the screenshot — *not* from the API). Default: omit, return `scoreType`.

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
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error ("Call the login tool…"). |
| API returns **401** | Throw: `"FamilySearch rejected the access token (401). The session may have expired or been revoked — call the login tool to re-authenticate."` |
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

Standard MCP-tool scaffold (see CLAUDE.md / the `mcp-tool-scaffolder` agent),
plus two specifics:
- An extra `src/tools/person-quality-templates.ts` — the static
  `(issueType, conclusionType) → sentence` map (not part of the standard scaffold).
- Tests mock `fetch` and use `personal/person-quality/sample-response-KD96-TV2.json`
  as the fixture.
