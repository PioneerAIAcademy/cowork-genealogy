---
name: locality-guide
description: >-
  Produces a locality research guide for a place and time period — what
  genealogical records exist, where they're held, jurisdictional history, and
  boundary changes. Use when the user says "what records exist for [place]?",
  "what can I find in [county/state/country]?", "what records help trace
  families affected by a disaster in [place]?", or "what records survive for
  [place] after [an event]?", or when the orchestrator needs jurisdiction
  context. Do NOT use when the user wants to search records or execute a
  specific search plan (use search-records or search-external-sites), or asks
  a generic "how do I find/research [record type]" how-to question (use
  search-familysearch-wiki); but a records-availability survey for a place
  belongs here even when it names a record type or community (e.g. Quaker
  records in Pennsylvania). Also do not use for narrative historical context
  like migration or why an event happened (use historical-context), or a
  general Wikipedia summary of the place (use search-wikipedia).
allowed-tools:
  - wiki_search
  - wiki_read
  - wiki_place_page
  - place_search
  - place_search_all
  - place_population
  - collections_search
  - external_links_search
  - wikipedia_search
  - volume_search
  - research_append
---

# Locality Guide

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to narrating once at the start of the survey and once when presenting the guide — not a preamble per action, so independent tool calls run together in a single turn instead of being serialized behind narration turns.

**Places:** Resolve with `place_search` / `place_search_all`; record `standardPlace` (and `standard_place` on persisted facts). See `references/places-guidance.md`.

Produces a structured survey of what records exist for a specific place and time period, where they are held, and how to access them — the prerequisite step before sound research planning.

**Ground every claim in tool output.** Name only the collections, volumes, record counts, IDs, dates, and repositories that actually appear in a tool result. When `collections_search` or `volume_search` returns zero or truncated results, report it as a digitization/coverage gap — never invent a collection, count, or volume to fill it, never present a truncated `recordCount` as the verified total, never present one page of `volume_search` results as the complete set, and never extrapolate a tool's number into a claim it did not make (a `volume_search` percentage is not a statement about FamilySearch's interface). If a FamilySearch Wiki page returns only generic content, do not cite specifics it does not contain.

## Reference documents

Load on demand:
- `references/output-format.md` — output template and digitization-level classification table
- `references/locality-survey-methodology.md` — survey process and substitute source strategies
- `references/reference-source-types.md` — question-to-source mapping
- `references/locality-broad-context.md` — topical breadth checklist

## Steps

### 1. Identify the target

Determine place, time period, and scope from the user's request. If the time period is missing, ask — a guide without one cannot assess which records apply. A named region ("the anthracite coal region") counts as a place; do not ask the user to narrow to a specific county before proceeding. Only ask when place **or** time period is genuinely missing.

