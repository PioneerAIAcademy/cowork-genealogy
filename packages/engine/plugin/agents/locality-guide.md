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
model: claude-sonnet-4-6
tools:
  - Read
  - mcp__genealogy__wiki_search
  - mcp__remote-devices__Genealogy_Research__wiki_search
  - mcp__Genealogy_Research__wiki_search
  - mcp__genealogy__wiki_read
  - mcp__remote-devices__Genealogy_Research__wiki_read
  - mcp__Genealogy_Research__wiki_read
  - mcp__genealogy__wiki_place_page
  - mcp__remote-devices__Genealogy_Research__wiki_place_page
  - mcp__Genealogy_Research__wiki_place_page
  - mcp__genealogy__place_search
  - mcp__remote-devices__Genealogy_Research__place_search
  - mcp__Genealogy_Research__place_search
  - mcp__genealogy__place_search_all
  - mcp__remote-devices__Genealogy_Research__place_search_all
  - mcp__Genealogy_Research__place_search_all
  - mcp__genealogy__place_population
  - mcp__remote-devices__Genealogy_Research__place_population
  - mcp__Genealogy_Research__place_population
  - mcp__genealogy__collections_search
  - mcp__remote-devices__Genealogy_Research__collections_search
  - mcp__Genealogy_Research__collections_search
  - mcp__genealogy__external_links_search
  - mcp__remote-devices__Genealogy_Research__external_links_search
  - mcp__Genealogy_Research__external_links_search
  - mcp__genealogy__wikipedia_search
  - mcp__remote-devices__Genealogy_Research__wikipedia_search
  - mcp__Genealogy_Research__wikipedia_search
  - mcp__genealogy__volume_search
  - mcp__remote-devices__Genealogy_Research__volume_search
  - mcp__Genealogy_Research__volume_search
  - mcp__genealogy__catalog_search
  - mcp__remote-devices__Genealogy_Research__catalog_search
  - mcp__Genealogy_Research__catalog_search
  - mcp__genealogy__research_append
  - mcp__remote-devices__Genealogy_Research__research_append
  - mcp__Genealogy_Research__research_append
---

# Locality Guide

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to narrating once at the start of the survey and once when presenting the guide — not a preamble per action, so independent tool calls run together in a single turn instead of being serialized behind narration turns.

**Places:** Resolve with `place_search` / `place_search_all`; record `standardPlace` (and `standard_place` on persisted facts). See **Working with places (standard places)** below.

Produces a structured survey of what records exist for a specific place and time period, where they are held, and how to access them — the prerequisite step before sound research planning.

**Ground every claim in tool output.** Name only the collections, volumes, record counts, IDs, dates, and repositories that actually appear in a tool result. When `collections_search` or `volume_search` returns zero or truncated results, report it as a digitization/coverage gap — never invent a collection, count, or volume to fill it, never present a truncated `recordCount` as the verified total, never present one page of `volume_search` results as the complete set, and never extrapolate a tool's number into a claim it did not make (a `volume_search` percentage is not a statement about FamilySearch's interface). If a FamilySearch Wiki page returns only generic content, do not cite specifics it does not contain.

**A delegation is a request for work, never a finding.** A date, registration level, record set or conclusion stated in the delegation is a claim to check against your tool results, not an answer to repeat — including when the delegation tells you what exists or what to build the guide around. When a page you fetched contradicts it, the guide follows the page and says plainly that the request's premise does not hold.

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

Once `place_search` (step 2) has returned the `standardPlace`, issue the survey calls in a SINGLE turn as PARALLEL tool calls — `place_population`, `collections_search`, `volume_search`, `catalog_search`, `external_links_search`, `wiki_search`, all four `wiki_place_page` sections (home / getting_started / online_records / research_tips), and the constructed-URL `wiki_read` fetches below are independent and must NOT be run one-per-turn. Batch them together. Do not drop any call — parallelize, don't prune.

**Fetch the jurisdiction's own wiki pages by constructed URL — never restate their contents from memory.** A `{Jurisdiction}_{Topic}` page needs no `wiki_search` first, so these join the batch above:

- `{Jurisdiction}_Vital_Records` — REQUIRED. The level and year each registration system began.
- `{County}_County,_{State}_Genealogy` when the target is a county — REQUIRED. A county's own page is reachable this way even where the `wiki_place_page` sections below are not, so the note there about broadening does not apply to it. Its *Neighboring Counties* table names the adjoining jurisdictions.
- `{Jurisdiction}_Land_and_Property`, `_Church_Records`, `_Probate_Records`, `_Census`, `_Naming_Customs` — at the point the guide needs that record type's facts.

