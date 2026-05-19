---
name: locality-guide
model: claude-sonnet-4-6
description: Produces a structured locality research guide for a place and
  time period — what genealogical records exist, where they're held,
  jurisdictional history, boundary changes, and research tips. Use when
  the user says "what records exist for [place]?", "tell me about [place]
  records", "research guide for [jurisdiction]", "what can I find in
  [county/state/country]?", "where are the records for [place]?", or when
  research-plan needs jurisdiction context before creating a plan. Do NOT
  use when the user wants to search records (use search-records), wants
  to know historical context like migration patterns or naming conventions
  (use historical-context), or wants to execute a specific search plan
  (use search-records or search-external-sites).
---

# Locality Guide

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

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
| `wiki_query` | Find FamilySearch wiki articles about record availability |
| `wiki_read` | Read full wiki pages for detailed record guides |
| `place_query` | Look up the place — ID, jurisdictional hierarchy, boundary changes |
| `place_population` | Population statistics (community size affects record survival) |
| `place_collections` | FamilySearch record collections covering this place |
| `place_external_links` | FS-curated third-party URLs (Ancestry, MyHeritage, archives, wiki pages) for this place and period |
| `wikipedia_query` | Find Wikipedia articles about the place's history |
| `wikipedia_read` | Read historical context from Wikipedia |

## Steps

### 1. Identify the target

From the user's request, determine:
- **Place:** Country, state/province, county, town
- **Time period:** The years of interest (e.g., 1840-1880)
- **Scope:** All record types, or a specific subset?

If the user specifies only a place without a time period, ask for one.
A guide without a time period cannot assess which records apply.

### 2. Establish jurisdictional context

Call MCP tools to establish the jurisdiction:

```
place_query({ query: "Schuylkill County, Pennsylvania" })
place_population({ place_id: "<id>", year_start: 1840, year_end: 1880 })
wikipedia_query({ query: "Schuylkill County Pennsylvania history" })
```

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
wiki_query({ query: "Schuylkill County Pennsylvania genealogy records" })
wiki_read({ title: "<relevant wiki page>" })
place_collections({ query: "Schuylkill County Pennsylvania" })
place_external_links({ placeId: <id>, startYear: <year>, endYear: <year> })
```

`place_external_links` returns a flat list of FS-curated third-party URLs
(`{ url, linkText }`) across Ancestry, MyHeritage, FindMyPast,
FindAGrave, Newspapers.com, national archives, and FS wiki resource
pages, filtered to those whose own date range overlaps the requested
window. The list is not grouped by site and is not deduplicated —
collapse duplicate URLs before listing repositories in the guide.

**Compare `totalResults` and `matchedCount`.** If `totalResults > 0`
but `matchedCount === 0`, FS curates resources for this place
*outside* your time window — note the gap in the guide rather than
reporting "no online resources." If `totalResults === 0`, FS has no
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
| Place is a country or state (very broad) | Ask the user to narrow to a county or region. A country-level guide is too generic to be useful for research planning |
| User asks "why" questions about records or history | Redirect to historical-context skill |
| User asks about record availability AND wants a research plan | Produce the locality guide first, then hand off to research-plan |
| Records appear destroyed for the target period | List substitute sources (see `references/locality-survey-methodology.md` section 5) |
| The jurisdiction did not exist during the target period | Identify the parent jurisdiction that held authority at that time and produce the guide for that jurisdiction instead |

## Important rules

- **Be specific about availability.** Don't say "records may exist"
  — say "FamilySearch has 2.3M indexed probate records for
  Pennsylvania" or "no digitized records found for this county."
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