### 2. Establish jurisdictional context

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
wikipedia_search({ query: "Schuylkill County Pennsylvania history" })
```

`place_search` returns the canonical `standardPlace` — pass that to `place_population` and the other place tools. `place_population` depends only on that `standardPlace`, so **do not spend a separate turn on it here — issue it inside the Step 3 parallel batch** alongside the other surveys. When boundaries changed across the target period, call `place_search_all` instead: it returns every standard place a location has belonged to over time, which directly informs where records were created and are now held.

Note when the jurisdiction was formed, from what parent, and any boundary changes during the target period. Keep this brief — deep historical context belongs in historical-context (see Decision rules). Note only what directly affects which records exist and where they are held. When a boundary or name change splits a locality's records across two jurisdictions (e.g., a territorial-era set and a later county set), connect them explicitly as one continuous research trail for that place rather than listing them as unrelated record sets.

**A temporal split and a geographic split need different quirks.** A temporal
split (the same territory renamed or re-parented on a date) gives a clean
before/after rule — "before 1878, filed under the predecessor." A *geographic*
split (the jurisdiction divided into two or more successors covering different
parts of the original territory, e.g. Feliciana Parish, Louisiana into East
and West Feliciana Parish in 1824) does not: which successor holds a given
record depends on exactly where within the original territory the event
occurred, and that is often not known at survey time. Write the quirk to say
so plainly — "records could be under either East or West Feliciana Parish;
search both" — rather than picking one successor as if the split were
temporal. Do not resolve the ambiguity yourself from a FamilySearch Wiki summary unless it
actually pins the specific place to one side.

### 3. Survey available records and repositories

Once `place_search` (step 2) has returned the `standardPlace`, issue the survey calls in a SINGLE turn as PARALLEL tool calls — `place_population`, `collections_search`, `volume_search`, `external_links_search`, `wiki_search`, and all four `wiki_place_page` sections (home / getting_started / online_records / research_tips) are independent and must NOT be run one-per-turn. Batch them together. The only exception is `wiki_read`: it needs a page URL, so run it right after `wiki_search` returns one. Do not drop any call — parallelize, don't prune.

**All four `wiki_place_page` sections are REQUIRED, not optional.** The place-oriented research pages (overview, getting-started, online-records, research-tips) are the main source of a locality's research strategy and indexing quirks — reading only one (or none) is the most common defect in this skill and defeats its purpose. You will record the outcome of every section in `pages_read` when you persist (Step 6): a section that returns content is logged `found: true`, one that 404s for this place is logged `found: false` — but every section must be *attempted*, never silently skipped. If the exact-place page 404s, broaden the `standardPlace` one jurisdiction level (a county has no page; its state/country does) and retry before recording `found: false`.

```
place_population({ standardPlace: "Schuylkill, Pennsylvania, United States", year_start: 1840, year_end: 1880 })
wiki_search({ query: "Schuylkill County Pennsylvania genealogy records" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "home" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "getting_started" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "online_records" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "research_tips" })
collections_search({ standardPlace: "Schuylkill, Pennsylvania, United States" })
external_links_search({ standardPlace: "Schuylkill, Pennsylvania, United States", startYear: 1840, endYear: 1880 })
volume_search({ standardPlace: "Schuylkill, Pennsylvania, United States", startYear: 1840, endYear: 1880 })
# then, once wiki_search returns a page URL:
wiki_read({ url: "<relevant FamilySearch Wiki page URL>" })
```

`collections_search` derives the jurisdiction itself from the full `standardPlace` — no need to hand it the enclosing state separately. To widen, drop the leading component and call again (the comma-strip pattern).

`volume_search` finds digitized volumes that may not appear in `collections_search`, which only surfaces indexed collections. For each volume, read `recordSearchablePercent` (name-indexed, reachable via `record_search`) and `fulltextSearchable` (reachable via `fulltext_search`). Low/false on both = browse-only. Results paginate. One page is usually enough for a survey, but it is never the whole picture on its own: check `totalResults` and `nextPageToken` against the volumes you actually detail, and when the token is present (or `totalResults` exceeds that count) say so in the guide with both numbers — "31 digitized volumes match; the 4 detailed below are the first page." Fetch further pages only if the researcher asks. When it returns volumes for the same locality filed under different place names across a boundary change (e.g., a territorial-era volume and a later county volume), connect them explicitly as one continuous research trail — tell the researcher to work both together despite the differing place names, not as unrelated sources.

`external_links_search` returns a flat list of FS-curated third-party URLs (Ancestry, MyHeritage, FindMyPast, FindAGrave, national archives, FamilySearch Wiki pages) filtered to the requested time window. The list is not deduplicated — collapse duplicate URLs before listing repositories. **Compare `totalForPlace` and `results.length`:** if `totalForPlace > 0` but `results` is empty, FS has resources for this place outside your time window — note the gap rather than reporting "no online resources." If `totalForPlace === 0`, FS has no curated external links for this place at all.

### 4. Classify access levels

For each record type, assign a digitization level using the table in `references/output-format.md`:
- High `recordSearchablePercent` → **indexed + images**
- Present but low/null `recordSearchablePercent` with `fulltextSearchable: true` → **full-text searchable, not name-indexed** (flag explicitly; do not collapse into "indexed" or "browse-only")
- Low/null `recordSearchablePercent` and false/absent `fulltextSearchable` → **browse-only images**
- No match in `volume_search` → likely **microfilm or physical only** — cross-check the FamilySearch Wiki before classifying

**Never fabricate tool data** (see "Ground every claim in tool output" above). A zero `volume_search`/`collections_search` result is a coverage gap to report plainly — not licence to invent a volume, collection, or count.

### 5. Compile and present

Use the template in `references/output-format.md`. Fill every section with data from tool results. Consult the topical breadth checklist in `references/locality-broad-context.md`. Present the guide to the user, then persist it (Step 6).

### 6. Persist the locality (only inside a research project)

**When running inside a research project** — a `research.json` exists at the project
path (e.g. `locality-guide` was invoked by the orchestrator) — write one `localities`
entry so the knowledge survives for `research-plan` (and the Research Viewer) instead
of being discarded. This is the whole point of the survey — an un-persisted guide
helps only the current turn. **If there is no project** (standalone locality Q&A with
no `research.json`), skip this step: just present the guide. Use `research_append`:

```
research_append({
  projectPath: "<absolute path to the project directory>",
  section: "localities",
  op: "append",                       // op: "update" with entryId to refresh an existing loc_ for the same place
  entry: {
    place: "Pennsylvania, United States",          // the jurisdiction the guide covers
    for_place: "Schuylkill County, Pennsylvania",  // the specific place of interest, if narrower
    time_period: "1840-1880",
    jurisdictions: [ /* from place_search_all — EACH entry is exactly { name, date_range }, no other keys */ ],
    collections: [ /* from collections_search: { id, title, date_range } */ ],
    quirks: [
      // short, actionable gotchas a searcher must know — distilled from the FamilySearch Wiki
      // research-tips / online-records pages. This is ALSO where any border/name
      // succession advice goes — a sentence, not a jurisdiction field, e.g.:
      "Parish records indexed only at the county level — search the county, not the exact parish.",
      "Lackawanna County records before 1878 were filed under Luzerne County — search Luzerne first.",
      "Feliciana Parish split into East and West Feliciana Parish in 1824 — which side holds a given record depends on where within old Feliciana Parish the event occurred; search both unless that's pinned down."
    ],
    guide_markdown: "<the guide you just presented, in markdown>",
    pages_read: [
      { section: "home", url: "<page url or null>", found: true },
      { section: "getting_started", url: "...", found: true },
      { section: "online_records", url: "...", found: true },
      { section: "research_tips", url: "...", found: false }   // 404 for this place → found:false, still recorded
    ],
    source: "locality-guide"
  }
})
```

The tool assigns the `loc_` id and stamps `created`. **`pages_read` must list all four
sections** (each with its `found` outcome) — this is how read-coverage is audited.
Do not put the applied per-search decision here; that goes in a plan item's
`rationale` when `research-plan` uses this entry.

**Stay inside the allowed fields — a stray key fails the whole write.** Each
`jurisdictions[]` entry has exactly two keys, `name` and `date_range`; each
`collections[]` entry exactly `id`, `title`, `date_range`. Do **not** add any
other key (no `note`, `comment`, `records`, etc.) to these objects. When you have
a sentence of searcher advice — a boundary/name succession like "records before
1878 were filed under the predecessor county", an indexing gotcha, a language
warning — that is a **quirk**: add it to the `quirks[]` list, never as an extra
field on a jurisdiction or collection.

## Decision rules

| Situation | Action |
|-----------|--------|
| Place given but no time period | Ask before proceeding |
| MCP tools return sparse data | State what was found, note gaps, suggest consulting FamilySearch Wiki directly |
| Place is sub-county (town or parish) | Guide at county level; note town-specific repositories (local church, town clerk) |
| Place is an entire country or state with no region/theme | Ask to narrow — but a named sub-region or theme is specific enough, proceed |
| User asks "why" questions about records or history | Redirect to historical-context skill |
| User wants locality guide + research plan | Produce the guide first, then hand off to research-plan |
| Records appear destroyed for the target period | List substitute sources (see `references/locality-survey-methodology.md` §5) |
| Jurisdiction did not exist in the target period | Identify the parent jurisdiction that held authority and produce the guide for that |

## Important rules

- **Be specific about availability.** Name counts and record types concretely — not "records may exist" but "FamilySearch has 3 digitized but unindexed image volumes of Schuylkill County probate records, browsable image by image."
- **Note gaps honestly.** If records were destroyed or don't exist for this period, say so clearly.
- **Never state a registration date without naming its level.** Registration began at different levels in different years, and a bare "X didn't require vital registration until <year>" is wrong whichever year you pick. Massachusetts is the worked case: town clerks were ordered by the General Court to record births, marriages, and deaths in **1639**, while **statewide** registration began in **1841** — "Massachusetts didn't require vital registration until 1841" is false, and so is the mirror error of citing 1639 as though no later requirement ever followed. Say which level (town/parish, county, statewide) a date applies to, and cite the FamilySearch Wiki page that states it. New England in particular has a deep body of pre-statewide town records: treat an early-colonial jurisdiction as *having* vital records at the town level unless a FamilySearch Wiki page says otherwise.
- **Match records to the target window.** Flag record classes that predate the period (e.g., colonial/Mission-era) or postdate it (e.g., later civil registration) as background context, not prime sources for the years asked, and note where civil infrastructure was sparse or absent in those years. Conversely, if a collection's date range overlaps the target period, include it — don't dismiss a record class as out-of-period and then list it as available.
- **Flag browse-only, non-English, and physical-only records prominently.** When a volume is 0% name-indexed and not full-text searchable, state plainly it must be browsed image-by-image with no search; if it is non-English (Dutch, German, Spanish sacramental registers, etc.), note the researcher must read the original language. Explicitly state when records exist only in physical repositories — online absence does not mean nonexistence.
- **Include access information.** For each record type, note where it's held and how to access it.
- **Cover topical breadth.** Don't stop at vital records and census — use the checklist in `references/locality-broad-context.md`.
- **Cite the FamilySearch Wiki page, not just its title.** Every FamilySearch Wiki tool result carries its page URL — `source_url` on each `wiki_search` result, `url` from `wiki_read` and `wiki_place_page`. When a claim about what records exist, when they begin, or when registration was required comes from the FamilySearch Wiki, give that URL alongside the article title so the researcher can check it. A date or availability claim you cannot attach a returned URL to is not a finding: say the FamilySearch Wiki does not cover it rather than asserting it from memory. The same URLs go in `pages_read[].url` when you persist.
- **Search adjoining jurisdictions across a state line.** A family near a border likely generated records on both sides, and the level that holds them differs by state — Massachusetts and parts of New York created records at **both** town and county level, so a county-only survey misses the town series. Name the adjoining counties *and* towns across the border, not just the bordering states. Because a `jurisdictions[]` entry is locked to `{ name, date_range }`, the cross-border advice itself goes in `quirks[]` (e.g. "Town lies 4 miles from the NY line — check adjoining Rensselaer County NY town clerks as well as the MA county series").

## Re-invocation behavior

**Writes** (only when a research project is present): one `localities[]` entry per place-jurisdiction (via `research_append`). Standalone Q&A (no `research.json`) writes nothing. Never modifies `tree.gedcomx.json`.

**On repeat invocation for the same place:** update the existing `loc_` entry (`op: "update"` with its `entryId`) rather than appending a duplicate — supersede-not-delete, so the knowledge is refreshed in place. A genuinely new place gets a new `loc_` entry.