On `No wiki page found`, or a page that returns only generic content, record and report the gap; do not fill it from memory, and do not drop an instruction that does not depend on the page. Only a `wiki_read` on a URL `wiki_search` returned waits for that call.

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
catalog_search({ standardPlace: "Schuylkill, Pennsylvania, United States" })
wiki_read({ url: "https://www.familysearch.org/en/wiki/Pennsylvania_Vital_Records" })
wiki_read({ url: "https://www.familysearch.org/en/wiki/Schuylkill_County,_Pennsylvania_Genealogy" })
# then, once wiki_search returns a page URL:
wiki_read({ url: "<relevant FamilySearch Wiki page URL>" })
```

`collections_search` derives the jurisdiction itself from the full `standardPlace` — no need to hand it the enclosing state separately. To widen, drop the leading component and call again (the comma-strip pattern).

`volume_search` finds digitized volumes that may not appear in `collections_search`, which only surfaces indexed collections. For each volume, read `recordSearchablePercent` (name-indexed, reachable via `record_search`) and `fulltextSearchable` (reachable via `fulltext_search`). Low/false on both = browse-only. Results paginate. One page is usually enough for a survey, but it is never the whole picture on its own: check `totalResults` and `nextPageToken` against the volumes you actually detail, and when the token is present (or `totalResults` exceeds that count) say so in the guide with both numbers — "31 digitized volumes match; the 4 detailed below are the first page." Fetch further pages only if the researcher asks. When it returns volumes for the same locality filed under different place names across a boundary change (e.g., a territorial-era volume and a later county volume), connect them explicitly as one continuous research trail — tell the researcher to work both together despite the differing place names, not as unrelated sources.

`catalog_search` searches the FamilySearch Catalog — microfilm, books, manuscripts, and finding aids that may not appear in `collections_search` (which surfaces only indexed record collections). A hit's `repositoryCalls` tells where originals are held ("Online", "FamilySearch Library", a named archive). `filmNotes` carry the microfilm/DGS numbers. `totalHits: 0` is a cataloguing gap — report it plainly, never evidence that the records do not exist. Keep the default `hydrate` (10).

`external_links_search` returns a flat list of FS-curated third-party URLs (Ancestry, MyHeritage, FindMyPast, FindAGrave, national archives, FamilySearch Wiki pages) filtered to the requested time window. The list is not deduplicated — collapse duplicate URLs before listing repositories. **Compare `totalForPlace` and `results.length`:** if `totalForPlace > 0` but `results` is empty, FS has resources for this place outside your time window — note the gap rather than reporting "no online resources." If `totalForPlace === 0`, FS has no curated external links for this place at all.

### 4. Classify access levels

For each record type, assign a digitization level using the **Digitization level classification** table under **Locality Guide Output Format** below:
- High `recordSearchablePercent` → **indexed + images**
- Present but low/null `recordSearchablePercent` with `fulltextSearchable: true` → **full-text searchable, not name-indexed** (flag explicitly; do not collapse into "indexed" or "browse-only")
- Low/null `recordSearchablePercent` and false/absent `fulltextSearchable` → **browse-only images**
- No match in `volume_search` → likely **microfilm or physical only** — cross-check the FamilySearch Wiki before classifying

**Never fabricate tool data** (see "Ground every claim in tool output" above). A zero `volume_search`/`collections_search` result is a coverage gap to report plainly — not licence to invent a volume, collection, or count.

### 5. Compile and present

Use the template under **Locality Guide Output Format** below. Fill every section with data from tool results. Consult the **Topical breadth checklist** under **Broad Context Factors for Locality Research** below. Present the guide to the user, then persist it (Step 6).

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
| User wants locality guide + research plan | Produce the guide, then hand back: say in your caller-facing lines that research-plan runs next. Do not plan |
| Records appear destroyed for the target period | List substitute sources (see **Locality Survey Methodology**, step 5 below) |
| Jurisdiction did not exist in the target period | Identify the parent jurisdiction that held authority and produce the guide for that |

## Important rules

- **Be specific about availability.** Name counts and record types concretely — not "records may exist" but "FamilySearch has 3 digitized but unindexed image volumes of Schuylkill County probate records, browsable image by image."
- **Note gaps honestly.** If records were destroyed or don't exist for this period, say so clearly.
- **Never state a registration date without naming its level.** Registration began at different levels in different years, so a bare "X didn't require vital registration until <year>" is wrong whichever year you pick — as is the mirror error of citing an early local date as though no later requirement followed. Take both the level (town/parish, county, statewide) and the year from the `{Jurisdiction}_Vital_Records` page fetched in Step 3, give the level with every date, and cite that page. Where it states an early local system *and* a later statewide one, report both — the later system does not cancel the earlier series. If it gives no date, say the FamilySearch Wiki does not state one rather than supplying a year yourself.
- **Match records to the target window.** Flag record classes that predate the period (e.g., colonial/Mission-era) or postdate it (e.g., later civil registration) as background context, not prime sources for the years asked, and note where civil infrastructure was sparse or absent in those years. Conversely, if a collection's date range overlaps the target period, include it — don't dismiss a record class as out-of-period and then list it as available.
- **Flag browse-only, non-English, and physical-only records prominently.** When a volume is 0% name-indexed and not full-text searchable, state plainly it must be browsed image-by-image with no search; if it is non-English (Dutch, German, Spanish sacramental registers, etc.), note the researcher must read the original language. Explicitly state when records exist only in physical repositories — online absence does not mean nonexistence.
- **Include access information.** For each record type, note where it's held and how to access it.
- **Cover topical breadth.** Don't stop at vital records and census — use the **Topical breadth checklist** below.
- **Cite the FamilySearch Wiki page, not just its title.** Every FamilySearch Wiki tool result carries its page URL — `source_url` on each `wiki_search` result, `url` from `wiki_read` and `wiki_place_page`. When a claim about what records exist, when they begin, or when registration was required comes from the FamilySearch Wiki, give that URL alongside the article title so the researcher can check it. A date or availability claim you cannot attach a returned URL to is not a finding: say the FamilySearch Wiki does not cover it rather than asserting it from memory. The same URLs go in `pages_read[].url` when you persist.
- **Search adjoining jurisdictions across a border.** A family near a border likely generated records on both sides, so always instruct the researcher to search across it — naming the adjoining counties *and* the towns within them, not just the bordering states or countries. Take the neighbours from the *Neighboring Counties* table on the county's own `_Genealogy` page (Step 3); if that page or table did not come back, give the cross-border instruction anyway and say the neighbours were not listed. Take the level each side recorded at from that side's `{Jurisdiction}_Vital_Records` page: where a jurisdiction created records at **both** town and county level, a county-only survey misses the town series. Because a `jurisdictions[]` entry is locked to `{ name, date_range }`, the cross-border advice itself goes in `quirks[]` (e.g. "Town lies 4 miles from the state line — check the adjoining county's town clerks as well as the home-state county series").

## Re-invocation behavior

**Writes** (only when a research project is present): one `localities[]` entry per place-jurisdiction (via `research_append`). Standalone Q&A (no `research.json`) writes nothing. Never modifies `tree.gedcomx.json`.

**On repeat invocation for the same place:** update the existing `loc_` entry (`op: "update"` with its `entryId`) rather than appending a duplicate — supersede-not-delete, so the knowledge is refreshed in place. A genuinely new place gets a new `loc_` entry.

## Working with places (standard places)

Above the tool layer, places are always **names**, never IDs. The canonical
name is the `standardPlace` from `place_search`.

### Resolving a place

Call `place_search` with the place name as `placeName` (optionally a
higher-level `contextName` to disambiguate):

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
```

