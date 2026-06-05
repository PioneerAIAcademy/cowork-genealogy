---
name: research-plan
model: claude-sonnet-4-6
description: Creates a sequenced research plan (written to research.json) for answering a specific
  genealogy question — which record sets to search, in what order, from
  which repositories, with fallbacks. GPS Step 1 — Reasonably Exhaustive
  Research (planning phase). Aligned with BCG Standards 9-18 for planned
  research. Use when the user says "plan research for [question]", "how
  do I answer this?", "what records should I search?", "create a plan",
  "where should I look?", or after question-selection creates a new
  question. Do NOT use when the user wants to execute a search (use
  search-records or search-external-sites), wants to select which
  question to research (use question-selection), or wants to analyze
  records already found (use record-extraction).
allowed-tools:
  - wiki_search
  - place_search
  - place_collections
  - place_population
  - place_external_links
  - image_search
  - wiki_country_research_tips
  - wiki_country_online_records
  - validate_research_schema
---

# Research Plan

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Given a specific research question, produces a concrete plan to answer
it: which record sets to search, in what order, from which repositories,
with rationale for each step and fallbacks when primary sources yield
nothing.

Load `references/planning-standards.md` for BCG standards (9-18) that
govern research planning. Load `references/record-type-guide.md` for
record-type selection by research goal.

## Inputs

- A research question from `research.json` `questions[]` (identified
  by `q_` ID or by the user describing what they want to answer)
- The project context: what's already been searched (log), what
  persons/dates/places are known (assertions, tree.gedcomx.json)

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_search` | FamilySearch wiki articles about record availability for the jurisdiction |
| `place_search` | Place ID, jurisdictional hierarchy, boundary changes |
| `place_collections` | FamilySearch record collections covering this place |
| `place_population` | Population statistics to understand community size |
| `place_external_links` | FS-curated third-party URLs (Ancestry, MyHeritage, archives, wiki pages) for this place and period |
| `wiki_country_research_tips` | Country-specific research strategies |
| `wiki_country_online_records` | Online record sources for the country |

## Steps

### 1. Understand the question's context

Read the question's `rationale` and `selection_basis`. Determine:
- **Who** — the subject and what is known (tree.gedcomx.json, assertions)
- **What** — the event or relationship under investigation
- **Where** — jurisdiction, county, state/province, country
- **When** — target time period
- **Prior searches** — read the log for this question's plan items

**Verify the starting point (BCG Standard 11).** Before building a
plan, check whether starting-point facts are documented or merely
assumed. Flag unsupported assumptions (e.g., "widow = mother of all
children", "family followed popular migration route") and include plan
items to verify them before relying on them.

### 1a. Decide the planning mode

Read ALL plans for the target question (`plans[]` where
`question_id == <target>`), regardless of status. The mode you take
depends on what's already there — read first, decide second, write
last.

**Review mode** — An existing plan is `active` and still has items
in `planned` or `in_progress` status. The user wants a recap of
what's already planned and a recommendation for the next step. Narrate
which item is next, why it's the logical next given the project's
state, and what would follow it. **Do not create a new plan. Do not
modify items.** The active plan is the audit trail; review-mode is
explanatory only.

**Add-new mode** — The most recent plan's items are all `completed`
(or `skipped`), but the question is not yet `proved` (its
`proof_summaries[].status` is below `proved`, or no proof summary
exists). Create a NEW plan targeting next-best record types. Leave
the completed plan untouched — it stands as the record of what was
done. Set the new plan's `status: "active"`.

**Supersede mode (re-plan)** — The active plan has unfinished items
but new information invalidates its assumptions (e.g., the subject
turned out to be a different person, a boundary change moved the
records to a different jurisdiction). Apply Step 6 ("Handle
re-planning"): supersede the old plan, create a new one.

**Heuristic for ambiguous prompts.** When a user message could mean
either "tell me the plan" (review) or "make a plan" (add/supersede),
default to review when an active plan exists with unfinished items.
Adding a duplicate plan alongside a usable one is a worse mistake
than narrating what's already there.

### 2. Conduct a locality survey

Determine what records exist for the target jurisdiction and time
period. This is the foundation of sound planning.

**Decision: invoke locality-guide or do inline?**
- If no locality guide exists yet for this jurisdiction/period, invoke
  the `locality-guide` skill first to produce one, then return here.
- If a locality guide already exists in the project, read it and
  supplement with targeted MCP calls for any gaps.
- For a quick inline survey (familiar jurisdiction, narrow question),
  call MCP tools directly:

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
place_collections({ query: "Schuylkill County Pennsylvania" })
place_external_links({ placeId: "<place_id>", startYear: 1875, endYear: 1890 })
image_search({ placeId: "<place_id>", fromDate: "1875-01-01", toDate: "1890-12-31" })
wiki_search({ query: "Pennsylvania probate records genealogy" })
wiki_country_research_tips({ standardPlace: "Pennsylvania, United States" })
wiki_country_online_records({ standardPlace: "Pennsylvania, United States" })
```

Pass the question's target period to `place_external_links` as `startYear`
and `endYear`. The tool returns a flat list of curated URLs across
all third-party sites mixed together — use `linkText` to identify
the collection and the URL host to identify the site. Dedupe by URL
before adding plan items.

Use `image_search` to discover browse-only image groups (digitized
microfilm, book scans) for the jurisdiction. Many records exist only
as unindexed images — `place_collections` shows indexed collections,
but `image_search` reveals volumes that may not appear in indexed
search results. Include these as plan items when the question calls
for records that may not be indexed.

