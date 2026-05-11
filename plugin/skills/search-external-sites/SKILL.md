---
name: search-external-sites
description: Generates search URLs for external genealogy sites (Ancestry,
  MyHeritage, FindMyPast, FindAGrave, Newspapers.com) and walks the user
  through the click-capture-analyze workflow. Triages results from captured
  PDFs before passing records to record-extraction. GPS Step 1 — Reasonably
  Exhaustive Research (external site execution). Use when the user says
  "search Ancestry", "search MyHeritage", "search FindMyPast", "search
  FindAGrave", "search Newspapers.com", when a plan item targets a
  non-FamilySearch repository, or when the user uploads a PDF capture from
  an external genealogy site. Do NOT use when the target is FamilySearch
  (use search-records), when the user wants to plan what to search (use
  research-plan), or when the user wants to analyze a single record already
  in context (use record-extraction).
---

# Search External Sites

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

### 2. Get collection URLs

Call the `place_external_links` MCP tool to find collection URLs
for the target jurisdiction:

```
place_external_links({ placeId: <place_id> })
```

This returns collection URLs and names for external sites covering
the place. Use these URLs as the base for constructing search URLs
with appropriate parameters.

If `place_external_links` returns no results for the target site,
fall back to a site-wide search (omit the collection path segment).
If it returns no results at all, construct a site-wide URL manually
using the patterns below.

### 3. Construct the search URL

Build the URL from the plan item's parameters and known facts about
the subject.

#### Ancestry.com

```
https://www.ancestry.com/search/collections/{collection_id}/?name={first}_{last}&birth={year}&birthplace={place}&residence={year}_{place}&father={first}_{last}&mother={first}_{last}&spouse={first}_{last}
```

Parameters:
- `name` — Given and surname, underscore-separated
- `birth`, `death`, `marriage` — Year of event
- `birthplace`, `deathplace` — Location string
- `residence` — Year and place, underscore-separated
- `father`, `mother`, `spouse` — Relative names
- `collection_id` — From `place_external_links` output

Omit `collection_id` path segment for a site-wide search:
```
https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania
```

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
  "captured_source_ids": [],
  "produced_assertion_ids": [],
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
- **Don't guess collection IDs.** Use `place_external_links` to get
  actual collection URLs. If the tool doesn't have a URL for the
  target collection, generate a site-wide search instead.
- **Remember physical repositories exist.** When online searches are
  exhausted, suggest that undigitized records may exist in physical
  repositories (courthouses, church archives, historical societies).
  A negative online result is not proof of absence.
- **Validate after writes.** Run `validate-schema` after writing to
  `research.json` (see `references/validation-protocol.md`).
