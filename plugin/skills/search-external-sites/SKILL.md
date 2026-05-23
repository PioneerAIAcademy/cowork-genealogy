---
name: search-external-sites
model: claude-sonnet-4-6
description: Generates search URLs for external genealogy sites (Ancestry,
  MyHeritage, FindMyPast, FindAGrave, Newspapers.com) and walks the user
  through the click-capture-analyze workflow. Logs each search to research.json (including nil results) and
  triages results from captured PDFs before passing records to record-extraction. GPS Step 1 — Reasonably
  Exhaustive Research (external site execution). Use when the user says
  "search Ancestry", "search MyHeritage", "search FindMyPast", "search
  FindAGrave", "search Newspapers.com", when a plan item targets a
  non-FamilySearch repository, or when the user uploads a PDF capture from
  an external genealogy site. Do NOT use when the target is FamilySearch
  (use search-records), when the user wants to plan what to search (use
  research-plan), or when the user wants to analyze a single record already
  in context (use record-extraction).
allowed-tools:
  - place_search
  - place_external_links
---

# Search External Sites

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Generates search URLs for commercial and external genealogy sites,
instructs the user on the click-capture workflow, and analyzes
returned PDF captures. This skill exists because these sites have
no public APIs and prohibit automated access — the user's browser
session provides access while the agent provides expertise.

Load `references/repository-types.md` before your first search to
understand how digital and physical repositories differ and why
negative online results do not prove a record's absence.

Load `references/evaluating-compiled-sources.md` before analyzing
results from user-contributed sites (Find A Grave, online family
trees, user-submitted indexes) to apply the nine evaluation criteria.

Load `references/search-strategy-external.md` for guidance on
search approaches, Boolean techniques, and zero-hit recovery across
external sites.

See `docs/gps/external-sites.md` for full URL format documentation
and capture instructions.

## The Generate-Click-Capture-Analyze Loop

1. **Generate:** The skill constructs a search URL with pre-filled
   parameters
2. **Click:** The user clicks the link in their authenticated browser
3. **Capture:** The user saves the page as PDF and uploads it
4. **Analyze:** The skill reads the PDF, triages results, and passes
   promising records to record-extraction

This loop repeats for each external-site plan item.

## Subscription awareness

Before generating URLs, check `researcher_profile.subscriptions` in
`research.json`. Use the list as a tie-breaker for site selection, not
as a hard gate.

| Site | Subscription value |
|------|-------------------|
| Ancestry.com | `Ancestry` |
| MyHeritage.com | `MyHeritage` |
| FindMyPast.com | `FindMyPast` |
| FindAGrave.com | basic features free; `FindAGrave-Plus` adds features |
| Newspapers.com | `Newspapers.com` |

Rules:

- **Subscribed sites first.** If a plan item is repository-agnostic
  (e.g., "search a major commercial database for John Smith"), prioritize
  sites the researcher subscribes to — those searches are immediately
  actionable.
- **Unsubscribed sites flagged but not blocked.** If a plan item
  explicitly targets an unsubscribed site, generate the URL anyway but
  add one line of context: "You don't have a [SITE] subscription on
  file — the link will land on a login wall or a limited-results
  preview. Continue, or pick a subscribed site?"
- **Profile absent or `subscriptions: ["none"]`.** Treat all sites
  equally. Don't pester the user about subscriptions.
- **FindAGrave is always generated.** Basic FindAGrave is free for
  search and memorials.

## Supported sites

| Site | URL pattern | Notes |
|------|------------|-------|
| Ancestry.com | `ancestry.com/search/collections/{id}/?params` | Largest indexed collection. Paid subscription required |
| MyHeritage.com | `myheritage.com/research?action=query&params` | Independent indexing. Paid subscription |
| FindMyPast.com | `findmypast.com/search/results?params` | Strong UK/Ireland coverage. Paid subscription |
| FindAGrave.com | `findagrave.com/memorial/search?params` | Cemetery records. Free. User-contributed — treat as compiled source. No AI access allowed |
| Newspapers.com | `newspapers.com/search/?query=params` | Historical newspapers. Ancestry-owned. Paid subscription |

## Before you search