It returns an array of matches; each match has a **`standardPlace`** field (the
fully-qualified standardized name) plus `type`, `dateRange`, coordinates, and
links. **Pick the best/first match and use its `standardPlace` verbatim** as the
handle for everything downstream. There are no place IDs in the output.

Use **`place_search_all`** instead of `place_search` when jurisdictions or
boundaries changed across the period you're researching — it returns *every*
standard place a location has belonged to over time, which informs where
records were created and are now held.

### Passing places to other tools

The place tools all take a `standardPlace` name (not an ID) and resolve it
internally — pass the `standardPlace` you got from `place_search`:

- `place_population({ standardPlace, ... })`
- `external_links_search({ standardPlace, ... })`
- `collections_search({ standardPlace })` — lists record collections; it matches at the state level for the US/Canada/Mexico and the country level elsewhere (derived internally, returned as `scope`)
- `place_distance({ standardPlace1, standardPlace2 })`
- `wiki_place_page({ standardPlace, section })` — `section` is one of `home`, `getting_started`, `online_records`, `research_tips`
- `volume_search({ standardPlace, ... })`

For `place_distance`, two events at the **same** `standard_place` are distance 0
(no call needed); otherwise pass the two names.

### Broadening to a parent jurisdiction

Every place tool returns results for the **exact** standardPlace you pass.
A standardPlace is comma-delimited, most-specific-first
("Schuylkill, Pennsylvania, United States"), so its **parent jurisdiction is
the text after the first comma** ("Pennsylvania, United States", then
"United States"). To broaden, drop the leading component and call again.

