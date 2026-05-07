---
name: research-plan
description: Creates a sequenced research plan for answering a specific
  genealogy question — which record sets to search, in what order, from
  which repositories, with fallbacks. GPS Step 1 — Reasonably Exhaustive
  Research (planning phase). Use when the user says "plan research for
  [question]", "how do I answer this?", "what records should I search?",
  "create a plan", "where should I look?", or after question-selection
  creates a new question. Do NOT use when the user wants to execute a
  search (use search-records or search-external-sites), wants to select
  which question to research (use question-selection), or wants to
  analyze records already found (use record-extraction).
---

# Research Plan

Given a specific research question, produces a concrete plan to answer
it: which record sets to search, in what order, from which repositories,
with rationale for each step and fallbacks when primary sources yield
nothing.

## Inputs

- A research question from `research.json` `questions[]` (identified
  by `q_` ID or by the user describing what they want to answer)
- The project context: what's already been searched (log), what
  persons/dates/places are known (assertions, tree.gedcomx.json)

## MCP tools used

This skill uses external tools to understand what records exist for
the target jurisdiction and time period:

| Tool | Purpose |
|------|---------|
| `wiki_query` | Find FamilySearch wiki articles about research methodology for the jurisdiction |
| `place_query` | Look up the place — jurisdictional hierarchy, boundary changes, parent jurisdictions |
| `place_collections` | Find FamilySearch record collections covering this place |
| `place_population` | Get population statistics to understand community size |
| `place_external_links` | Find external record collections and sites covering this place |
| `research_guidance` | Get country-specific research guidance |
| `online_records` | List online record sources for the country |

## Steps

### 1. Understand the question's context

Read the question's `rationale` and `selection_basis`. Understand:
- **Who** is the subject? What is known about them? (Read
  tree.gedcomx.json and assertions)
- **What** event or relationship is being investigated?
- **Where** geographically? What jurisdiction, county, state/province,
  country?