Before constructing a URL, classify the target: index (pointer, not
proof), digitized original (has evidentiary weight), or user-contributed
content (compiled source — treat as a lead only). Read the collection
description — titles can be misleading about scope and completeness.

## Steps

### 1. Identify the plan item

Read `research.json` `plans[]` and find plan items targeting
external repositories. Match the repository to the site.

### 2. Get curated collection URLs for the place

Call the `place_external_links` MCP tool to fetch FamilySearch-curated
third-party URLs for the target place and time period:

```
place_external_links({ placeId: <place_id>, startYear: <year>, endYear: <year> })
```

`placeId` is the FamilySearch place ID — get it from the `place_search`
tool, do not guess. Call it like this (the parameter name is `query`,
not `name` or `place`):

```
place_search({ query: "<place name>" })
```

`startYear` and `endYear` come from the plan item's target period.

**What the tool returns.** A flat `results[]` of `{ url, linkText }`
spanning *every* curated site for this place (Ancestry, MyHeritage,
FindMyPast, FindAGrave, Newspapers.com, national archives, FS wiki
resource lists), mixed together. It does **not** group by site,
classify by record type, deduplicate, or expose collection IDs as
separate fields. The Ancestry/MyHeritage collection ID is embedded
inside the URL path when present — use the whole URL as-is.

**How to consume it.**

1. **Filter by URL host** to find links for the plan item's target
   site, e.g. `result.url.includes("ancestry.com")` for an Ancestry
   plan item.
2. **Dedupe by URL.** FamilySearch returns the same URL many times
   (one entry per record-type category). Collapse duplicates before
   showing the user.
3. **Pick the most specific URL** for your target collection.
   `linkText` names the collection in plain English (e.g.
   "Pennsylvania Wills and Probate Records") — match it to the plan
   item's record type.

**Interpreting `totalResults` vs `matchedCount`.**
- `matchedCount > 0` → use one of the returned URLs as the base.
- `matchedCount === 0 && totalResults > 0` → FS curates resources for
  this place but none overlap your year window. Either widen the
  window or fall back to site-wide search.
- `totalResults === 0` → FS has no curated external links for this
  place at all. Fall back to site-wide search using the templates
  in step 3.

### 3. Construct the search URL

Two cases, depending on what `place_external_links` returned.

**Case A — `place_external_links` returned a URL for the target site.**
Use that URL as the base and append your search parameters directly.
The URL already encodes the collection scope (e.g. Ancestry's URLs
include `/search/collections/{id}/`); you do not need to template
the collection ID separately.

```
{returned_url}?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania
```

If the returned URL already has a query string, append with `&`
instead of `?`.

**Case B — no URL for the target site (fall back to site-wide).**
Use the site-wide templates below. These do not scope to a specific
collection — they search the entire site index.

#### Ancestry.com (site-wide)

```
https://www.ancestry.com/search/?name={first}_{last}&birth={year}&birthplace={place}&residence={year}_{place}&father={first}_{last}&mother={first}_{last}&spouse={first}_{last}
```

Parameters:
- `name` — Given and surname, underscore-separated
- `birth`, `death`, `marriage` — Year of event
- `birthplace`, `deathplace` — Location string
- `residence` — Year and place, underscore-separated
- `father`, `mother`, `spouse` — Relative names

#### MyHeritage.com

```
https://www.myheritage.com/research?action=query&first={first}&last={last}&birth_year={year}&birth_place={place}&death_year={year}&death_place={place}&father_first={first}&father_last={last}&mother_first={first}&mother_last={last}
```

#### FindMyPast.com

```
https://www.findmypast.com/search/results?firstname={first}&lastname={last}&yearofbirth={year}&keywordsplace={place}&eventyear={year}&fatherfirstname={first}&motherfirstname={first}
```

#### FindAGrave.com

```
https://www.findagrave.com/memorial/search?firstname={first}&lastname={last}&birthyear={year}&deathyear={year}&location={place}
```

#### Newspapers.com

```
https://www.newspapers.com/search/?query={first}+{last}&dr_year={year}&dr_place={place}
```

**Parameter selection strategy** (see
`references/search-strategy-external.md` for full guidance):