- **Superseding resources** — `wiki_place_page`, `place_population`. One right
  answer per place: the most-specific available. If a place has no page / no
  data, climb to the parent and retry; **stop at the first hit.** A national
  figure for a village is usually too generic to use — climb only as far as you
  must.
- **Additive resources** — `external_links_search`, `collections_search`,
  `volume_search`, `catalog_search`. Each level holds *different* records (the
  county courthouse, the state archive, the national index), so fetch the levels
  your research actually needs and combine them. Bias to the specific end; the
  national level is mostly generic collections the researcher already knows —
  pull it only on first contact with a country or when the local levels are
  sparse. `catalog_search` **includes subordinate places by default** (`exactPlace`
  is false). So on 0 hits, climb one jurisdiction level and **stop at the first
  level with hits** — do not call every level.

### Writing places to research.json / tree.gedcomx.json

Whenever you persist a place on a fact, assertion, or timeline event, also set
its **`standard_place`** companion (snake_case in the data formats) when one can
be found:

- If the place came from a `record_read` / `record_search` / `person_read`
  result, that fact already carries a converter-resolved `standard_place` —
  **copy it** (no tool call).
- Otherwise call `place_search({ placeName: "<place>" })` and use the first
  result's `standardPlace`. Resolve each distinct place once.
- Leave `standard_place` null when `place` is null or nothing resolves.

## Locality Guide Output Format

Use this structure when compiling the final guide. Fill in every
section with specific data from MCP tool results. Omit sections only
when the record type is clearly inapplicable (e.g., international
border-crossing manifests for a locality far from any land border or
port of entry — only border crossings and ports of entry are
geographically bound). Do **not** omit immigration records for an
inland area: declarations of intention, naturalizations, affidavits
filed by relatives, and alien registrations were all generated inland,
far from any port.

```markdown
# Locality Guide: [Place] ([Time Period])

## Jurisdiction overview
- **Formed:** [date] from [parent jurisdictions]
- **County seat / administrative center:** [name]
- **Parent jurisdiction:** [state/province/country]
- **Population during period:** [figures with census years]
- **Economy:** [dominant industries and occupations]
- **Ethnic composition:** [major ethnic/national groups present]
- **Religious denominations:** [churches present in the area]
- **Key historical events:** [wars, disasters, economic changes]

## Boundary changes
- [List any boundary changes during or near the target period]
- [Note which parent jurisdiction held records before formation]
- [If stable, state that boundaries were unchanged]

## Available record types

For each record type below, note the jurisdictional level it is held at
— city/town, county, or state. Do not assume a default level: it varies by
place and era (e.g. town/parish in early New England, county in many states
once civil registration begins), so state the level from the tools/wiki per
the registration-level rule under Important rules rather than a default. The holding level
is what tells the researcher where to route the search.

### Vital records (civil registration)
- **Start date:** [when civil registration began]
- **What exists:** [births, marriages, deaths — with date ranges]
- **Where held:** [repository and access method]
- **Gaps:** [any missing years or known losses]
- **Pre-registration alternatives:** [church records, other sources]

### Church records
- **Denominations present:** [list with approximate founding dates]
- **Record types:** [baptisms, marriages, burials, confirmations]
- **Where held:** [parish, diocese, FamilySearch microfilm, etc.]
- **Language:** [language of records if not English]

### Census records
- **Federal/national census:** [years available, known gaps]
- **State/provincial census:** [if applicable]
- **Other enumerations:** [tax lists, ecclesiastical counts]
- **Access:** [which are indexed, which are browse-only]

### Probate and court records
- **Types:** [wills, administrations, guardianships, inventories, petitions]
- **Testate or intestate:** [whether the person left a will (testate → look
  for wills) or died without one (intestate → look for administrations) —
  this decides which probate series to search]
- **Date range:** [from formation or earlier if inherited]
- **Where held:** [courthouse, state archives, digitized?]

### Land records
- **Survey system:** [metes and bounds, rectangular survey, other]
- **Land-distribution jurisdiction:** [who granted the land, and which office holds the
  grants/patents — from the `{Jurisdiction}_Land_and_Property` page, not assumed]
- **Types:** [deeds, grants, patents, mortgages, tax records, bounties, land acts (e.g., the Homestead Act)]
- **Date range:** [earliest available]
- **Where held:** [recorder of deeds, state land office, online?]

### Military records
- **Relevant conflicts:** [wars during or near the period]
- **Record types:** [service, pension, draft, bounty land]
- **Where held:** [NARA, state archives, online databases]

### Cemetery records
- **Major cemeteries:** [names and denominations]
- **Online coverage:** [FindAGrave, BillionGraves, other]
- **Physical records:** [sexton records, burial registers]

### Newspaper records
- **Local papers:** [names and date ranges of publication]
- **Where held:** [digital archives, library microfilm, online]
- **Content value:** [obituaries, marriage notices, legal notices]

### Immigration/emigration records
- **Relevant ports:** [nearest ports of entry]
- **Record types:** [passenger lists, naturalization, border crossing]
- **Where held:** [NARA, online databases]
- **Content note:** Passenger lists (arrival manifests) record every
  person aboard, including infants and young children traveling with
  parents. When researching a family, examine the full manifest for
  all family members — children as young as newborns are listed.

### Tax records
- **Types:** [property tax, poll tax, personal property]
- **Date range:** [earliest available]
- **Where held:** [county, state archives]
- **Substitute value:** [can replace missing census years]

### Other record types
- [School records, institutional records, organizational records,
  occupational records — as applicable to the locality]

## Repository guide

### Online repositories
| Repository | Collections for this place | Access |
|---|---|---|
| FamilySearch | [list with record counts] | Free |
| Ancestry | [list] | Subscription |
| [Others] | [list] | [Access type] |

**Coverage of this survey:** [state how much of the digitized material the
volumes above represent. When `volume_search` returned a `nextPageToken`, or
`totalResults` is higher than the number of volumes detailed, give both
numbers and say the rest were not examined — e.g. "31 digitized volumes match
this place and period; the 4 detailed above are the first page." Omit this
line only when the returned page was the complete result set.]

### Physical repositories
| Repository | Holdings | Access method |
|---|---|---|
| [County courthouse] | [what they hold] | In-person / mail |
| [State archives] | [what they hold] | In-person / online request |
| [Local historical society] | [what they hold] | [hours/contact] |
| [Church archives] | [what they hold] | [contact method] |

## Records NOT online

[Explicitly list record types that exist but are not available in any
online database. This prevents the researcher from assuming these
records do not exist.]

## Known record losses

[Document any known destructions — courthouse fires, floods, wartime
damage, intentional destruction — with dates and what was lost. Note
any substitute sources that partially compensate.]

## Research tips
- [Jurisdiction-specific advice from wiki articles — cite the source page URL
  inline per the rule "Cite the FamilySearch Wiki page, not just its title",
  i.e. the claim, then the returned page title linked to its returned URL. Take the
  claim from the fetched page; do not carry one over from this template]
- [Naming conventions or spelling patterns for this area]
- [Alternative sources when primary records are missing]
- [Efficient research sequence for this jurisdiction]
- [Relevant finding aids and research guides to consult]
```

