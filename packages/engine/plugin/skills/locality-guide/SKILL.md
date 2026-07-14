---
name: locality-guide
model: claude-sonnet-4-6
description: >-
  Produces a structured locality research guide for a place and time period —
  what genealogical records exist, where they're held, jurisdictional history,
  boundary changes, and research tips. Use when the user says "what records
  exist for [place]?", "tell me about [place] records", "research guide for
  [jurisdiction]", "what can I find in [county/state/country]?", "where are
  the records for [place]?", "what records or repositories help trace families
  affected by a fire, epidemic, flood, war, or disaster in [place]?", "what
  records survive for [place] after [an event]?", or when research-plan needs
  jurisdiction context. Do NOT use when the user wants to search records or
  execute a specific search plan (use search-records or
  search-external-sites), or wants narrative historical context — migration
  patterns, naming conventions, or why an event happened (use
  historical-context); but a question about which records survive or help
  trace families affected by an event is a record-availability question and
  belongs here.
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
---

# Locality Guide

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to narrating once at the start of the survey and once when presenting the guide — not a preamble per action, so independent tool calls run together in a single turn instead of being serialized behind narration turns.

**Places:** Resolve with `place_search` / `place_search_all`; record `standardPlace` (and `standard_place` on persisted facts). See `references/places-guidance.md`.

Produces a structured survey of what records exist for a specific place and time period, where they are held, and how to access them — the prerequisite step before sound research planning.

**Ground every claim in tool output.** Name only the collections, volumes, record counts, IDs, dates, and repositories that actually appear in a tool result. When `collections_search` or `volume_search` returns zero or truncated results, report it as a digitization/coverage gap — never invent a collection, count, or volume to fill it, never present a truncated `recordCount` as the verified total, and never extrapolate a tool's number into a claim it did not make (a `volume_search` percentage is not a statement about FamilySearch's interface). If a wiki page returns only generic content, do not cite specifics it does not contain.

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

### 3. Survey available records and repositories

Once `place_search` (step 2) has returned the `standardPlace`, issue the survey calls in a SINGLE turn as PARALLEL tool calls — `place_population`, `collections_search`, `volume_search`, `external_links_search`, `wiki_search`, and all four `wiki_place_page` sections (home / getting_started / online_records / research_tips) are independent and must NOT be run one-per-turn. Batch them together. The only exception is `wiki_read`: it needs a page URL, so run it right after `wiki_search` returns one. Do not drop any call — parallelize, don't prune.

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
wiki_read({ url: "<relevant wiki page URL>" })
```

`collections_search` derives the jurisdiction itself from the full `standardPlace` — no need to hand it the enclosing state separately. To widen, drop the leading component and call again (the comma-strip pattern).

`volume_search` finds digitized volumes that may not appear in `collections_search`, which only surfaces indexed collections. For each volume, read `recordSearchablePercent` (name-indexed, reachable via `record_search`) and `fulltextSearchable` (reachable via `fulltext_search`). Low/false on both = browse-only. Results paginate; one page is usually enough for a survey. When it returns volumes for the same locality filed under different place names across a boundary change (e.g., a territorial-era volume and a later county volume), connect them explicitly as one continuous research trail — tell the researcher to work both together despite the differing place names, not as unrelated sources.

`external_links_search` returns a flat list of FS-curated third-party URLs (Ancestry, MyHeritage, FindMyPast, FindAGrave, national archives, wiki pages) filtered to the requested time window. The list is not deduplicated — collapse duplicate URLs before listing repositories. **Compare `totalForPlace` and `results.length`:** if `totalForPlace > 0` but `results` is empty, FS has resources for this place outside your time window — note the gap rather than reporting "no online resources." If `totalForPlace === 0`, FS has no curated external links for this place at all.

### 4. Classify access levels

For each record type, assign a digitization level using the table in `references/output-format.md`:
- High `recordSearchablePercent` → **indexed + images**
- Present but low/null `recordSearchablePercent` with `fulltextSearchable: true` → **full-text searchable, not name-indexed** (flag explicitly; do not collapse into "indexed" or "browse-only")
- Low/null `recordSearchablePercent` and false/absent `fulltextSearchable` → **browse-only images**
- No match in `volume_search` → likely **microfilm or physical only** — cross-check wiki before classifying

**Never fabricate tool data** (see "Ground every claim in tool output" above). A zero `volume_search`/`collections_search` result is a coverage gap to report plainly — not licence to invent a volume, collection, or count.

### 5. Compile and present

Use the template in `references/output-format.md`. Fill every section with data from tool results. Consult the topical breadth checklist in `references/locality-broad-context.md`. Output the guide directly to the user — this skill does not write to `research.json` or `tree.gedcomx.json`.

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
- **Match records to the target window.** Flag record classes that predate the period (e.g., colonial/Mission-era) or postdate it (e.g., later civil registration) as background context, not prime sources for the years asked, and note where civil infrastructure was sparse or absent in those years. Conversely, if a collection's date range overlaps the target period, include it — don't dismiss a record class as out-of-period and then list it as available.
- **Flag browse-only, non-English, and physical-only records prominently.** When a volume is 0% name-indexed and not full-text searchable, state plainly it must be browsed image-by-image with no search; if it is non-English (Dutch, German, Spanish sacramental registers, etc.), note the researcher must read the original language. Explicitly state when records exist only in physical repositories — online absence does not mean nonexistence.
- **Include access information.** For each record type, note where it's held and how to access it.
- **Cover topical breadth.** Don't stop at vital records and census — use the checklist in `references/locality-broad-context.md`.
- **Cite the wiki.** When information comes from a FamilySearch wiki article, mention the article title.

## Re-invocation behavior

This skill writes no project state — it presents the guide directly to the user and does not modify `research.json` or `tree.gedcomx.json`. Safe to re-invoke; re-running produces a fresh guide for the requested place and period.
