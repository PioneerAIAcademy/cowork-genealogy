---
name: search-external-sites
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
  - external_links_search
  - research_log_append
  - research_append
---

# Search External Sites

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Ancestry, MyHeritage, FindMyPast, FindAGrave, and Newspapers.com have no
public APIs and prohibit automated access. So this skill never loads a
page itself — it builds a pre-filled search URL, the user clicks it in
their own authenticated browser, captures the page as a PDF, and uploads
it back. The agent supplies the genealogical expertise; the user's
browser supplies the access.

Getting the search **parameters** right is the core of the task: a URL
with the wrong name encoding, a missing date window, or the wrong
collection sends the user to a dead end.

References to load when the moment arrives:
- `references/repository-types.md` — before your first search, so you
  know why a negative *online* result never proves a record doesn't exist.
- `references/search-strategy-external.md` — Boolean techniques, spelling
  variants, and zero-hit recovery.
- `references/evaluating-compiled-sources.md` — the nine criteria for
  Find A Grave, member trees, and other user-contributed content.

## The loop

1. **Generate** a search URL with pre-filled parameters.
2. **Click** — the user opens it in their authenticated browser.
3. **Capture** — the user saves the page as PDF and uploads it.
4. **Analyze** — you read the PDF, triage results, and hand promising
   records to record-extraction.

Repeat for each external-site plan item.

## Before you search

**Check subscriptions.** Read `researcher_profile.subscriptions` in
`research.json`. Use it as a tie-breaker, never as a gate.

| Site | Subscription value |
|------|-------------------|
| Ancestry.com | `Ancestry` |
| MyHeritage.com | `MyHeritage` |
| FindMyPast.com | `FindMyPast` |
| FindAGrave.com | free to search; `FindAGrave-Plus` adds features |
| Newspapers.com | `Newspapers.com` |

- If a plan item is repository-agnostic, prefer a site the researcher
  subscribes to — that search is immediately actionable.
- If the user explicitly names an unsubscribed site, **generate the URL
  anyway** and add one line: "You don't have a [SITE] subscription on
  file — the link will hit a login wall or a limited-results preview.
  Continue, or pick a subscribed site?" Flag, don't block.
- Profile absent or `subscriptions: ["none"]` → treat all sites equally,
  don't pester about subscriptions.
- FindAGrave is always worth generating — basic search is free.

**Classify the target.** Is the collection an index (a pointer, not
proof), a digitized original (carries evidentiary weight), or
user-contributed content (a lead only)? Read the collection description —
titles mislead about scope and completeness.

## Supported sites

| Site | URL pattern | Notes |
|------|------------|-------|
| Ancestry.com | `ancestry.com/search/collections/{id}/?params` | Largest indexed collection. Paid subscription |
| MyHeritage.com | `myheritage.com/research?action=query&params` | Independent indexing. Paid subscription |
| FindMyPast.com | `findmypast.com/search/results?params` | Strong UK/Ireland coverage. Paid subscription |
| FindAGrave.com | `findagrave.com/memorial/search?params` | Cemetery records. Free. User-contributed — treat as compiled source |
| Newspapers.com | `newspapers.com/search/?query=params` | Historical newspapers. Ancestry-owned. Paid subscription |

## Steps

### 1. Find the plan item

Read `research.json` `plans[]` and pick the item(s) targeting an external
repository. Note the record type, the place, and the year window — you'll
match all three against the curated links below.

### 2. Resolve the place and fetch curated links

```
place_search({ placeName: "<place name>" })
```

Take the `standardPlace` from the response — do not guess it — and pass it
to `external_links_search` with the plan item's year window:

```
external_links_search({ standardPlace: "<standardPlace>", startYear: <year>, endYear: <year> })
```

**What it returns.** A flat `results[]` of `{ url, linkText }` mixing
*every* curated site for the place (Ancestry, MyHeritage, FindMyPast,
FindAGrave, Newspapers.com, archives, FS wiki lists). It does not group by
site, classify by record type, dedupe, or break out collection IDs — the
collection ID is embedded in the URL path when present.

**Consume it like this:**
1. **Filter by host** — keep links for your target site, e.g.
   `result.url.includes("ancestry.com")`.
2. **Dedupe by URL** — FS repeats the same URL once per record-type
   category. Collapse duplicates.
