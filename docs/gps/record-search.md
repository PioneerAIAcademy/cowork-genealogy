# FamilySearch.org Records Search — Technical Reference for an AI Genealogy Agent

**Version date:** May 2026 — interface as of 2025–2026.
**Scope:** This document covers ONLY the indexed Records search at `https://www.familysearch.org/search/` (global form) and the per-collection search forms at `/search/collection/{collectionId}`. It does NOT cover Full-Text Search, Catalog search, Images browse, Family Tree person search, or Genealogies. The agent is assumed to consult separate references for those.

**Source quality note:** Where behavior is in FamilySearch's official Help Center, Blog, or Developer Docs, that is stated. Where behavior is community-observed (forums, third-party blogs) and not officially documented, that is flagged. Where behavior is inferred or uncertain, that is flagged. FamilySearch's own developer guide warns that website URLs other than ARK URLs and a small approved list "are not formally supported" and "could change at any given time" — the URL-parameter techniques in §6 are de-facto, community-verified, not guaranteed-stable.

---

## 1. Architecture of the Search Surface

There are three distinct entry points the agent will use, and they behave differently:

| Entry point | URL | Behavior |
|---|---|---|
| Global Records search | `/search/` (form) → `/search/record/results?…` | Searches across all indexed collections at once. Fields are generic (any place, any date, name, relationships). |
| Collection-specific search form | `/search/collection/{collectionId}` | Renders a form whose fields are tailored to that collection's indexed metadata (e.g., the 1940 US Census form exposes residence, race, and 1935-residence fields; a Mexican civil-registration form exposes parents' names by default). On submit, redirects to `/search/record/results?…&f.collectionId={id}`. |
| Search Records from a Family Tree person | Person page → "Search Records" panel → click "FamilySearch" | Auto-populates the search form with the tree person's name, sex, birth/marriage/death/residence events, and parent/spouse names, then runs `/search/record/results?…&treeref={PID}`. The `treeref` parameter associates the search session with the tree person for downstream Source Linker attachment. |

All three ultimately pivot to the same `/search/record/results` page with the same query-parameter vocabulary documented in §6.

The global form has these collapsible sections (top to bottom):
- **Deceased ancestor's name** — First Names, Last Names. (FamilySearch Help: "Search for deceased people who were alive in 1950 or earlier" — living people are excluded from indexed records search by policy.)
- **Add Life Event** — buttons for Birthplace, Marriage, Residence, Death (each opens Place + Year/Year Range fields). An additional "Any" event exists in the URL parameters (`q.anyPlace`, `q.anyDate.from/to`) but is exposed in the UI only via the unified default Place + Year fields on the simple form.
- **Add Family Member** — buttons for Spouse, Father, Mother, Other Person (each opens First Names + Last Names; Spouse adds an optional marriage place/date).
- **Search with a Relationship** — same as Add Family Member; included in the same panel.
- **More Options** — opens **Sex**, **Type** (record-type filter), **Batch Number**, and **Image Group Number / Film Number (DGS)** fields, plus **Show Exact Search** toggle.
- **Find a Collection** — type-ahead lookup of collection title; click sends the agent to `/search/collection/{id}`.
- **Search by Place** — type-ahead place picker; click sends the agent to a place landing page that lists collections, learning resources, and indexing projects for that place.

When **Show Exact Search** is toggled on, a checkbox appears next to every name, place, and year field. Each checkbox is independent; the agent may exact-match the surname while leaving the given name fuzzy, etc.

### Collection-specific form differences (key examples)

- **United States Federal Censuses (e.g., 1940, collection ID 2000219):** adds Residence Place, Residence Year (locked to the census year), Sex, Race, Marital Status, and (for 1940) the "1935 Residence" field. Father's/Mother's birthplace fields are present even though most census records do not capture them; matches are best-effort.
- **English parish registers (e.g., "England Births and Christenings, 1538–1975"):** simplified to Given Name, Surname, Event Place (parish-level), Event Year, Father, Mother. No spouse, no death.
- **Mexico civil registration collections (e.g., "Mexico, Distrito Federal, Civil Registration, 1832–2005"):** exposes Padre (Father) and Madre (Mother) name fields by default and accepts dual surnames. Some recent indexes are produced by Computer-Aided Indexing (CAI) and carry a "This record was indexed by a computer" notice — those indexes have a higher rate of OCR-style errors and benefit from wildcards.
- **Immigration/Naturalization (e.g., Ellis Island Passenger Lists hosted at FamilySearch):** **Wildcards are explicitly disabled** in Ellis Island collections (FamilySearch Help Center, "Search Instructions for Historical Records": "Note: Wildcard searches will not work with Ellis Island collections."). Use spelling variants instead.

---

## 2. Name Search Mechanics

### Wildcards

Authoritative source: FamilySearch Blog, "Searching with Wildcards in FamilySearch" (by Steve Anderson; submitted by Phil Dunn and Susan Burleson; published 2014-04-10, last modified 2022-07-31).

| Wildcard | Meaning | Behavior |
|---|---|---|
| `*` | Zero or more characters | "You can use up to **four asterisks** at a time for any surname or given name." |
| `?` | Exactly one character | Multiple `?` may appear in the same field. |

**Rules:**
- Minimum 3 non-wildcard letters per name field: "To use a wildcard symbol in your search, in most cases, you must use at least 3 letters of the surname or given name."
- `*` is allowed at the **start, middle, or end** of the name. The blog gives the explicit example: "for the surname Thibou, type `*bou`." Older third-party documentation (Family Tree Magazine 2014) said `*` had to be terminal; that restriction has been lifted.
- `?` may be used at any position (e.g., `Sm?th` → Smith, Smyth, Smeth).
- Wildcards interact with exact-match: if the agent enables Exact on a field that contains wildcards, FamilySearch still expands the wildcard but does NOT additionally apply name-variant interpretation to the matches.
- Wildcards are NOT supported in Ellis Island collections.
- For **place** fields, wildcards work only in the smallest (innermost) jurisdiction level. `San*, Mexico` works; `San*, Me?ico` does not (FamilySearch Community/GetSatisfaction).

### Phonetic / variant matching (default fuzzy behavior)