- Unusual names → start broad (surname + location only)
- Common names → start narrow (add dates, relatives, specific collection)
- Include parameters you're confident about; omit uncertain ones
- Include relative names when available (especially on Ancestry)
- Try spelling variants or wildcards when initial searches return
  few results

### 4. Present the URL and capture instructions

Present the search URL as a clickable link with clear instructions:

---

**Search: 1850 Census on Ancestry for Patrick Flynn**

Click this link to search:
[Ancestry — 1850 Census, Patrick Flynn](https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania)

After the page loads:
1. Scroll to the bottom of the page and back to the top (forces
   lazy-loaded results into view)
2. Press **Cmd+P** (Mac) or **Ctrl+P** (Windows)
3. Select **"Save as PDF"**
4. Save the file and upload it here

If the page asks you to log in, please log in first, then click
the link again.

---

### 5. Analyze the captured PDF (results triage)

When the user uploads a PDF, perform a **formal triage** — do not
jump straight to extraction.

**Step 1: Read the PDF and identify results.**
List each result with its key attributes:
- Name
- Age / birth year
- Location
- Record type
- Any visible record ID or link

**Step 2: Classify the source type.**
Note whether you are looking at an index (flag that the original must
be located), a digitized original, or a user-contributed compiled
source (apply `references/evaluating-compiled-sources.md` criteria).

**Step 3: Evaluate match quality.**
For each result, compare against the research subject's known
attributes (name, age, place, household):
- **Strong match:** Name matches, age within ±3 years, correct
  jurisdiction
- **Possible match:** Name is a variant, age is close, same state
  but different county
- **No match:** Wrong gender, wrong decade, wrong state

**Step 4: Present triage to the user.**
Show a numbered list of results with match quality:

> I found 15 results on this page. Three are strong matches:
>
> 1. **Patrick Flynn**, age 5, in Thomas Flynn household,
>    Schuylkill County, PA — **strong match**
> 2. **Patrick Flyn**, age 6, Allegheny County, PA — **possible
>    match** (spelling variant, different county)
> 3. **P. Flynn**, age 4, Philadelphia, PA — **possible match**
>    (initial only, different county)
>
> Results 4-15 don't match (wrong ages/locations).
>
> Would you like me to examine record #1 in detail?

When triaging user-contributed sources, add a source-quality note
distinguishing photographed evidence from contributor-entered data.

**Step 5: For selected records, request individual capture.**
When the user selects a result to examine:

> Please click on result #1 to open the full record page, then
> capture it as a PDF and upload it.

The individual record PDF then goes to record-extraction for
assertion extraction.

### 6. Document negative searches

Negative results are findings, not failures. When a search returns
no matches:

- Log with full parameters, collection scope, and date range
- Note limitations that might explain the absence (incomplete
  coverage, known gaps, undigitized records)
- Distinguish "not found online" from "does not exist" — the record
  may be undigitized, unindexed, or indexed under a variant name