3. **Match `linkText` to the plan item's record type.** `linkText` names
   the collection in plain English ("Pennsylvania Wills and Probate
   Records"). This match is what step 3 acts on.

**`totalForPlace` vs `results.length`:**
- `results.length > 0` → a curated URL exists; go to Case A.
- empty but `totalForPlace > 0` → FS curates this place but nothing
  overlaps your year window; widen the window or fall back (Case B).
- `totalForPlace === 0` → no curated links here at all; fall back (Case B).

### 3. Build the URL

**Case A — a curated URL exists for the target site.**

First, confirm the curated link actually fits the plan item. Compare its
`linkText` record type against what you're searching for: a probate plan
item needs a probate/wills/estate collection, not a census or vital-records
one. **If the only curated link is for a different record type, do not
present it as the search** — that silently sends the user to the wrong
collection. Either pick a curated link whose `linkText` matches, or, if
none matches, fall back to Case B and say which record type you were
looking for.

When the record type matches, use that URL as the base and append your
search parameters — it already encodes the collection scope (Ancestry URLs
carry `/search/collections/{id}/`), so don't template the collection ID
separately:

```
{returned_url}?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania
```

If the base already has a query string, append with `&` instead of `?`.

**Case B — no curated URL fits (or none for the site).**

Tell the user plainly: "No FamilySearch-curated link for [site] in
[year window] — using the site-wide search instead." Then build from the
site-wide template. These search the whole site index, not a scoped
collection:

#### Ancestry.com
```
https://www.ancestry.com/search/?name={first}_{last}&birth={year}&birthplace={place}&residence={year}_{place}&father={first}_{last}&mother={first}_{last}&spouse={first}_{last}
```
- `name` — given and surname, underscore-separated
- `birth`, `death`, `marriage` — event year
- `birthplace`, `deathplace` — location string
- `residence` — year and place, underscore-separated
- `father`, `mother`, `spouse` — relative names

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

**Parameter strategy** (full guidance in
`references/search-strategy-external.md`):
- Unusual name → start broad (surname + place only).
- Common name → start narrow (add dates, relatives, a specific collection).
- Include only parameters you're confident about; omit uncertain ones.
- Add relative names when you have them (Ancestry weights them heavily).
- Widen with spelling variants or wildcards when a search returns little.

### 4. Log the search, then present the URL

The log entry is what makes the search part of the research record, so
**write it before you hand over the URL** — this step is not finished
until both exist. If you present the URL and stop, `research.json` shows
nothing happened: downstream skills, the user's next session, and the
"reasonably exhaustive" audit trail all go blind. The capture may never
come back; the log is the proof the search was launched.

Call `research_log_append` — it assigns the `log_NNN` id, stamps
`performed`, validates the whole project before persisting, and writes
`research.json` atomically (the log is append-only — see "Re-invocation"):

```
research_log_append({
  projectPath: <absolute path of the current working directory>,
  planItemId: "<pli_XXX or null>",
  tool: "external_site",
  query: { /* the params you encoded in the URL */ },
  outcome: "partial",
  resultsExamined: 0,
  notes: "URL generated; awaiting user capture.",
  externalSite: {
    site: "<ancestry|myheritage|findmypast|findagrave|newspapers>",
    urlGenerated: "<the exact URL you present below>",
    captureReceived: false,
    captureFilename: null
  }
})
```

`projectPath` is the project folder you are already operating in (the
directory that contains `research.json`). Pass its absolute path.
External-site searches retain no result sidecar, so do **not** pass
`stagedResultsRef`.

`outcome: "partial"` + `captureReceived: false` mark it in-flight. When a
capture comes back you append a **new** entry (step 6) — never edit this
one.

If the call returns `{ ok: false, errors }`, surface the errors and fix
the inputs rather than retrying blindly or hand-writing the entry; nothing
was written. On success the response carries the `logId` it assigned.

Then present the URL:

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

If the page asks you to log in, please log in first, then click the link
again.

---

### 5. Triage the captured PDF

When the user uploads a PDF, triage formally before any extraction:

1. **List each result** with its key attributes — name, age/birth year,
   location, record type, any visible record ID.
2. **Classify the source** — index (flag that the original must be
   located), digitized original, or user-contributed compiled source
   (apply `references/evaluating-compiled-sources.md`).
3. **Rate each match** against the subject's known attributes:
   - **Strong** — name matches, age within ±3 years, correct jurisdiction.
   - **Possible** — name variant, age close, same state / different county.
   - **No match** — wrong gender, wrong decade, wrong state.
4. **Present a numbered list** with the rating and the reason for each, then
   ask which record to examine. For example:

   > I found 15 results. Three are strong:
   > 1. **Patrick Flynn**, age 5, in Thomas Flynn's household, Schuylkill
   >    County, PA — strong match
   > 2. **Patrick Flyn**, age 6, Allegheny County, PA — possible (spelling
   >    variant, different county)
   > 3. **P. Flynn**, age 4, Philadelphia, PA — possible (initial only)
   >
   > Results 4–15 don't match (wrong ages/locations). Examine record #1?

   For user-contributed sources, add a note separating photographed
   evidence (a headstone image) from contributor-entered text (dates,
   family links).
5. **On selection, request the individual record.** "Click result #1 to
   open the full record page, then save it as a PDF and upload it." That
   single-record PDF goes to record-extraction.

Don't send the raw search-results PDF straight to record-extraction — the
user picks which records are worth examining.

### 6. Log results, including nil results

Every search gets logged in enough detail to reproduce it — site,
collection, all parameters, filters, results examined. When a capture
comes back, append a **new** `research_log_append` entry (never edit the
in-flight one from step 4). Set `query` to the same params, set
`externalSite.captureReceived: true`, and choose `outcome` from your
triage:

- **Results found** → `outcome: "positive"`, `resultsExamined: <n>`,
  `externalSite.captureFilename` set; `notes` summarize the matches.
- **Nil result** → `outcome: "negative"`. A search that legitimately finds
  nothing is a *finding*, not a failure. In `notes` record what collection
  was searched, its known coverage gaps, and whether the absence is
  conclusive or whether undigitized/unindexed records may still exist
  ("not found online" ≠ "does not exist"). Never skip the log because
  "there was nothing to record."
- **No access** (subscription/login wall the user can't pass) →
  `outcome: "error"` with the reason; suggest the fallback plan item.

```
research_log_append({
  projectPath: <absolute path of the current working directory>,
  planItemId: "<pli_XXX or null>",
  tool: "external_site",
  query: { /* the same params you encoded in the URL */ },
  outcome: "<positive|negative|error>",
  resultsExamined: <n>,
  notes: "<one-line summary of what the capture returned>",
  externalSite: {
    site: "<ancestry|myheritage|findmypast|findagrave|newspapers>",
    urlGenerated: "<the URL you generated in step 4>",
    captureReceived: true,
    captureFilename: "<the uploaded PDF's filename, or null>"
  }
})
```

If the call returns `{ ok: false, errors }`, surface the errors and
correct the inputs — nothing was written.

Before calling a site exhausted on zero results, try at least two
variations (name variant, broader place, dropped parameter) — log each as
its own entry (`references/search-strategy-external.md`, "Exit criteria").
When online avenues are spent, remember undigitized records may still live
in courthouses, parish archives, and historical societies.

### 7. Update status and suggest the next step

Set the plan item to `completed` once the search is logged, found or not,
via `research_append` (it validates and writes atomically):

```
research_append({
  projectPath: <absolute path of the current working directory>,
  section: "plan_items",
  op: "update",
  planId: "<pl_XXX, the parent plan>",
  entryId: "<pli_XXX, the plan item you searched>",
  fields: { status: "completed" }
})
```

If it returns `{ ok: false, errors }`, surface the errors rather than
hand-editing the status. Then offer the natural next move:
- More plan items → "Shall I continue with the next search?"
- A record worth examining → "Capture the full record page for result #1?"
- All done → "All planned searches are complete — evaluate whether
  research is exhaustive?"
- Nil result → "No matches on [site]; the plan's fallback is [next item].
  Proceed?"
- Index hit → "This is an index entry — shall we locate the original
  image?"
- Compiled source → "This is user-contributed; add a plan item to verify
  it against originals?"

## Handling capture problems

| Problem | Solution |
|---------|----------|
| PDF shows a login page | "Please log in to [site], then click the link again" |
| PDF cuts off results (lazy loading) | "Scroll to the bottom and back to the top before printing to PDF" |
| PDF missing images/thumbnails | "Record images may not print — screenshot the document viewer separately" |
| PDF links aren't clickable | Construct record URLs from visible record IDs/database names instead of extracted links |
| User can't access the site | Log `outcome: "error"` with the access limitation; move to the fallback plan item |

## User-contributed sources

Find A Grave memorials, public member trees, and crowd-sourced indexes are
compiled sources. Apply the nine criteria in
`references/evaluating-compiled-sources.md`. In short: separate
photographed evidence from contributor-entered text, never cite them as
primary, and use them as leads — add a plan item to find the originals
they point to.

## Re-invocation behavior

This skill writes only to `research.json`: a new append-only `log[]` entry
and the `status` on the matching `plans[].items[]`. It does not write
source or assertion entries — record-extraction does that when the user
returns a single-record capture.

Re-running a search is itself a logged event by design (the log is the
exhaustive-search audit trail), so always append a new `log_` entry and
update the plan item's status. Never modify or delete a prior `log_`
entry; two runs of the same search correctly produce two entries.