When the agent does NOT enable Exact, FamilySearch applies what its docs call "algorithms to increase recall such as using spelling variants, nick-names, abbreviations, removal of diacritics and white space, etc." (Record Persona Search Resource, FamilySearch Developer Center). Concretely:

- **Diacritics are stripped:** "RENÉE Noëlle" matches "Renee Noelle" and even "Rene E No Elle" under exact mode (per docs).
- **Capitalization is ignored.**
- **Spaces and punctuation are ignored:** "MacDonald" = "Mac Donald"; "O'Hara" = "OHara"; "de la Vega" = "delaVega" (Robert Kehrer, RootsTech 2018).
- **Standardized given-name variants are auto-applied:** Wm → William, Margt → Margaret, Eliz → Elizabeth, Robt → Robert, Geo → George, Jno → John, Thos → Thomas. Common nicknames (Peggy ↔ Margaret, Polly ↔ Mary, Dick ↔ Richard, Jack ↔ John, Bill ↔ William) are also applied.
- **Spelling variants** are applied via internal phonetic and edit-distance rules (the exact algorithm is not published).
- **Soundex** is not exposed as a separate toggle on FamilySearch (unlike Ancestry); it's part of the default fuzzy match.

To **disable** all of this, check the Exact box for that field. With Exact enabled, only records whose indexed value (after stripping diacritics, spaces, capitalization) matches the typed value will return.

### Surname-only and given-name-only behavior

- **Surname only:** explicitly allowed. The Record Persona Search docs state: "Single term searches are not allowed unless the single term is surname." This is the recommended technique when the given name was indexed as "Baby," "Infant," or as initials (FamilySearch Blog, "Record Search Tips: Find Your Family").
- **Given name only:** not allowed as a standalone search; the system will require at least one other identifier (place, date, parent, spouse).
- **Initials:** The agent may type `J` or `J W` in the given-name field. Because the wildcard minimum is 3 letters, `J*` is rejected, but `J W` (a literal initialed name) works against records indexed with initials. To match initial-only records broadly, use `J?*` (which violates the 3-letter rule) — instead, use exact match on the initial as typed.
- **Single-letter names:** behave the same as initials.

### Middle names

FamilySearch treats the first-name field as a multi-token field. "Searching ignores the order of first names" if there is no second last name; with two surnames, surname order is preserved (Lisa Louise Cooke, "FamilySearch Search Strategy Essentials," 2021). Strategy: include the middle name when known, since some records index "John W. Smith" only as "John W" or "John William."

### Quoted phrases and Boolean operators

- **Quoted phrases:** required when a name value contains a space and the agent is using direct API URLs: `q.givenName="Sally Mae"`. On the website form, the agent simply types spaces; quotes are not needed.
- **Boolean AND/OR/NOT:** **NOT supported** in the indexed Records search. Lisa Louise Cooke confirms: "FamilySearch doesn't support Boolean Operators like Google does." (Boolean operators DO work in FamilySearch Memories search and Full-Text Search, which are out of scope here.)
- **Plus/minus operators (`+`, `-`):** NOT supported in indexed Records search (only in Full-Text Search).

---

## 3. Place Search Mechanics

### Standardized place hierarchy

When the agent types in a Place field, FamilySearch shows a type-ahead list of standardized places (the same vocabulary as FamilySearch Places). The agent **should always click the standardized version** rather than submitting free-text — this binds the search to the Place ID and enables hierarchy expansion.

If a non-standardized place is submitted, FamilySearch falls back to a string match against indexed place text, which is brittle.

### "Place exact" off vs. on (default fuzzy: 3 jurisdictional levels up)

Documented behavior (Record Persona Search Resource):

> "Place searches that are not specified as exact will search records within three jurisdiction levels of the place searched (e.g. searching for 'Lehi, Utah County, Utah, USA' will return records in Lehi, Utah County, and Utah; but not all of USA)."

Concretely:
- **Place exact OFF:** matches the typed place AND any narrower place inside it within 3 levels of jurisdiction. Entering "Utah County, Utah" finds Lehi, Provo, American Fork, etc.
- **Place exact ON:** matches only the typed place or any place inside its jurisdiction (no expansion upward). Entering "Utah County, Utah" finds Lehi, Provo, American Fork (still descends to children), but excludes records indexed as "Utah, USA" without a county.

This means: **exact place mode does NOT prevent matching child localities** — it prevents matching parent localities. To restrict to a single town, type the town and check exact.

### Multi-place / multiple events

Use the cardinality suffix to record multiple events of the same type: a person married in Colorado in 1920 and Nevada in 1940 →

```
q.marriagePlace=Colorado&q.marriageDate.from=1920&q.marriageDate.to=1920
&q.marriagePlace.1=Nevada&q.marriageDate.1=1940
```

(FamilySearch Developer docs, "Family Tree Search Guide.")

---

## 4. Date and Year-Range Mechanics

- **Default fuzzy range when "exact year" is not enabled:** FamilySearch documentation does not publish a fixed numeric tolerance. Empirically, a single year value with exact OFF will match indexed dates within roughly ±2 years for Birth, Marriage, Death and ±5 years for "Any"/Residence; this is observed behavior and not officially specified. Where the agent needs deterministic behavior, **always enter a year range** (`q.birthLikeDate.from=1850&q.birthLikeDate.to=1860`) rather than a single year.
- **Exact year:** added to the public form in 2025 (FamilySearch Blog, "You Can Now Use an Exact Year in Your Historical Records Search," published 2025-07-01). Per that post: "Currently, the exact year search is available only when you are using a desktop browser. It will soon be added to the Family Tree mobile app as well." When the year-exact checkbox is on, only records indexed with that exact year match; if a record has no year, it is excluded.
- **Date granularity:** the index honors **year only** at search time. "Currently only the year of the date is honored when searching terms" (Family Tree Search Guide). Submitting day-month-year is accepted but day and month are discarded for matching.
- **Date ranges are inclusive** on both ends (`from=1920&to=1925` includes 1920 and 1925).

### Event types

The Life Event picker has buttons for **Birth**, **Marriage**, **Residence**, **Death**, and (via direct URL) **Any**.

- **Birth** and **Death** are "BirthLike" / "DeathLike" — they include closely related events: Birth includes christening/baptism/naming; Death includes burial/cremation.
- **Marriage** includes engagement and license/banns events.
- **Residence** matches census, directory, tax, and land residence facts.
- **Any** matches against ALL event types in the index; useful when the date is known but the event type is uncertain (e.g., immigrant arrival year).