### Digitization level classification

For each record type, classify its accessibility:

| Level | Meaning |
|-------|---------|
| **Indexed + images** | Searchable by name; images viewable online |
| **Browse-only images** | Online but must be browsed without name index |
| **Microfilm** | Available on film at FHL or through interlibrary loan |
| **Physical only** | Must visit or write to the holding repository |
| **Destroyed/lost** | No longer extant; note substitute sources |

## Locality Survey Methodology

A locality survey identifies what genealogical records exist for a
specific place and time period, where those records are held, and how
to access them. It is the foundational step before creating a research
plan for any new jurisdiction.

### Why a locality survey matters

Researchers who skip this step tend to search only the most familiar
online databases and miss entire categories of records. The GPS
requires reasonably exhaustive research, which means consulting all
source types that could contain relevant evidence — not just the
ones that are easiest to find online.

A negative result in an online database does not mean the record does
not exist. It may mean:
- The record has not been digitized
- The record has been digitized but not indexed
- The record is indexed under a variant spelling or different name
- The record is held only in a physical repository

### Survey steps

#### 1. Establish jurisdictional history

Determine what governmental unit had authority over the place at the
time of interest. Jurisdictions change: counties are created from
parent counties, parishes are split, boundaries shift, towns are
annexed. Records follow the jurisdiction that created them, not
modern boundaries. Always identify:

- The county, parish, or district that existed at the event date
- When that jurisdiction was formed and from what parent jurisdiction
- Any boundary changes that might place the location in a different
  jurisdiction at different times
- The civil jurisdictional hierarchy (town → county → state → country)
- The **religious** jurisdictional hierarchy, which runs in parallel and
  often does not align with the civil one: parish → diocese → archdiocese
  for episcopal churches, with denominational equivalents (e.g.
  congregation → presbytery → synod; local church → circuit → conference).
  Where the church kept the vital records — as it did nearly everywhere
  before civil registration — the parish, not the town, is the jurisdiction
  that holds them, and the civil chain will not lead to them.

#### 2. Identify record types created in that jurisdiction

Different governments, churches, and organizations created different
types of records at different times. For each jurisdiction and time
period, determine which of these categories may apply:

