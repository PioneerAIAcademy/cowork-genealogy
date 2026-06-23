---
name: locality-guide
model: claude-sonnet-4-6
description: Produces a structured locality research guide for a place and
  time period — what genealogical records exist, where they're held,
  jurisdictional history, boundary changes, and research tips. Use when
  the user says "what records exist for [place]?", "tell me about [place]
  records", "research guide for [jurisdiction]", "what can I find in 
  [county/state/country]?", "where are the records for [place]?", "what
  records or repositories help trace families affected by a fire, epidemic,
  flood, war, or other disaster in [place]?", "what records survive for
  [place] after [an event]?", or when research-plan needs jurisdiction
  context before creating a plan. Do NOT use when the user wants to search
  records (use search-records), or wants narrative historical context —
  migration patterns, naming conventions, or why an event happened (use
  historical-context); but a question about which records survive or help
  trace families affected by an event is a record-availability question and
  belongs here. Do NOT use when the user wants to execute a specific search
  plan (use search-records or search-external-sites).
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

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Produces a locality research guide — a structured survey of what
records exist for a specific place and time period, where they are
held, and how to access them. This is the prerequisite step before
sound research planning.

## Reference documents

Load these before compiling the guide:

- `references/output-format.md` — The output template and
  digitization-level classification table
- `references/locality-survey-methodology.md` — Step-by-step survey
  process, digitization levels, substitute source strategies
- `references/reference-source-types.md` — Types of reference sources
  and question-to-source mapping
- `references/locality-broad-context.md` — Contextual factors to
  investigate and topical breadth checklist

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_search` | Find FamilySearch wiki articles about record availability |
| `wiki_read` | Read full wiki pages for detailed record guides |
| `wiki_place_page` (`section: "home"`) | Country/state genealogy overview wiki page |
| `wiki_place_page` (`section: "getting_started"`) | Getting started guide for the jurisdiction |
| `wiki_place_page` (`section: "online_records"`) | Online record sources for the country/state |
| `wiki_place_page` (`section: "research_tips"`) | Research strategies for the jurisdiction |
| `place_search` | Look up the place — ID, jurisdictional hierarchy, boundary changes |
| `place_population` | Population statistics (community size affects record survival) |
| `collections_search` | FamilySearch record collections covering this place |
| `external_links_search` | FS-curated third-party URLs (Ancestry, MyHeritage, archives, wiki pages) for this place and period |
| `wikipedia_search` | Wikipedia article summaries about the place's history |
| `volume_search` | Digitized volumes (image groups) covering this place + period, including ones with no name index |

## Steps

### 1. Identify the target

From the user's request, determine:
- **Place:** Country, state/province, county, town
- **Time period:** The years of interest (e.g., 1840-1880)
- **Scope:** All record types, or a specific subset?

If the user specifies only a place without a time period, ask for one.
A guide without a time period cannot assess which records apply.

A named locality plus a time period is enough to proceed — even a region
("Pennsylvania coal towns", "the anthracite region") counts as a place. Do
NOT ask the user to narrow to a specific county or town before producing the
guide: survey the named region as given, and note inline where finer
geographic detail would refine the results. Only ask a clarifying question
when the place or the time period is genuinely missing, not merely broad.

### 2. Establish jurisdictional context

Call MCP tools to establish the jurisdiction:

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
place_population({ standardPlace: "Schuylkill, Pennsylvania, United States", year_start: 1840, year_end: 1880 })
wikipedia_search({ query: "Schuylkill County Pennsylvania history" })
```

`place_search` returns each match's `standardPlace` (the canonical name) —
pass that to `place_population` and the other place tools. When jurisdictions
or boundaries changed across the target period, call `place_search_all`
instead: it returns every standard place a location has belonged to over time,
which directly informs where records were created and are now held.

From the results, determine:
- When the jurisdiction was formed and from what parent
- Any boundary changes during the target period
- Economic base and population size

**Keep this brief.** Note boundary changes and formation date. Do NOT
write a full historical essay — deep historical context (migration
patterns, cultural practices, naming conventions) belongs in the
historical-context skill. Here, note only what directly affects which
records exist and where they are held.

### 3. Survey available records and repositories

```
wiki_search({ query: "Schuylkill County Pennsylvania genealogy records" })
wiki_read({ url: "<relevant wiki page URL>" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "home" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "getting_started" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "online_records" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "research_tips" })
collections_search({ standardPlace: "Schuylkill, Pennsylvania, United States" })
external_links_search({ standardPlace: "Schuylkill, Pennsylvania, United States", startYear: 1840, endYear: 1880 })
volume_search({ standardPlace: "Schuylkill, Pennsylvania, United States", startYear: 1840, endYear: 1880 })
```

`collections_search` matches FamilySearch collection *titles* and derives
the right jurisdiction itself (the US/Canada/Mexico state, the country
elsewhere), echoing it back as `scope` — so pass the full `standardPlace`;
you don't need to hand it the enclosing state. To widen further, drop the
leading component of the standardPlace and call again (the comma-strip
pattern in the places guidance).