When the agent specifies an event-typed date+place pair, FamilySearch requires both to match the same event for a hit. To search for "any record with this date in this place regardless of event type," use Any.

---

## 5. Relationship Search

### Adding relatives

The form supports **Spouse, Father, Mother, Other Person**. URL parameters:

- Spouse: `q.spouseGivenName`, `q.spouseSurname`, `q.marriageLikeDate(.from/.to)`, `q.marriageLikePlace`
- Father: `q.fatherGivenName`, `q.fatherSurname`, `q.fatherBirthLikePlace`
- Mother: `q.motherGivenName`, `q.motherSurname`, `q.motherBirthLikePlace`
- Generic parent (sex unknown): `q.parentGivenName`, `q.parentSurname`, `q.parentBirthLikePlace`
- "Other Person" in the UI maps to either parent or spouse parameters depending on context.

Each name field independently supports wildcards and the Exact checkbox.

### Relationship narrowing behavior

- A relationship name is treated as a **soft constraint with require=on for surname when supplied** (per the API docs: "[require] is automatically applied to surname field when surname is supplied but not excluded"). Name variants and standardization apply.
- When only the relative's given name is filled (e.g., a husband called "Frank" with unknown surname), FamilySearch returns broader results. This is useful for finding women whose maiden names are unknown.
- When a relative has multiple values across records (e.g., a person with two spouses), use cardinality (`.1`, `.2`, …, `.9`) to bundle each spouse's name with that spouse's marriage date/place.

---

## 6. URL Parameter Reference (Power-User Interface)

Base URL: `https://www.familysearch.org/search/record/results`

### Query parameters (`q.*`) — fuzzy by default

| Parameter | Meaning |
|---|---|
| `q.givenName` | Given name(s) |
| `q.surname` | Surname; auto-required when supplied |
| `q.sex` | `Male` or `Female` |
| `q.birthLikePlace` / `q.birthLikeDate.from` / `q.birthLikeDate.to` | Birth-or-christening event |
| `q.deathLikePlace` / `q.deathLikeDate.from` / `q.deathLikeDate.to` | Death-or-burial event |
| `q.marriageLikePlace` / `q.marriageLikeDate.from` / `q.marriageLikeDate.to` | Marriage event |
| `q.residencePlace` / `q.residenceDate.from` / `q.residenceDate.to` | Residence/census event |
| `q.anyPlace` / `q.anyDate.from` / `q.anyDate.to` | Any event (website-only; verified live) |
| `q.fatherGivenName` / `q.fatherSurname` / `q.fatherBirthLikePlace` | Father (sex=Male) |
| `q.motherGivenName` / `q.motherSurname` / `q.motherBirthLikePlace` | Mother (sex=Female) |
| `q.parentGivenName` / `q.parentSurname` / `q.parentBirthLikePlace` | Parent (sex unknown) |
| `q.spouseGivenName` / `q.spouseSurname` | Spouse |
| `q.batchNumber` | IGI/extraction batch number — verified live |
| `treeref` | Family Tree PID; binds search context to a tree person |

**Modifiers** (only valid value is `on`):
- `.exact=on` — disable fuzzy match (names and places only)
- `.require=on` — term must be present in matched record
- `.from=YYYY`, `.to=YYYY` — range bounds (dates only)

**Cardinality** (`.1` through `.9`): repeats a term group for distinct events of the same type; cardinality must match across grouped fields (e.g., `q.spouseGivenName.2` must group with `q.spouseSurname.2` and `q.marriageDate.2`).

### Filter parameters (`f.*`) — strict, no fuzziness

| Parameter | Meaning |
|---|---|
| `f.collectionId={id}` | Restrict to one or more collections (repeatable) |
| `f.birthLikePlace0/1/2`, `f.deathLikePlace0/1/2`, `f.marriagePlaceLevel0/1/2` | Place jurisdictional levels |
| `f.eventPlaceLevel0` … `f.eventPlaceLevel5` | Event place levels |
| `f.birthYear0` / `f.birthYear1`, `f.deathYear0/1`, `f.marriageYear0/1` | Year range bounds |
| `f.gender`, `f.maritalStatus` | |
| `f.surnameStandard`, `f.givenNameStandard`, `f.fatherSurnameStandard`, etc. | Standardized name forms |

Place filter values use standardized format `{parent_place_id},{place_name}` — e.g., `f.birthLikePlace1=3,Alberta` (the place_id of Canada is 3). The agent should obtain place_ids from FamilySearch Places (`/research/places/?focusedId={id}`) when programmatically constructing filter URLs.

### Pagination and result shape

| Parameter | Behavior |
|---|---|
| `count={n}` | Results per page; valid 1–100 (default 20). UI also offers 10/20/50/100. |
| `offset={n}` | Zero-based; documented for the API at 0–4999. Public URL pagination renders via `<`/`>` buttons; `offset=` may pass through but is not a documented public URL contract. |
| `start={n}` | Used in the Tree Person Search pagination links. |

**Hard cap:** the search returns at most the first 5,000 results. `offset > 5000` returns 400. If a search has more than 5,000 hits, the agent must add filters to narrow.

### Confirmed-NOT-working / NOT-documented

- `treq=` — appears in older mailing-list discussions but is not documented anywhere current; treat as unsupported.
- `q.recordType` — not verified as a working public-URL parameter. The "Type" filter in the UI appears to operate via `f.collectionId` selections (multi-select against pre-bucketed collections), not a record-type query token.
- `q.otherGivenName` / `q.otherSurname` — not in the API; use `q.parentGivenName/Surname` for non-gendered parents, or `q.spouseGivenName/Surname` for spouses.
- `f.recordType`, `f.collectionPlace1`, `f.collectionPlace2` — no documentation found.

### URL pattern reference

```
Global search:           https://www.familysearch.org/search/record/results?{q.*&f.*&count&offset}
Single-collection form:  https://www.familysearch.org/search/collection/{collectionId}
Single-collection search: same as global, with f.collectionId={collectionId}
Catalog entry (NOT a search): https://www.familysearch.org/search/catalog/{catalogId}
Image waypoint browse:   https://www.familysearch.org/search/image/index?owc={waypoint URL}
Place browse:            https://www.familysearch.org/research/places/?focusedId={placeId}
Search from tree person: …/search/record/results?…&treeref={PID}
```

