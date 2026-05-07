---
name: locality-guide
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

Produces a comprehensive research guide for a specific place and time
period. This skill answers: "What genealogical records exist for this
jurisdiction, where are they held, and what should I know before
researching here?"

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_query` | Find FamilySearch wiki articles about record availability |
| `wiki_read` | Read full wiki pages for detailed record guides |
| `place_query` | Look up the place — ID, jurisdictional hierarchy, boundary changes |
| `place_population` | Population statistics for context (community size affects record survival) |
| `place_collections` | FamilySearch record collections covering this place |
| `place_external_links` | External sites and collections for this place |
| `wikipedia_query` | Find Wikipedia articles about the place's history |
| `wikipedia_read` | Read historical context from Wikipedia |

## Steps

### 1. Identify the target place and time

From the user's request, determine:
- **Place:** Country, state/province, county, town
- **Time period:** The years of interest (e.g., 1840-1880)
- **Research focus:** What kind of records are they looking for?
  (All types? Just vital records? Just land records?)

### 2. Research the jurisdiction

Call MCP tools to gather information:

```
place_query({ query: "Schuylkill County, Pennsylvania" })
```
→ Place ID, full name, type, jurisdictional hierarchy, date range,
parent place, coordinates

```
place_population({ placeId: <id>, timePeriod: "1840-1880" })
```
→ Population size (helps estimate record volume and survival)

```
place_collections({ query: "Schuylkill County Pennsylvania" })
```
→ FamilySearch collections with record/person/image counts

```
place_external_links({ placeId: <id> })
```
→ External collection links (Ancestry, FindMyPast, state archives)

```
wiki_query({ query: "Schuylkill County Pennsylvania genealogy records" })
```
→ FamilySearch wiki articles about this jurisdiction

```
wiki_read({ title: "<relevant wiki page>" })
```
→ Full article with record availability details, courthouse info,
library resources

```
wikipedia_query({ query: "Schuylkill County Pennsylvania history" })
```
→ Historical overview (formation date, economy, demographics)

### 3. Compile the locality guide

Organize the information into a structured guide:

```markdown
# Locality Guide: Schuylkill County, Pennsylvania (1840-1880)

## Jurisdiction overview
- **Formed:** 1811 from Berks and Northampton counties
- **County seat:** Pottsville
- **Parent jurisdiction:** Pennsylvania
- **Population:** ~70,000 (1850), ~116,000 (1870)
- **Economy:** Coal mining region (anthracite)
- **Major ethnic groups:** Irish, German, Welsh immigrants

## Boundary changes
- [List any relevant boundary changes during the target period]
- [Note: if the boundaries were stable, say so]

## Available record types

### Vital records
- **Birth certificates:** Available from 1906 (Pennsylvania state
  registration). Earlier births: church records only.
- **Death certificates:** Available from 1906. Earlier deaths:
  church burial records, cemetery records.
- **Marriage records:** County marriage licenses from [date].
  Church records supplement earlier periods.
- **Where held:** Pennsylvania State Archives, Harrisburg;
  FamilySearch (digital images for some periods)

### Census records
- **Federal census:** 1790-1880 available. 1890 destroyed.
  All available on FamilySearch (indexed + images).
  Also on Ancestry (separate indexing).
- **State census:** [Pennsylvania had no state census]

### Probate and court records
- **Wills and administrations:** From 1811 (county formation).
  Held at Schuylkill County Courthouse, Pottsville.
  FamilySearch has "Pennsylvania Probate Records 1683-1994"
  (indexed, 2.3M records).
- **Orphans' Court:** Guardianship records from [date].

### Land records
- **Deeds:** From 1811. County Recorder of Deeds, Pottsville.
  FamilySearch has images (not indexed).
- **Tax records:** [availability]

### Church records
- **Major denominations present:** Catholic, Lutheran, Reformed,
  Methodist, Presbyterian
- **Where held:** [diocese archives, FamilySearch microfilm, etc.]

### Cemetery records
- **FindAGrave coverage:** [number of memorials]
- **Major cemeteries:** [list]

### Newspapers
- **Local papers:** [names and date ranges]
- **Where held:** [Newspapers.com, Chronicling America, local
  library]

### Military records
- **Civil War (1861-1865):** Pennsylvania sent [number] regiments.
  Service records at NARA. Pension files at NARA.
- **Earlier conflicts:** [as relevant]

## Online collections

### FamilySearch
[List collections from place_collections with record counts]

### Ancestry
[List collections from place_external_links]

### Other repositories
[State archives, county historical society, etc.]

## Research tips
- [Jurisdiction-specific advice from the wiki]
- [Known record losses (courthouse fires, floods)]
- [Alternative sources when primary records are missing]
- [Local naming conventions or spelling patterns]
```

### 4. Present the guide

Output the guide directly to the user. This skill does NOT write to
research.json or tree.gedcomx.json — the guide is informational
output that informs the user's decisions and feeds into research-plan.

## Important rules

- **Output only — no file writes.** This skill reads MCP tools and
  produces output. It does not modify project files.
- **Be specific about availability.** Don't say "records may exist"
  — say "FamilySearch has 2.3M indexed probate records for
  Pennsylvania" or "no digitized records found for this county."
- **Note gaps honestly.** If records were destroyed (courthouse fire,
  1890 census), say so clearly. If a record type doesn't exist for
  this jurisdiction or period, say so.
- **Include access information.** For each record type, note WHERE
  it's held and HOW to access it (free online, paid subscription,
  in-person only, mail request).
- **Cite the wiki.** When information comes from a FamilySearch wiki
  article, mention it so the user can read the full article for more
  detail.