`volume_search` finds digitized **volumes** (image groups) that may never
appear in `collections_search` — that tool only surfaces **indexed**
collections, while many records exist only as digitized-but-unindexed
microfilm rolls or book scans. Pass the full `standardPlace` and the
guide's year range. For each returned volume, read
`recordSearchablePercent` (how much of it is name-indexed, reachable via
`record_search`) and `fulltextSearchable` (whether `fulltext_search` will
find anything in it). A volume low or false on both is browse-only —
accessible only image by image via `image_search` → `image_read`.
Results paginate (`nextPageToken` → `pageToken`); one page is usually
enough for a scoping survey.

`external_links_search` returns a flat list of FS-curated third-party URLs
(`{ url, linkText }`) across Ancestry, MyHeritage, FindMyPast,
FindAGrave, Newspapers.com, national archives, and FS wiki resource
pages, filtered to those whose own date range overlaps the requested
window. The list is not grouped by site and is not deduplicated —
collapse duplicate URLs before listing repositories in the guide.

**Compare `totalForPlace` and `results.length`.** If `totalForPlace > 0`
but `results` is empty, FS curates resources for this place
*outside* your time window — note the gap in the guide rather than
reporting "no online resources." If `totalForPlace === 0`, FS has no
curated external links for this place at all.

From these results, build a picture of:
- What record types exist for this jurisdiction and period
- Where each record type is held (repository)
- How each can be accessed (indexed online, browse-only images,
  microfilm, physical only)
- Known gaps and losses (courthouse fires, missing years)

### 4. Classify access levels

For each record type, assign a digitization level using the table in
`references/output-format.md`. This classification is critical —
researchers often assume that if a record is not in an online database,
it does not exist.

Map `volume_search` results onto that table: a volume with a high
`recordSearchablePercent` is **indexed + images**; a volume present but
low/`null` on `recordSearchablePercent` with `fulltextSearchable: true`
is full-text searchable but not name-indexed — flag it as such rather
than collapsing it into either "indexed" or "browse-only"; a volume
low/`null` on `recordSearchablePercent` and `false`/absent on
`fulltextSearchable` is **browse-only images**. A record type with no
match in `volume_search` at all is likely **microfilm** or **physical
only** — cross-check the wiki narrative before classifying it that way.

**Never fabricate tool data.** Cite only collection IDs, titles, image
counts, and volumes that actually appear in the tool results. When
`volume_search` (or any search tool) returns zero results, say so plainly
and frame it as a digitization/coverage gap — then rely on the wiki
narrative and `collections_search` for what records exist. Do NOT invent a
volume, collection number, or image count to fill the gap.

### 5. Compile and present the guide

Use the template in `references/output-format.md`. Fill every section
with specific data from MCP tool results. Consult the topical breadth
checklist in `references/locality-broad-context.md` to ensure coverage
across all relevant record categories.

Output the guide directly to the user. This skill does NOT write to
research.json or tree.gedcomx.json.

## Decision rules

| Situation | Action |
|-----------|--------|
| User gives place but no time period | Ask for the time period before proceeding |
| MCP tools return sparse data for the place | State what you found, note the gaps, suggest the user consult the FamilySearch Wiki directly for that jurisdiction |
| Place is sub-county (a town or parish) | Produce the guide at county level but note town-specific repositories (local church, town clerk) |
| Place is an entire country or a whole state with no region, county, or theme given | Ask the user to narrow. But a named sub-region or theme ("the anthracite coal region", "Pennsylvania coal towns", "Gold Rush California") IS specific enough — proceed without asking |
| User asks "why" questions about records or history | Redirect to historical-context skill |
| User asks about record availability AND wants a research plan | Produce the locality guide first, then hand off to research-plan |
| Records appear destroyed for the target period | List substitute sources (see `references/locality-survey-methodology.md` section 5) |
| The jurisdiction did not exist during the target period | Identify the parent jurisdiction that held authority at that time and produce the guide for that jurisdiction instead |

## Important rules

- **Be specific about availability.** Don't say "records may exist"
  — say "FamilySearch has 2.3M indexed probate records for
  Pennsylvania" or "no digitized records found for this county." When
  `volume_search` surfaces browse-only volumes, name the count and
  record type concretely — "FamilySearch has 3 digitized but unindexed
  image volumes of Schuylkill County probate records, browsable image
  by image" — not a vague "some records may not be indexed."
- **Note gaps honestly.** If records were destroyed or don't exist
  for this period, say so clearly.
- **Flag physical-only records.** Explicitly state when records exist
  only in physical repositories. This prevents researchers from
  assuming online absence means nonexistence.
- **Include access information.** For each record type, note WHERE
  it's held and HOW to access it.
- **Cover topical breadth.** Don't stop at vital records and census.
  Use the checklist in locality-broad-context to cover all relevant
  record categories.
- **Cite the wiki.** When information comes from a FamilySearch wiki
  article, mention the article title so the user can read it.
- **Stay in scope.** This skill answers "what exists and where."
  It does not answer "why" (historical-context), "what to search
  next" (research-plan), or "how to search" (search-records).

## Re-invocation behavior

**Writes:** a markdown file at `<topic-slug>.md` in the user's working
folder (e.g. `schuylkill-county-pa-locality-guide.md`). Does not
modify `research.json` or `tree.gedcomx.json`.

**On repeat invocation:** overwrites the existing same-named markdown
file with a refreshed guide. The user's other locality guides for
other topics are untouched.

**Do not duplicate:** if a guide for the same topic already exists at the
target filename, refresh it in place rather than creating a parallel
file with a numeric suffix.