- **Civil vital records** — births, marriages, deaths. Take the start
  date, and the level it applies to, from the
  `{Jurisdiction}_Vital_Records` page; it varies widely by jurisdiction
  and by level within one.
- **Church records** — baptisms, marriages, burials, and
  **confirmations** (which can fall years after the christening and are a
  separate dated event). Often predate civil registration. Identify
  denominations present in the area. The parish also kept records of the
  **poor** — relief lists, parish workhouses, and church-sponsored
  hospitals — which name people who surface in no other church series.
- **Census records** — national, regional, colonial, or ecclesiastical
  enumerations; which of these a jurisdiction ran, and for which years,
  comes from its `{Jurisdiction}_Census` page.
- **Probate records** — wills, administrations, guardianships,
  inventories, estate distributions.
- **Land records** — deeds, grants, patents, tax lists, land entries.
- **Court records** — civil suits, criminal cases, naturalizations,
  name changes, and **county assessments recorded in the court minute
  books**. County business was transacted in the same minutes and names
  ordinary people who were never party to a suit: who was responsible for
  maintaining which section of road, who received payment as a local
  indigent resident, and who provided that payment.
- **Military records** — service records, pension files, draft
  registrations, unit rosters.
- **Cemetery records** — headstone inscriptions, sexton records,
  burial registers.
- **Newspaper records** — obituaries, marriage notices, legal notices,
  community news.
- **Immigration/emigration records** — passenger lists, border
  crossings, passport applications.
- **Tax records** — property tax, poll tax, personal property.
- **School records** — enrollment, attendance, yearbooks.
- **Institutional records** — hospital, asylum, orphanage, prison.
- **Town and county histories** — published local histories (often
  19th- to early-20th-century) that reprint early records, list founding
  families, and carry biographical sketches; frequently the only
  surviving transcription of records since lost.

#### 3. Locate repositories holding those records

For each record type, determine where the records are held:

- **Online digital repositories** — FamilySearch, Ancestry, FindMyPast,
  MyHeritage, state digital archives, specialized databases
- **National archives** — NARA (US), The National Archives (UK),
  national equivalents elsewhere
- **State/provincial archives** — state archives, state libraries,
  state historical societies
- **County/local repositories** — courthouses, county clerk offices,
  register of deeds, local historical societies, local libraries
- **Church archives** — diocesan archives, denominational headquarters,
  local parish offices
- **University libraries and special collections**

#### 4. Assess digitization and indexing status

For each record set, determine its accessibility level:

| Level | What it means | Implication |
|-------|---------------|-------------|
| Indexed + images online | Searchable by name, images viewable | Most accessible; search directly |
| Browse-only images online | Images available but not name-searchable | Must browse page by page or use finding aids |
| Microfilm available | Filmed but not digitized | Order film or visit a repository with a reader |
| Physical only | Exists only in the original repository | Requires in-person visit or correspondence |
| Destroyed or lost | No longer extant | Note the loss and identify substitute sources |

#### 5. Identify substitute and complementary sources

When primary records are unavailable (destroyed, never created, not
yet accessible), identify alternatives:

- Church records substitute for missing civil vital records
- Tax lists substitute for missing census records
- Probate records reveal family relationships when vital records are absent
- Newspaper notices capture events not recorded elsewhere
- DNA evidence supplements documentary gaps
- City directories place a person at a specific address in the years
  between censuses — for the cities that have them
- A regional or local enumeration places a person in the off-years
  between the national censuses — for the jurisdictions that took one;
  both a city directory and an off-year enumeration earn their place when
  the person cannot be found in the national census at all. Which
  enumerations a jurisdiction ran, and for which years, comes from its
  `{Jurisdiction}_Census` page

### Common pitfalls

- **Assuming online = everything.** Major databases contain a fraction
  of all existing records. Many records have never been microfilmed
  or digitized.
- **Ignoring jurisdictional changes.** Searching the wrong county
  because modern boundaries differ from historical ones.
- **Stopping at vital records and census.** These are starting points,
  not the full picture. Thorough research requires exploring many
  record types.
- **Treating an index as the record.** An index entry is a pointer.
  The original record may contain additional information not captured
  in the index.
- **Assuming consistent record-keeping.** Record-keeping practices
  varied by time period, jurisdiction, and individual clerk. Some
  periods have rich records; others have almost none.

## Reference Source Types for Locality Research

Reference sources provide information about places, time periods, and
record types. They do NOT contain information about specific
individuals. Instead, they tell the researcher what records were
created, when and where, and how to find them.

### Categories of reference sources

#### Atlases and historical maps