---

## 7. Filters, Facets, Post-Search Refinement

After running a search, the results page exposes filter "bubbles" / facets along the top and a Refine Search panel on the right. Filters available (Family Tree Magazine, "Searching Records on FamilySearch"):

- **Collection** — multi-select against the collections that produced any of the result hits. Collection facet counts are returned and are the recommended primary narrowing tool.
- **Sex** — Male/Female/Unknown.
- **Race** — populated only for collections that index race (US slave schedules, US censuses 1850–1940, some draft registers). Values like `W`, `B`, `M` carried verbatim from indexed data.
- **Birth, Marriage, Death, Other [Event], Residence** — each opens a Place + Year Range sub-panel.

Sort is **NOT user-configurable** in the public UI as of 2025–2026 — results are returned in relevance order. (FamilySearch Community confirms users must export to a spreadsheet to sort.) The agent should rely on filters (collection, place, year, event type) for narrowing rather than sorting.

A **Preferences** button (top-right of results) toggles between Fixed Table and Data Sheet layouts and exposes an **Export Results** option (XLS/XLSX/ODS/TSV) — this exports only the currently visible page (count up to 100). For programmatic harvesting, paginate with `count=100&offset=…`.

### Collection facet — preferred narrowing tool

When a global search returns hundreds or thousands of hits, the most efficient narrowing is the Collection facet (left/right rail). The agent should:
1. Execute the broad search with name + place + year-range only.
2. Inspect the Collection facet to see which collections returned hits.
3. Click the most relevant collection (e.g., "United States Census, 1900") to add `f.collectionId={id}` to the URL.
4. Inspect the within-collection results, which are typically <50 hits.

### Type / Collection-Type taxonomy

The `/search/collection/list` Browse-All-Collections page exposes the canonical 15-bucket Collection Type facet (verbatim labels):

```
Birth, Marriage, & Death
Censuses & Lists
Church Record
Compiled Genealogies
Directories
Ethnicity
Genealogical Record
Government Record
Migration & Naturalization
Military
Miscellaneous
Newspapers
Other
Probate & Court
Story
```

The on-form **Type** picker in More Options uses an event-oriented re-grouping of these (e.g., "Birth, Baptism, Christening" — verbatim from Help Center "Find birth records on FamilySearch"). The exact dropdown contents are rendered client-side and the agent should read them from the live UI rather than hard-coding.

### Batch number and film/DGS number fields

- **Batch number** (`q.batchNumber=`) accepts IGI batch identifiers like `C050761`, `M127004-1`. Per the FamilySearch Wiki, batch numbers must be exactly **6 digits after the letter prefix** to work reliably; left-pad with zeros if needed. Many batches still don't resolve (FamilySearch Blog, "Fixing Problems with the Batch Number Search"). Use Hugh Wallis's index (`https://freepages.rootsweb.com/~hughwallis/genealogy/IGIBatchNumbers.htm`) to find the batch number for a parish; submitting batch number alone (no name) returns all extracted records in alphabetical order — the canonical way to enumerate every christening or marriage from a single parish in the IGI.
- **Image Group Number / DGS / Film number** — entered in the **More Options → Film/Fiche/Image Group Number** field. This searches for indexed records that point to that microfilm/digital folder. Useful for finding adjacent records on the same film when the agent has located one record and wants to see its film mates.

---

## 8. Indexing-Quality Quirks (by Major Collection)

| Collection family | Quirk | Compensation |
|---|---|---|
| US Federal Censuses 1790–1940 | Indexed by community; mostly accurate but transcription errors are common, especially with cursive handwriting (S/L, F/T, n/u, U/V confusions; double-S misread as F or "long s"). | Use surname wildcards; search by neighbors; use Stephen P. Morse's Enumeration District tools for unindexed areas. |
| England parish registers (IGI Community Indexed) | Pre-1837 parish records were extracted decades ago — the indexes are static "Legacy" collections (no updates, no corrections post-2010 publication). | Search by IGI batch number to enumerate the parish exhaustively; use FreeREG and FindMyPast to cross-check. |
| Mexico Civil Registration | Many post-2020 indexes are produced by Computer-Aided Indexing (CAI). Each carries the "This record was indexed by a computer" notice. CAI yields more OCR-style errors than human indexing, especially with accented characters and joined cursive. | Use wildcards generously; use double-surname searching (`q.surname=Lopez Garcia`); search by parents' names rather than the principal. |
| Mexico Catholic Church records | Sometimes indexed without parents' names because the indexer was given a partial template. | Drop the principal's name and search by Padre + Madre. |
| Ellis Island Passenger Lists (hosted at FamilySearch) | Wildcards are explicitly disabled. | Try multiple specific spellings; search by ship name + arrival year; use the Stephen Morse one-step Ellis Island search externally. |
| United States Social Security Death Index (SSDI) | Names may be indexed first-name-last-name without middle initial; some entries have only "Mrs." prefix. | Search by SSN if known; use exact birth and death dates. |
| German Lutheran/Catholic registers | Standardization of given names is incomplete (e.g., Johann Friedrich vs. Friedrich Johann); umlauts (ä/ö/ü) may be indexed as ae/oe/ue or stripped. | Use wildcards; try both "Friedrich Johann" and "Johann Friedrich"; try "Mueller" and "Müller" (both should work given diacritic stripping, but indexed text may also store the "ue" spelling). |

---

## 9. Common Indexing Error Patterns and How to Compensate

| Original handwriting | Common misreadings | Wildcard strategy |
|---|---|---|
| Capital `S` (cursive, looped) | `L`, `J`, `T` | Replace first letter: `?mith`, `?ones` |
| Capital `F` | `T`, `J`, `S` | `?inley` |
| Lowercase `n` | `u`, `v` | `Hu?ter`, `Pe??y` |
| Lowercase `u` | `n`, `v` | `Bru?n`, `Ba?er` |
| Long `s` (ſ) | `f`, `F` | `Wa?on`, `Bi?op` |
| Double `s` (ſs) | `fs`, `B`, `S` | `Ros?` |
| Lowercase `e` / `o` | each other | `Sm?th`, `H?lmes` |
| Lowercase `a` | `o`, `u`, `e` | `H?rt`, `J?nes` |
| `r` / `n` | each other | `Ba?ker` |
| `c` / `e` / `t` | each other | `Mi?hael` |
| `i` / `j` / `l` / `1` | each other | `?ohnson` |
| `h` / `k` | each other in some hands | `?ane` |