**What the survey must answer for planning purposes:**
- Which record types exist for this place and period
- Whether records survive (fires, floods, wartime destruction)
- Where records are held and how to access them (indexed, images-only,
  on-site only)
- Boundary changes affecting which jurisdiction holds the records

### 3. Identify relevant record sets

Based on the question, the locality survey, and the time period,
identify which record sets could answer the question.

Load `references/record-type-guide.md` for the record-type-by-goal
table and contextual factors checklist.

**Key selection principles:**
- Apply topical breadth (BCG Standard 14) — do not limit the plan
  to census and vital records.
- Include the FAN cluster (relatives, neighbors, associates) — their
  records may contain evidence about the subject.
- Consider occupation-specific, institutional, and organizational
  records when relevant to the subject's life.
- Account for boundary changes, record destruction, and legal context
  that affect what records exist.

### 4. Sequence the plan items

Order items for efficient discovery (BCG Standard 15):

1. **Highest probability first** — indexed sources where the subject
   should appear
2. **Free before paid** — FamilySearch before Ancestry/MyHeritage
3. **Original before derivative** — search the index for discovery,
   plan to verify against the original image
4. **Narrow before broad** — specific county before adjacent counties
5. **Include contingencies** — use `fallback_for` to link alternate
   sources when a primary may fail
6. **Include FAN items** — at least one search targeting records of
   relatives, neighbors, or associates

**Plan size guidance:** A typical plan has 4-10 items. Fewer than 3
items usually means the plan is not exhaustive enough. More than 12
items may indicate the question is too broad — consider splitting.

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

If a previous plan for this question exists and all items are searched
but the question remains unresolved:

1. Set the old plan's status to `superseded`
2. Create a new plan targeting what the old plan missed (different
   repositories, adjacent jurisdictions, different record types,
   FAN-directed searches, contextual sources)
3. Reference the old plan in the rationale

Never modify a superseded plan — it is part of the audit trail.

**Termination (BCG Standard 18):** If all identified sources are
exhausted or inaccessible and the question remains unresolved, set
the plan status to `exhausted`. Note explicitly that the GPS cannot
be met. This is an acceptable outcome — not every question is
answerable with available records.

### 7. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Then present the plan to the user:

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

**Locality survey:**
- `place_search("Schuylkill County, Pennsylvania")` → County formed
  1811, seat at Pottsville, part of Pennsylvania throughout
- `place_collections("Schuylkill County Pennsylvania")` → FamilySearch
  has "Pennsylvania Probate Records, 1683-1994" (indexed, 2.3M records)
  and "Pennsylvania Land Records, 1687-1940" (images, not indexed)
- `place_external_links(...)` → URL to Ancestry's "Pennsylvania Wills and
  Probate Records" page (linkText match), plus a FindMyPast probate
  link
- `wiki_search("Pennsylvania probate records")` → Wiki says: probate
  jurisdiction is the Register of Wills office at the county seat;
  records include wills, administrations, guardianships, orphans' court

**Plan created:** pl_003 with three items (probate on FamilySearch,
probate on Ancestry, land records as fallback)

## Rules

- **One active plan per question.** Re-planning creates a new plan
  and supersedes the old one.
- **Never modify items on existing plans.** Plan items are the audit
  trail — once an item is written, this skill does not edit it. Item
  status transitions (`planned → in_progress → completed`) are made
  by the skills that execute the items (search-records,
  search-external-sites), not by research-plan. If a plan needs
  different items than what was written, supersede the whole plan
  (Step 6) rather than mutating items in place.
- **Rationale is mandatory.** Every item must explain what evidence
  this source could yield and why. "Because it exists" is insufficient.
- **No duplicate searches.** Check the log first. Only re-plan a
  source if using a different repository or parameters.
- **Both FamilySearch and external sites.** A GPS-compliant plan
  includes API-searchable and click-capture repositories.
- **Beyond online indexes.** Include image-only collections, catalog
  searches, and physical repositories when relevant.
- **No unsupported assumptions.** If the plan depends on a hypothesis,
  include items to test it first.
- **FAN items required.** At least one item targeting associates when
  direct evidence about the subject may be scarce.
- **Originals over derivatives.** When planning an index search, also
  plan to verify against the original.

## Decision rules

| Situation | Action |
|-----------|--------|
| No locality guide exists for this jurisdiction | Invoke `locality-guide` skill first, then return here |
| Question is too vague to plan for | Return to `question-selection` to refine it |
| All plan items exhausted, question unresolved | Set plan to `exhausted`; invoke `research-exhaustiveness` to evaluate the question against the GPS stop criteria. If it returns "not yet exhaustive," follow its recommendation — extend the plan here, or invoke `question-selection` for a FAN pivot |
| User says "start searching" | Hand off to `search-records` (FamilySearch items) or `search-external-sites` (other repositories) |
| New information during execution invalidates plan assumptions | Create a new plan (supersede the old one) |
| Plan would exceed 12 items | Consider whether the question is too broad; suggest splitting via `question-selection` |

## Re-invocation behavior

**Writes:** entries in the `plans` section of `research.json` (`plan_`
ids and nested `pli_` plan items). Old plans are marked
`superseded`, never deleted.

**On repeat invocation:** if a plan for the active research question is
present and still `active`, refine its plan items or extend the
sequence in place. If the user is explicitly re-planning (different
strategy, different repository mix), mark the existing plan
`superseded` and write a new `plan_` entry with new `pli_` items.

**Do not duplicate:** never leave two `plan_` entries with `status:
"active"` for the same research question. The superseded-on-replan
rule is what keeps the planning record auditable — preserve it.