- State the significance in the log notes (e.g., "Ancestry's PA
  probate coverage for this period is incomplete. Courthouse may
  hold undigitized records.")

### 7. Write the log entry

Log every search — both the URL generation and the capture analysis.
Follow `references/research-log-protocol.md`.

The log must capture enough detail that another researcher could
reproduce the exact search: the site, the collection searched, all
search parameters used, any filters applied, and the number of
results examined. This is essential for proving research was
reasonably exhaustive.

```json
{
  "id": "log_007",
  "plan_item_id": "pli_008",
  "performed": "2026-05-04T15:00:00Z",
  "tool": "external_site",
  "query": {
    "surname": "Flynn",
    "given": "Thomas",
    "death_year": 1881,
    "jurisdiction": "Schuylkill County, Pennsylvania",
    "record_type": "probate"
  },
  "outcome": "positive",
  "results_examined": 3,
  "notes": "Ancestry probate collection. 3 results found, 1 strong match (Thomas Flynn, will 1881).",
  "external_site": {
    "site": "ancestry",
    "url_generated": "https://www.ancestry.com/search/collections/9061/?name=Thomas_Flynn&death=1881&deathplace=Schuylkill%20County%20Pennsylvania",
    "capture_received": true,
    "capture_filename": "ancestry-probate-flynn.pdf"
  }
}
```

**When the user hasn't returned a capture yet:**
Log with `capture_received: false` and `outcome: "partial"`. Update
the log entry (append a new entry — log is append-only) when the
capture arrives.

**Nil results:**
If the PDF shows no matching results, log with `outcome: "negative"`.
Include in `notes` what collection was searched, its known coverage
limitations, and whether the absence is conclusive or whether
undigitized records may exist elsewhere. This is a finding — the
subject was not found in this collection on this site.

### 8. When to stop iterating on one site

Before marking a plan item complete on zero results, try at least
two search variations (name variant, broader location, or removed
parameter). See `references/search-strategy-external.md` "Exit
criteria" for what constitutes a reasonably exhaustive search of a
single external site. Log each retry as a separate log entry.

### 9. Update plan item status

Set the plan item to `completed` after the search is logged,
regardless of whether results were found.

### 10. Suggest next steps

After completing an external-site search:
- More plan items to execute → "Shall I continue with the next
  search?" or "The next search is on [FamilySearch/Ancestry/etc.]"
- Individual record to examine → "Would you like to capture the
  full record page for result #1?"
- All plan items done → "All planned searches are complete. Would
  you like me to evaluate whether research is exhaustive?"
- Nil results → "No matches found on [site]. The plan has a
  fallback: [next item]. Shall I proceed?"
- Index-only result found → "This result is from an index. To
  verify the information, we should locate the original record
  image. Would you like to look for it?"
- Compiled source found → "This is a user-contributed source and
  needs verification against original records. Shall I add a plan
  item to locate the originals?"

## Handling capture problems

| Problem | Solution |
|---------|----------|
| PDF shows a login page | "Please log in to [site] in your browser, then click the search link again" |
| PDF cuts off results (lazy loading) | "Please scroll to the bottom of the page and back to the top before printing to PDF" |
| PDF is missing images/thumbnails | "The record images may not print. If the record page has a document viewer, take a separate screenshot of the record image" |
| PDF links aren't clickable | The skill constructs record URLs from visible record IDs or database names rather than relying on extracted links |
| User can't access the site (no subscription) | Log with `outcome: "error"` and notes explaining the access limitation. Suggest alternative repositories or move to the fallback plan item |

## Handling user-contributed sources

Find A Grave memorials, public member trees, and crowd-sourced indexes
are compiled sources. Load `references/evaluating-compiled-sources.md`
and apply its nine criteria. Key rules:

- Distinguish photographed evidence (headstone image) from contributor-
  entered text (dates, family links)
- Never cite these as primary sources — cite as compiled, note
  verification needed
- Use them as leads: add plan items to locate the original records
  they reference

## Important rules

- **Never access external sites directly.** Every page load happens
  in the user's browser. The agent only sees what the user uploads.
- **Formal triage before extraction.** Don't send the raw search
  results PDF to record-extraction. Triage first — list results,
  evaluate match quality, let the user pick which records to examine.
- **Log every search.** Including nil results and failed access.
  Negative searches are findings that contribute to proving research
  was reasonably exhaustive.
- **Distinguish indexes from originals.** When a result comes from
  an index or database, flag that the original record should be
  located. An index entry is a pointer, not the record itself.
- **Evaluate compiled sources critically.** User-contributed content
  (Find A Grave, online trees, crowd-sourced indexes) must be
  assessed using the nine evaluation criteria before any claim is
  accepted.
- **Respect terms of service.** No scraping, no automated access,
  no credential sharing. The user clicks, captures, and uploads.
- **Don't reconstruct URLs from scratch when `place_external_links` gave
  you one.** The tool returns site-scoped collection URLs that
  already encode the collection ID in the path. Use them as the
  base and append search params. Only fall back to the site-wide
  templates when `place_external_links` has no URL for the target site
  (or returns nothing for the place).
- **Filter by URL host and dedupe.** `place_external_links` returns a
  flat mixed-site list with duplicates. Filter to your target site
  yourself, then collapse duplicate URLs before presenting options.
- **Remember physical repositories exist.** When online searches are
  exhausted, suggest that undigitized records may exist in physical
  repositories (courthouses, church archives, historical societies).
  A negative online result is not proof of absence.
- **Validate after writes.** Run `validate-schema` after writing to
  `research.json` (see `references/validation-protocol.md`).