**Other patterns:**
- Indexes commonly **drop suffixes** (Jr., Sr., II, III) and **drop "the elder/younger"** clauses. Search the surname without the suffix.
- Indexes commonly **drop or normalize prefixes** (von, van, de, della, Mc/Mac). Try both with and without the prefix; try contracted (M' for Mc) and expanded forms.
- Indexes commonly **misorder Hispanic dual surnames**. "García López" may be indexed as surname=García, given="José López" or as a combined surname "García López." Try both `q.surname=García` and `q.surname=López`.
- **Female name conventions:** US records typically index married surname; Spanish-speaking and some Italian records preserve maiden surname; Quaker and some Scandinavian records use patronymics.
- **Given name standardization errors:** "Wm" → William (auto), but "Willm" or "Will'm" may not standardize; "Margt" → Margaret (auto), but "Margaretta" or "Marguerite" may not. Search both forms.

### Common nickname / diminutive equivalences

| Formal name | Common nicknames seen in records |
|---|---|
| Margaret | Peggy, Peg, Maggie, Meg, Madge, Greta, Rita |
| Mary | Polly, Molly, Mamie, May, Mim, Minnie |
| Elizabeth | Betty, Betsy, Beth, Liz, Lizzy, Eliza, Lisa, Bess |
| Sarah | Sally, Sadie |
| Catherine/Katherine | Kate, Kitty, Cathy, Katy, Trina |
| Charles | Chuck, Chas, Charlie, Carl |
| William | Will, Bill, Billy, Wm., Liam |
| Richard | Rick, Dick, Richie, Dickon |
| Robert | Rob, Bob, Robbie, Dob (archaic) |
| John | Jack, Johnny, Jno., Hans (German), Honza (Czech) |
| James | Jim, Jimmy, Jas., Jamie, Diego (Spanish) |
| Henry | Hank, Harry, Hal |
| Edward | Ed, Ted, Ned, Eddie |
| Francis | Frank, Frankie, Paco (Spanish), Pepe |
| Joseph | Joe, Jos., Pepe (Spanish) |
| Alexander | Alex, Sandy, Alec |

These are auto-applied in fuzzy search but the agent should still try the formal name explicitly when fuzzy match doesn't produce results, since auto-application can fail on partial standardizations.

---

## 10. Search Strategy Levers (Alternate-Search Catalog)

Each lever lists (a) how to manipulate it, (b) when to try it, (c) what stuck scenario it solves.

### Name levers

| Lever | How | When | Solves |
|---|---|---|---|
| Drop surname | Clear `q.surname`; keep `q.givenName` + place + date | Surname is heavily corrupted, foreign-language, or transliterated | "Baby Phillips" / single-name indexing; women whose married name is unknown |
| Drop given name | Clear `q.givenName`; keep `q.surname` + place + date | Given name was indexed as initials, a nickname, "Infant," or in another language | Finding siblings, parents, and unknown given-name entries |
| Drop both names | Use only event place + date + sex/age + relationship | Both names may be corrupted; only structural clues are stable | Tabular records (slave schedules, mortality schedules) where principal is identified by relation |
| Search by spouse | Put spouse's name in `q.givenName/surname`; add subject as `q.spouseGivenName/spouseSurname` | Subject's name is common; spouse's is unique | Finding marriage records; locating a couple in censuses |
| Search by parent | Empty principal name; fill `q.fatherGivenName/Surname` and/or `q.motherGivenName/Surname` | Looking for sibling sets; principal may have been "Baby" or stillborn | Identifying full sibling sets; finding children indexed as initials |
| Search by child | Search the child as principal with parent name set to subject | Subject's own records are scarce; child's are abundant | Tracking parents through children's life events |
| Wildcard surname | `q.surname=Sm*th` or `q.surname=*tnam` | Foreign transliteration, common indexing errors, married-name variants | Slavic, German, Italian surnames that morph between languages |
| Wildcard given name | `q.givenName=Joh*` or `Eli?abeth` | Diminutives, abbreviations, ambiguous handwriting | Wm/William, Margt/Margaret, Eliza/Elizabeth |
| Use initials only | Type `J W` literally in given-name field | Census or directory records often abbreviated | Records that index `J. W. Smith` rather than `John William Smith` |
| Replace name with sex+age+place+rel | Fill sex, residence-date+place, parent name | Name is unrecoverable | "Negro woman aged 30" census entries; foundling records |

### Place levers

| Lever | How | When | Solves |
|---|---|---|---|
| Broaden place (county→state→country) | Drop the smaller jurisdiction levels | No hits in the expected county | Boundary changes; ancestor crossed county lines mid-decade |
| Narrow place (state→county→town) | Add smaller levels | Too many hits; subject's town is known | Common-name disambiguation |
| Drop place | Clear all place fields | Subject migrated unexpectedly | Migrant ancestors; unknown immigration year |
| Switch event-place | Move place from Birth → Residence → Marriage → Any | Each event was in a different place | Tracking through life stages |

### Date levers

| Lever | How | When | Solves |
|---|---|---|---|
| Broaden range | Increase span to ±5 or ±10 years | Censuses, derived dates, or estimates | Age inflation/deflation in census records |
| Drop date | Clear date fields | Date is uncertain | Pre-1850 ancestors with no birth records |
| Switch event type | Move date from Birth → Residence → Death | Original event date was wrong type | Death searched as residence in census; immigrant arrival year as Any event |
| Switch single year to range | Replace `q.birthLikeDate=1850` with `…from=1848&…to=1852` | Default fuzzy tolerance is undocumented and may not behave as expected | Deterministic widening |
| Use Any event | URL: `q.anyDate.from=…&q.anyPlace=…` | Date is known but event type unknown | Immigrant arrival year; "in 1865 in Memphis" with no event |

### Filter levers

| Lever | How | When | Solves |
|---|---|---|---|
| Restrict to record type | Click Type filter or select specific Collection | Too many varied result types | Focus on a single record kind |
| Restrict to specific collection | Click Collection facet → adds `f.collectionId=…` | Strong match expected in one collection | Within-collection precision |
| Drop all filters, single strong identifier | Search by uncommon spouse name only, or batch number only | Brick wall; brute-force exhaustive | Finding records indexed under any spelling |

### Cluster / FAN club levers

| Lever | How | When | Solves |
|---|---|---|---|
| Search by neighbor | Search the next-door census family; examine adjacent images | Subject was missed by indexer or indexed badly | Finding the family on the same census page |
| Search collateral relatives | Use uncommon brother/cousin/in-law surnames | Subject's surname is too common | Hortense Frinzwilter trick: search the rare in-law instead |
| Use Other Person field | Add a known witness or bondsman | Marriage bonds, deeds | Deed/marriage clusters in same record set |
| Maiden vs married name | Run two parallel searches | Female ancestor across her lifetime | Capturing pre- and post-marriage records |

---

## 11. Strategy Framework for the Genealogical Proof Standard Workflow

The Genealogical Proof Standard requires "reasonably exhaustive research" (Board for Certification of Genealogists, *Genealogy Standards*, 2nd ed., revised, 2021). For the indexed Records search at FamilySearch, "reasonably exhaustive" means iterating across the levers in §10 in a documented sequence and recording **negative results** (search variations that returned no relevant hit) as well as positive ones.

### Broad-to-narrow vs. narrow-to-broad

- **Broad-to-narrow (preferred default):** Start with surname + place (state-level) + a wide year range. Use the Collection facet to identify which collections actually contain candidate hits. Then add filters (collection, narrower place, narrower date, sex). This is Robert Kehrer's recommended workflow. Per his RootsTech 2018 presentation as quoted in the FamilySearch Blog "Finding Elusive Records in FamilySearch, Part 1": "A good researcher tends to put in just a little bit of information, cast a broad net. Bring back some stuff. If they get too much, they can add a few more parameters and iterate on that search. We've given you a tool that lets you cast a broad net. Bring in a whole bunch of records, and then analyze that set of records in pieces." (Kehrer is identified there as senior product manager of search and hinting technologies at FamilySearch.) It also matches the FamilySearch help-center default advice ("Start with a broad search").
- **Narrow-to-broad (for known-record retrieval):** When the agent already has high-confidence facts (full name, exact birth date, exact place) and is searching for a specific record (e.g., "the 1900 census entry for John Smith of Erie County, PA"), start narrow with exact match on each field, then progressively relax fields when the search returns nothing.

### Decision rules for iteration

1. **Broad search returns >5,000 hits** → narrow by Collection facet first, then by place jurisdiction, then by adding spouse/parent.
2. **Search returns 100–5,000 hits** → use Collection and Sex facets; add parent name; consider exact place.
3. **Search returns 10–100 hits** → manually evaluate the top 20; look for image icons; click into highest-scored matches.
4. **Search returns 0 hits with reasonable inputs** → apply levers in this priority order:
   - (a) Broaden the year range to ±10.
   - (b) Drop the given name (search by surname + place + date).
   - (c) Drop the surname (search by given name + place + date + relationships).
   - (d) Wildcard the surname (`Sm?th`, `Sm*th`, `*ones`).
   - (e) Wildcard the given name.
   - (f) Switch event type (try Any).
   - (g) Broaden the place by one jurisdiction level.
   - (h) Drop the place entirely.
   - (i) Switch from principal to spouse / parent / child.
   - (j) Search by neighbor or FAN-club member.
5. **Still 0 hits across all variations** → the records may be unindexed. Switch to: (i) browse-by-image at `/search/collection/{id}` if known; (ii) Catalog search to find unindexed films; (iii) Full-Text Search (separate tool); (iv) external indexes (FreeREG, GenealogyBank).

### "Reasonably exhaustive" exit criteria for indexed Records search

A reasonable exhaustive Records-search effort for a single research question has been performed when:
- The agent has run searches for the principal under at least one wildcarded surname variant and one wildcarded given-name variant.
- The agent has run searches by at least one parent and at least one spouse (where applicable).
- The agent has searched at least the immediate jurisdiction (county/parish), the parent jurisdiction (state/country), and one neighboring jurisdiction.
- The agent has examined results from each Collection that returned matching hits.
- The agent has checked for image-only (browse) collections covering the same time and place via the Catalog.
- The agent has documented every search attempt (URL, parameters, hit count, top results) including searches that returned zero hits.

### Documentation format for the agent

Each search attempt should be recorded as a row with: (timestamp, full URL, q.* parameters, f.* parameters, hit count, top-3 result IDs, evaluation notes, attached/discarded). Negative searches (zero hits, or hits all evaluated as non-matches) are particularly valuable for the GPS — they constitute negative evidence.

### When to leave Records search

Switch to other tools when:
- All indexed sources for the place/time have been searched and yielded no match → switch to Catalog → Browse Images.
- A specific text content (a phrase, occupation, neighbor's name) is the only available hook → switch to Full-Text Search.
- The agent needs to assess the existing FT person record before searching → switch to Family Tree person search.

---

## 12. Worked Examples

### Example 1: US Census, common name, indexing-error scenario

**Question:** Find John W. Smith, born ~1855 in Pennsylvania, in the 1900 US Census; family knowledge says he lived in Erie County.

**Iteration 1 (broad):**
```
q.givenName=John W
q.surname=Smith
q.birthLikeDate.from=1853
q.birthLikeDate.to=1857
q.birthLikePlace=Pennsylvania
```
→ Tens of thousands of hits. Use Collection facet → click "United States Census, 1900" → adds `f.collectionId=1325221`.

**Iteration 2 (within-collection):**
Same as above with collection filter. Still hundreds of John Smiths in PA.

**Iteration 3 (add residence):**
Add `q.residencePlace=Erie, Pennsylvania, United States` and `q.residenceDate.from=1900&q.residenceDate.to=1900`. Down to ~20 hits.

**Iteration 4 (zero hits — try wildcards):**
If no matches, try `q.surname=Sm?th` (catches Smyth, Smeth) or `q.givenName=J*` (catches indexing as initials).

**Iteration 5 (try by spouse if known):**
If John's wife is known to be "Hortense":
```
q.givenName=Hortense
q.surname=Smith
q.spouseGivenName=John
q.residencePlace=Erie, Pennsylvania
```
→ Hortense as a unique name is the disambiguator.

**Iteration 6 (neighbor search if still no hit):**
Search for John's known brother "Eliphalet Smith" — same residence query. If found, examine adjacent images on the census page.

### Example 2: English parish register, IGI batch search

**Question:** Find the christening of James Pennington, born ~1755 in Culmstock, Devon, England.

**Iteration 1:**
```
q.givenName=James
q.surname=Pennington
q.birthLikePlace=Culmstock, Devon, England
q.birthLikePlace.exact=on
q.birthLikeDate.from=1750
q.birthLikeDate.to=1760
```
→ Returns matches in IGI Community Indexed records.

**Iteration 2 (enumerate parish via batch number):**
Identify the IGI batch for Culmstock births/christenings (`C050761` from Hugh Wallis's index). Then:
```
q.batchNumber=C050761
q.surname=Pennington
```
→ Returns ALL Pennington christenings in Culmstock 1608–1837. This is the canonical way to enumerate a family in a single parish.

**Iteration 3 (find siblings/parents):**
Same batch number, drop the surname:
```
q.batchNumber=C050761
q.fatherSurname=Pennington
```
→ Returns all children of any Pennington father christened in Culmstock; useful for assembling sibling sets.

### Example 3: Mexican civil registration, CAI-indexed quirks

**Question:** Find the birth record of María Guadalupe López García, born ~1895 in Guadalajara, Jalisco.

**Iteration 1:**
```
q.givenName=María Guadalupe
q.surname=López García
q.birthLikePlace=Guadalajara, Jalisco, México
q.birthLikeDate.from=1893
q.birthLikeDate.to=1897
```
→ May return zero hits because dual surname can be indexed as separate fields.

**Iteration 2 (try single surnames):**
Run twice — once with `q.surname=López`, once with `q.surname=García`.

**Iteration 3 (drop principal name; search by parents):**
If the parents are known (Juan López and María García):
```
q.fatherGivenName=Juan
q.fatherSurname=López
q.motherGivenName=María
q.motherSurname=García
q.birthLikePlace=Guadalajara, Jalisco, México
q.birthLikeDate.from=1893
q.birthLikeDate.to=1897
```
→ Returns all children of this couple in this place/time, allowing identification of María Guadalupe even if her own name is indexed badly.

**Iteration 4 (filter to civil registration collection):**
Use `f.collectionId=1827912` (Mexico, Jalisco, Civil Registration) to exclude church-record hits.

**Iteration 5 (CAI compensation):**
If the index shows "This record was indexed by a computer," wildcard generously: `q.fatherSurname=L*pez` (catches Lopes, Lopez with diacritic confusion).

### Example 4: Immigrant ancestor with unknown old-country town

**Question:** Find Patrick O'Reilly, immigrated to New York ~1850, age unknown, from Ireland.

**Iteration 1 (passenger arrival):**
```
q.givenName=Patrick
q.surname=O'Reilly
q.anyPlace=New York
q.anyDate.from=1848
q.anyDate.to=1852
```
→ Use Any event because immigration may be indexed as residence, arrival, or naturalization. Watch out: Ellis Island wildcards are disabled; this collection isn't Ellis Island per se but Castle Garden / NY Customs.

**Iteration 2 (surname variants):**
```
q.surname=O Reilly        (with space)
q.surname=O*Reilly
q.surname=Reilly
q.surname=Riley
q.surname=Reilley
```

**Iteration 3 (filter to migration):**
On results page, click Collection facet → filter to "New York Passenger Lists" or "United States, Naturalization Records."

**Iteration 4 (later-life record to triangulate origin):**
Drop the immigration question; find Patrick in 1860 or 1870 census:
```
q.givenName=Patrick
q.surname=O'Reilly
q.residencePlace=New York
q.residenceDate.from=1860
q.residenceDate.to=1860
```
→ Census gives place of birth field (often "Ireland"), then state/county of residence, which suggests where to look for marriage and church records.

**Iteration 5 (church record for hometown):**
Once a NY parish is identified, search FamilySearch's New York Catholic parish records by parish for Patrick's marriage record, which often names Irish parish of origin.

### Example 5: Female ancestor with unknown maiden name

**Question:** Find the maiden name of Mary, wife of John Brown, married before 1875 in Ohio.

**Iteration 1 (search marriage by groom):**
```
q.givenName=John
q.surname=Brown
q.marriageLikePlace=Ohio
q.marriageLikeDate.from=1865
q.marriageLikeDate.to=1875
q.spouseGivenName=Mary
```

**Iteration 2 (filter to marriage records):**
On results, use the Collection facet to select Ohio County Marriages.

**Iteration 3 (search Mary's death record):**
Mary's death certificate often lists father's name. Switch principal:
```
q.givenName=Mary
q.surname=Brown
q.deathLikePlace=Ohio
q.spouseGivenName=John
q.spouseSurname=Brown
```

**Iteration 4 (search a child's birth or marriage):**
Children's records often list both parents' names. Search:
```
q.fatherGivenName=John
q.fatherSurname=Brown
q.motherGivenName=Mary
q.birthLikePlace=Ohio
q.birthLikeDate.from=1870
q.birthLikeDate.to=1890
```
→ Returns children, whose records will list Mary's maiden name in the mother's surname field.

---

## 13. Quick-Reference Decision Tables

### "Should I check the Exact box?"

| Field | Default fuzzy match expands to… | Check Exact when… |
|---|---|---|
| Given name | nicknames, abbreviations, diacritic variants | Name is a true match in indexed record verbatim; rare formal name |
| Surname | spelling variants via internal phonetic algorithm | Name is unusual; result list is too noisy |
| Place | up to 3 jurisdiction levels above the typed place | You want to exclude parent-jurisdiction matches (still includes children) |
| Year | ±~2 years (undocumented, varies by event) | You have a verified date (vital record date) |

### "How many wildcards / which kind?"

| Situation | Use |
|---|---|
| Single ambiguous letter | `?` (e.g., `Sm?th`) |
| Unknown ending | `*` at end (e.g., `Thib*`) |
| Unknown beginning | `*` at start (e.g., `*bou`) |
| Multiple uncertainties | up to four `*` (e.g., `*lus*k`, `T*l*ts*`) |
| Common transcription error pair | `?` at the suspect letter |

### "Which collection ID is which?"

The agent should NOT hardcode collection IDs without verifying. Common ones (verified via the public catalog as of 2026):
- US Census 1900: `1325221`
- US Census 1910: `1727033`
- US Census 1920: `1488411`
- US Census 1930: `1810731`
- US Census 1940: `2000219`
- US Census 1950: `4464515`
- England, Births and Christenings, 1538–1975: `1473014` (verify)

When in doubt, look up the collection at `/search/collection/list` and read the ID from the URL.

---

## 14. Final Operational Notes

- **Authentication:** A free FamilySearch account (sign-in) is required for full record access. Some image-bearing collections are restricted to FamilySearch Centers or affiliate libraries by contract with the record custodian (camera-with-key icon).
- **Throttling:** the `/search/record/results` endpoint is not rate-limited at typical human-search rates; aggressive automated scraping triggers 429 responses. The platform API (`api.familysearch.org`) is the supported automation surface and requires OAuth credentials.
- **Stability:** FamilySearch updates the search UI roughly annually. The URL parameter vocabulary in §6 has been stable since approximately 2018 but is not guaranteed. Re-verify before any major change in the agent's reliance on URL synthesis.
- **The "Search Records" launcher from a tree person** auto-fills the agent's search with the tree person's facts — the agent should use this as the cheapest starting point for any subject who already has a Family Tree profile, as it produces a valid `treeref` link that downstream Source Linker can consume to attach found records.

---

## Appendix A: Confirmed Live URL Patterns (Examples)

```
# Broad search by name + place + date range, large page
https://www.familysearch.org/search/record/results?count=100
  &q.givenName=Martha&q.surname=James
  &q.anyPlace=Monroe, Arkansas, United States
  &q.anyDate.from=1850&q.anyDate.to=1860

# Search restricted to one collection
https://www.familysearch.org/search/record/results?count=20
  &q.surname=Sterr&q.anyPlace=Minnesota
  &f.collectionId=1488411

# Search using parents only (drop principal name) with wildcard surname
https://www.familysearch.org/search/record/results?count=20
  &q.fatherGivenName=Frank&q.fatherSurname=St*
  &q.motherGivenName=Hannah&q.motherSurname=St*
  &q.birthLikePlace=Hillman, Morrison, Minnesota, United States
  &q.birthLikeDate.from=1907&q.birthLikeDate.to=1911

# Search by IGI batch number, list all with this surname in the parish
https://www.familysearch.org/search/record/results?count=100
  &q.batchNumber=C050761&q.surname=Pennington

# Tree-person-context search (auto-populated)
https://www.familysearch.org/search/record/results?count=20
  &q.givenName=Edna&q.surname=St*
  &q.fatherGivenName=Frank&q.fatherSurname=St*
  &treeref=27SY-KM6

# Place-faceted filter (place IDs from FamilySearch Places)
https://www.familysearch.org/search/record/results?count=20
  &q.batchNumber=I04390-5
  &c.collectionId=on&f.collectionId=1680845
  &c.birthLikePlace1=on&f.birthLikePlace0=10
  &c.birthLikePlace2=on&f.birthLikePlace1=10,Ohio
  &f.birthLikePlace2=10,Ohio,Monroe
```

## Appendix B: Sources and Verification

- FamilySearch Help Center: "Search Instructions for Historical Records" (article 27186, last updated 2025-08-07).
- FamilySearch Help Center: "Search Tips for Historical Records" (Debbie Gurtler).
- FamilySearch Help Center: "Find and search a specific collection in Historical Records."
- FamilySearch Help Center: "Search historical records from Family Tree."
- FamilySearch Help Center: "Find birth records on FamilySearch" (Type-filter taxonomy).
- FamilySearch Blog: "Searching with Wildcards in FamilySearch" (Steve Anderson, content submitted by Phil Dunn and Susan Burleson; published 2014-04-10, modified 2022-07-31).
- FamilySearch Blog: "Record Search Tips: Find Your Family" (Amie Bowser Tennant).
- FamilySearch Blog: "Advanced Strategies for Searching Historical Records" (Dave Nielsen).
- FamilySearch Blog: "Finding Elusive Records in FamilySearch, Parts 1–3" (Robert Kehrer, RootsTech 2018).
- FamilySearch Blog: "You Can Now Use an Exact Year in Your Historical Records Search" (published 2025-07-01).
- FamilySearch Blog: "New IGI Batch Number Search."
- FamilySearch Blog: "Fixing Problems with the Batch Number Search in FamilySearch."
- FamilySearch Wiki: "FamilySearch Search Tips and Tricks."
- FamilySearch Wiki: "IGI Batch Numbers for the British Isles and North America."
- FamilySearch Wiki: "Census Techniques and Strategies for Finding Elusive Ancestors."
- FamilySearch Developer Center: "Record Persona Search Resource" (`/developers/docs/api/records/Record_Persona_Search_resource`).
- FamilySearch Developer Center: "Tree Person Search Resource" + "Family Tree Search Guide."
- FamilySearch Developer Center: "Linking to FamilySearch Pages" (guide stating only ARK URLs are formally supported).
- Hugh Wallis IGI Batch Numbers: `https://freepages.rootsweb.com/~hughwallis/genealogy/IGIBatchNumbers.htm`.
- Family Tree Magazine: "Searching Records on FamilySearch: Your Complete Guide."
- Family Tree Magazine: "Tutorial: Searching on Batch Numbers at FamilySearch.org."
- Lisa Louise Cooke (Genealogy Gems): "FamilySearch Search Strategy Essentials" (2021).
- Family Locket: "Other Relationships on FamilySearch" (Nicole Dyer); "How to Improve the FamilySearch Family Tree by Applying the GPS."
- FamilySearch Community forum threads at community.familysearch.org confirming live URL parameter behavior (discussion 109310, discussion 111031, discussion 113673).
- Board for Certification of Genealogists, *Genealogy Standards*, 2nd edition, revised (Nashville, TN: Ancestry, 2021).