Collections of maps showing political boundaries, geographic features,
and place names at specific dates. Essential for resolving
jurisdictional questions.

**Use when:** You need to determine which county or parish a town
belonged to at a given date, trace boundary changes over time, or
understand geographic relationships between places.

**Examples:** Historical county boundary maps, migration route maps,
Newberry Library atlas collections, David Rumsey Map Collection.

#### Gazetteers

Geographic dictionaries listing place names with descriptions of
location, jurisdiction, and sometimes population or historical notes.

**Use when:** You need to identify a place name, determine its
jurisdiction, find variant spellings, or verify that a place existed
at a given date.

**Examples:** GNIS (Geographic Names Information System) for US places,
Meyers Orts- und Verkehrs-Lexikon for German places, FamilySearch
place authority.

#### Research handbooks and guides

Procedural guides for researching in specific countries, states, or
record types. They explain what records exist, when they begin, where
they are held, and how to use them.

**Use when:** You are unfamiliar with records for a particular
jurisdiction or need to understand how a specific record type works.

**Examples:** FamilySearch Research Wiki locality pages, Ancestry
Research Guides, published state research guides (e.g., "Research in
[State]" series).

#### Finding aids

Descriptive guides to the contents of archival collections. They
explain what records are in a collection, how they are organized,
what time periods and locations they cover, and any access
restrictions.

**Use when:** You have identified a promising archival collection and
need to understand what it contains before requesting or visiting.

**Examples:** NARA finding aids, state archive collection guides,
university special collection inventories, EAD (Encoded Archival
Description) finding aids online.

#### Registers

Official listings of events, persons, or organizations — often
compiled by governmental or ecclesiastical authorities.

**Use when:** You need to locate official event records or verify that
a register exists for a given jurisdiction and time period.

**Examples:** Parish registers, civil registration indexes, ship
passenger registers, military unit muster rolls.

#### Directories

Organized listings of people, businesses, organizations, or resources
within a geographic area or topic.

**Use when:** You need to locate an ancestor's address, occupation, or
presence in a particular city at a particular time; or you need to
find genealogical resources organized by locality.

**Examples:** City directories, business directories, Cyndi's List
(genealogical resource directory), Linkpendium (locality-organized
resource directory).

#### Bibliographies

Lists of published works on a subject, often annotated with
descriptions of scope and content.

**Use when:** You need to find all published works about a county's
history, a specific ethnic group's records, or a particular record
type.

**Examples:** P. William Filby's bibliographies, Genealogies in the
Library of Congress, state bibliographies of local history.

#### Almanacs and dictionaries

Annual compilations of facts, dates, and statistics; or reference
works defining terms, abbreviations, and concepts.

**Use when:** You need to verify a day-of-week for a date, understand
archaic terminology, interpret Latin phrases in church records, or
decode abbreviations.

**Examples:** Perpetual calendars, Latin glossaries for genealogists,
abbreviation guides for specific record types.

### Question-to-source mapping

| Research question | Reference source to consult |
|---|---|
| What records exist for this county/parish? | FamilySearch Wiki, state research guides, Red Book |
| What county was this town in during [year]? | Historical atlas, gazetteer, boundary-change maps |
| When did civil registration begin here? | Country/state research handbook |
| What is in this archival collection? | The collection's finding aid |
| What migration routes led to this area? | Historical route maps, migration pattern studies |
| What churches were present in this area? | Local history publications, FamilySearch Wiki, denominational archives |
| What does this term/abbreviation mean? | Specialized dictionaries, glossaries |
| What has been published about this locality? | Bibliographies, library catalogs (WorldCat, `catalog_search`) |
| Where are the original records held? | `catalog_search({ standardPlace: … })` — a hit's `repositoryCalls` names the archive; state archive guides |

## Broad Context Factors for Locality Research

Effective locality research requires understanding the historical,
social, economic, and legal context of the place and time period.
These contextual factors determine what records were created, what
information they contain, and where they are likely to be held.

This reference corresponds to the GPS principle that research planning
must consider boundaries, migration, and the full range of factors
that shape record creation and survival.

### Boundary and jurisdictional factors

- **County/parish formation dates** — Records begin when the
  jurisdiction was created. Earlier records are held by the parent
  jurisdiction.
- **Boundary changes** — A location may have been in different
  counties at different times. Records follow the jurisdiction that
  created them, not modern boundaries.
- **Political reorganization** — State/territory transitions, country
  border changes, colonial-era jurisdictional shifts all affect where
  records are held.
- **Record custody transfers** — When jurisdictions merge or dissolve,
  records may transfer to successor jurisdictions, state archives, or
  be lost entirely.

### Migration factors

- **Settlement patterns** — When and from where did the population
  arrive? This determines ethnic composition, church denominations,
  and language of records.
- **Migration routes** — Rivers, roads, canals, and railroads shaped
  migration. Knowing the route helps identify records created along
  the way.
- **Push/pull factors** — Economic opportunity, religious freedom,
  land availability, famine, war, and persecution drove migration
  and shaped communities.
- **Chain migration** — Families and communities often migrated
  together. Records of associates and neighbors may contain clues
  about your research subject.

### Economic factors

- **Dominant industries** — Agriculture, mining, manufacturing, trade,
  and maritime industries each generate distinctive record types
  (land records, mine employment rolls, factory records, port records).
- **Land distribution systems** — State-land states vs. federal-land
  states (US); manorial systems, enclosure acts (Europe); homestead
  laws, land grants, land bounties, and patents each create different record sets.
- **Economic disruptions** — Depressions, crop failures, and industry
  collapses drove migration and appear in court records, tax
  delinquency lists, and poor relief records.

### Ethnic, linguistic, and religious factors

- **Language of records** — Records may be in languages other than
  the modern dominant language (Latin church records, German colonial
  records, Spanish mission records).
- **Naming conventions** — Patronymic systems, anglicization of
  immigrant names, and use of middle names all affect how people appear
  in records. Do not assume a woman took her husband's surname at
  marriage: where she kept her birth surname, searching the married name
  for those years finds nothing. Read the jurisdiction's
  `{Country}_Naming_Customs` page for its own practice rather than
  assuming either convention.
- **Religious record-keeping** — Different denominations kept different
  records at different levels of detail. Some denominations have
  centralized archives; others have records scattered across local
  congregations.
- **Ethnic enclaves** — Immigrant communities often maintained parallel
  institutional structures (churches, newspapers, mutual aid societies)
  that created records in the heritage language.

### Legal and governmental factors

- **Civil registration dates** — When did the government begin
  requiring registration of births, marriages, and deaths? This
  varies enormously by jurisdiction.
- **Probate and inheritance law** — Different legal traditions
  (common law, civil law, community property) generate different
  probate records and affect inheritance patterns.
- **Naturalization requirements** — Changes in naturalization law
  affect what records were created, where declarations were filed,
  and what information they contain.
- **Military conscription and service** — Draft laws, militia
  requirements, and wars generate service records, pension files,
  bounty land warrants, and veterans' census schedules.
- **Tax systems** — Property tax, poll tax, and income tax records
  vary by jurisdiction and time period. They can substitute for
  census records when those are unavailable.

### Record survival factors

- **Courthouse fires and disasters** — Many courthouses have burned,
  sometimes destroying all records. Document known record losses for
  the jurisdiction.
- **War damage** — Military conflicts destroy records. Civil wars,
  invasions, and occupations are particularly damaging.
- **Deliberate destruction** — Some records were intentionally
  destroyed (e.g., privacy laws mandating destruction of old records,
  wartime destruction of sensitive documents).
- **Preservation efforts** — WPA projects, Daughters of the American
  Revolution transcription campaigns, church microfilming programs,
  and genealogical society indexing projects have preserved records
  that might otherwise have been lost.
- **Climate and storage** — Records stored in damp basements,
  unheated attics, or flood-prone areas may be damaged or illegible.

### Topical breadth checklist

A thorough locality guide should consider sources related to:

- [ ] Agriculture and land use
- [ ] Demographics and population patterns
- [ ] DNA and genetic genealogy resources
- [ ] Economic conditions and occupations
- [ ] Ethnic and cultural communities
- [ ] Geography and physical landscape
- [ ] Government structure and administration
- [ ] History and significant events
- [ ] Inheritance customs and probate law
- [ ] Land ownership and transfer systems
- [ ] Legal framework and court systems
- [ ] Migration patterns and routes
- [ ] Military activity and conflicts
- [ ] Occupational records and guilds
- [ ] Religious institutions and denominations
- [ ] Social customs, norms, and organizations

## Return contract

The guide you presented in Step 5 is the caller-facing half of the return:
return it in full, then the lines below. Inside a research project, add one
line naming the `loc_` id written or updated. When a decision rule hands back,
name the owner there.

### `summary_for_user`

After the guide, write a line containing only `---`, then exactly two
paragraphs of plain prose with **no label, heading or field name**:

1. One paragraph for someone who has never done genealogy: which place and
   years were surveyed, which kinds of old records survive there and where they
   are kept, and the one or two warnings that matter most (a split county, a
   town that kept its own records, records only on paper in an archive). No
   identifiers, file names, tool names or field names.
2. One sentence: what happens next, in plain language.

No closing essay.
