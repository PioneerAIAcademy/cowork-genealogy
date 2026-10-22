# Specification: Locality Guide Agent

The implementation is `packages/engine/plugin/agents/locality-guide.md`. That body
carries the instructions; this file carries the reference material behind them.

## Why the methodology lives here

The agent's reference prose lives here rather than in the body: every line of an agent
body is a billed prompt token on every invocation, and the reference sections below
were general genealogical background the model does not need restated to follow the
steps. What stayed in the body, as **Record-type reminders**, are the rules a
genealogist corrected after the August 2026 alpha reviews and that the model does not apply
unprompted:

- religious jurisdiction hierarchy beside the civil one
- confirmations and parish poor/workhouse/hospital records
- county road and indigent-relief assessments in court minute books
- no assumed surname change at marriage; read `{Country}_Naming_Customs`
- town and county histories; city directories and off-year enumerations as substitutes

The template's inland-immigration rule and land-distribution field stay in
the body's output format.

## Guide scope

The guide is scoped to the question: jurisdiction overview, boundary
changes, repository guide, records not online, known record losses and research tips in
full, plus each record-type subsection the delegation names and each record type that
substitutes for a named one missing for the period; every other record type gets one line
(what exists, its level, where held). Research tips are capped at six bullets and the
repository tables list only repositories holding the record types written in full. A
request naming no record type gets every section in full.

The substitute clause exists because naming alone drops what a genealogist relies on: for
County Antrim in the 1820s a baptism question names church records, but the tithe books and
Griffith's Valuation (land records) are the standard stand-in for the destroyed census
returns. Measured on two hosted guides (2026-10-07 Antrim, 24.7k characters; 2026-10-15
Freeborn County, 25.2k), one-lining the unnamed record types alone cut 30-33%; research
tips (3.6-4.6k) and the repository tables were the largest remaining sections.

## Wiki outages

`wiki_place_page` returns `No wiki page found` on a 404 and throws an error naming
`wiki-query-api` on a 5xx or an unreachable server (`src/tools/wiki-place-page.ts`).
`pages_read[].found` is a boolean, so an outage is persisted as `found: false`, the same as
a real 404. The agent retries once, then records the outage in the guide, in a `quirks[]`
entry and in `summary_for_user`. Measured on the e2e corpus 2026-10-22:
about 36 of 156 persisted `found: false` sections came from runs where the wiki server was
unreachable.

---

# Methodology reference (moved from the agent body)

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
| Where are the original records held? | The jurisdiction's wiki pages (constructed-URL `wiki_read`), state archive guides; `catalog_search` shows where FamilySearch's copy can be seen |

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