- **When** is the target time period?
- **What's been tried?** Read the log for prior searches on this
  question (via plan items referencing this question's plans)

### 2. Research the jurisdiction

Call MCP tools to understand what records are available:

```
place_query({ query: "Schuylkill County, Pennsylvania" })
```
→ Gives place ID, jurisdictional hierarchy, boundary changes over time

```
place_collections({ query: "Schuylkill County Pennsylvania" })
```
→ Lists FamilySearch collections covering this place with record/image counts

```
place_external_links({ placeId: <place_id> })
```
→ Lists external sites with collections for this place (Ancestry collections, FindMyPast, etc.)

```
research_guidance({ country: "United States" })
```
→ Country-specific research strategies

```
wiki_query({ query: "Pennsylvania probate records genealogy" })
```
→ FamilySearch wiki articles about record types, availability, and research tips

### 3. Identify relevant record sets

Based on the question, the jurisdiction research, and the time period,
identify which record sets could answer the question. Consider:

**Record types by research goal:**

| Goal | Primary record types | Secondary/fallback |
|------|---------------------|-------------------|
| Identify parents | Census (household), vital records (death/birth cert), probate (will), church (baptism) | Military pension, immigration, land deeds (witnesses) |
| Confirm identity | Census (name/age/place across decades), vital records, church records | Newspaper, tax records, city directories |
| Find birth date/place | Vital records (birth cert), census (age), church (baptism), death cert (secondary) | Military records, immigration, delayed birth cert |
| Find death date/place | Vital records (death cert), cemetery/FindAGrave, obituary, probate | Church burial, pension file, Social Security |
| Find marriage | Vital records (marriage cert), church (marriage register), newspaper (announcement) | Census (married status), county bonds/licenses |
| Track migration | Census (residence across decades), land records, tax records | Church transfers, newspaper, city directories |
| FAN research | Land deeds (witnesses), census (neighbors), probate (witnesses), church (godparents) | Business records, court records, military unit records |

**Jurisdiction-specific considerations:**
- **Boundary changes:** Did the county/state boundaries change during
  the research period? (e.g., Virginia → West Virginia 1863). Use
  `place_query` to check jurisdictional hierarchy over time.
- **Record availability:** Not all jurisdictions have the same
  records. Pennsylvania has birth/death certificates from 1906;
  earlier births require church records. Use `place_collections`
  and `wiki_query` to check availability.
- **Record destruction:** Courthouse fires, flood damage, wartime
  destruction. Wiki articles often note these. If primary records
  are known to be destroyed, plan for substitutes.

### 4. Sequence the plan items

Order the record sets strategically:

1. **Start with the most likely to succeed.** If the 1860 census is
   fully indexed and the subject should appear, search it first.
2. **Free before paid.** FamilySearch before Ancestry/MyHeritage.
3. **Original before derivative.** If both the original image and an
   index exist, search the index for discovery but plan to verify
   against the original.
4. **Narrow before broad.** Search the specific county before
   searching adjacent counties.
5. **Include fallbacks.** If the primary record set might not exist
   or might not contain the subject, plan a fallback. Use the
   `fallback_for` field to link them.

### 5. Write the plan

Add a new plan to `research.json` `plans[]`:

```json
{
  "id": "pl_003",
  "question_id": "q_003",
  "status": "active",
  "created": "2026-05-04",
  "items": [
    {
      "id": "pli_007",
      "sequence": 1,
      "record_type": "probate",
      "jurisdiction": "Schuylkill County, Pennsylvania",
      "date_range": "1875-1890",
      "repository": "FamilySearch",
      "rationale": "Thomas Flynn likely died circa 1881 (disappears from tax records). Schuylkill County probate records 1810-1920 are indexed on FamilySearch. A will naming Patrick as a son would be direct evidence of parentage.",
      "fallback_for": null,
      "status": "planned"
    },
    {
      "id": "pli_008",
      "sequence": 2,
      "record_type": "probate",
      "jurisdiction": "Schuylkill County, Pennsylvania",
      "date_range": "1875-1890",
      "repository": "Ancestry",
      "rationale": "Ancestry has a separate probate index for Schuylkill County. Cross-check in case FamilySearch indexing missed the record.",
      "fallback_for": null,
      "status": "planned"
    },
    {
      "id": "pli_009",
      "sequence": 3,
      "record_type": "land",
      "jurisdiction": "Schuylkill County, Pennsylvania",
      "date_range": "1850-1885",
      "repository": "FamilySearch",
      "rationale": "If no probate record exists, land deeds may name Thomas Flynn's heirs. Also useful for FAN research — witnesses on deeds are often family members.",
      "fallback_for": "pli_007",
      "status": "planned"
    }
  ]
}
```

**Plan item fields:**

- `record_type`: census, vital_record, probate, land, church,
  military, newspaper, cemetery, tax, immigration, court, other
- `jurisdiction`: Human-readable place description
- `date_range`: Target period (e.g., "1875-1890", "1850")
- `repository`: FamilySearch, Ancestry, MyHeritage, FindMyPast,
  NARA, state_archives, county_courthouse, other
- `rationale`: Why this record set for this question — what it
  could reveal and why it's worth searching
- `fallback_for`: `pli_` ID of the plan item this falls back from,
  or null. The fallback is searched if the primary yields nothing.

### 6. Handle re-planning

If a previous plan for this question exists and failed (all items
searched, question still unresolved):

1. Set the old plan's status to `superseded`
2. Create a new plan that addresses what the old plan missed:
   - Different repositories
   - Adjacent jurisdictions
   - Different record types
   - FAN-directed searches (if question-selection set
     `selection_basis: "fan_pivot"`)
3. Reference the old plan in the rationale: "Previous plan
   (pl_002) searched census and death certificate. This plan
   targets probate and land records."

Never modify a superseded plan's items — it's part of the audit trail.

### 7. Validate and present

Invoke `validate-schema`. Then present the plan to the user:

- The question being addressed
- Each plan item with its rationale, in execution order
- Fallback relationships ("if step 1 yields nothing, step 3 is
  the fallback")
- Total estimated scope (how many searches)
- Suggest next step: "Would you like me to start executing this
  plan?" (search-records / search-external-sites, depending on
  the repositories)

## Example

**Question:** q_003 — "Did Thomas Flynn leave a will or probate record
in Schuylkill County naming Patrick as a son?"

**Jurisdiction research:**
- `place_query("Schuylkill County, Pennsylvania")` → County formed
  1811, seat at Pottsville, part of Pennsylvania throughout
- `place_collections("Schuylkill County Pennsylvania")` → FamilySearch
  has "Pennsylvania Probate Records, 1683-1994" (indexed, 2.3M records)
  and "Pennsylvania Land Records, 1687-1940" (images, not indexed)
- `place_external_links(...)` → Ancestry has "Pennsylvania Wills and
  Probate Records" collection
- `wiki_query("Pennsylvania probate records")` → Wiki says: probate
  jurisdiction is the Register of Wills office at the county seat;
  records include wills, administrations, guardianships, orphans' court

**Plan created:** pl_003 with three items (probate on FamilySearch,
probate on Ancestry, land records as fallback)

## Important rules

- **One plan per question.** If a question needs re-planning, create
  a new plan and supersede the old one. Never modify a superseded plan.
- **Rationale is mandatory.** Every plan item must explain WHY this
  record set could answer the question. "Because it exists" is not
  sufficient. "Thomas Flynn likely died circa 1881 based on his
  disappearance from tax records; a will naming Patrick would be
  direct evidence of parentage" is sufficient.
- **Don't duplicate prior searches.** Check the log before planning.
  If the 1850 census was already searched for this question, don't
  plan to search it again unless searching a different repository
  or with different parameters.
- **Plan for both FamilySearch and external sites.** A thorough plan
  includes both API-searchable repositories (FamilySearch) and
  external sites (Ancestry, FindMyPast, etc.) that require the
  click-capture workflow.
