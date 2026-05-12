# FamilySearch Full-Text Search — Technical Reference for an AI Genealogy Agent

## TL;DR
- **FamilySearch Full-Text Search (FTS) graduated from Labs to standard search tools on 30 August 2025**, and as of 1 May 2026 covers ~6,665 auto-generated, searchable image collections holding ~1.95 billion result-records of AI-transcribed images (per Randy Seaver's weekly Genea-Musings tracker), heavily weighted toward US Legal/Vitals/Migrations/Probate, UK Military/Legal, Latin American Legal, and Revolutionary War Pensions; FamilySearch's RootsTech 2026 syllabus characterizes the underlying transcribed-image total as "~2.5 billion images" across "8,000+" auto-collection definitions, but the user-searchable surface is the smaller Seaver number.
- **Query language is a Lucene-style subset:** default OR; `+` requires; `-` excludes; `"…"` for phrase (with one-token slop); `?` and `*` wildcards (NOT inside quotes, NOT as first character); five fields (Keywords, Name, Place, Year Range, Image Group Number/DGS); filters are post-search refinements on collection metadata. **No proximity (`~N`), no parentheses grouping, no Boolean keywords (AND/OR/NOT), no Soundex, no stemming, no abbreviation expansion are officially supported.**
- **Dominant agent tactic:** "broad name → filter → iterate." Search a single name (or surname + a slavery/legal/landmark keyword), then use left-sidebar filters by Place→state→county, decade, record type, and collection. Wildcards compensate for HTR errors; FAN/witness/neighbor co-occurrence searches are the unique value proposition vs. traditional indexed search.

---

## PART 1 — TECHNICAL REFERENCE / POWER-USER MANUAL

### 1.1 Access and entry points

- Primary URL: `https://www.familysearch.org/en/search/full-text/`
- Main menu: **Search → Full Text**
- FamilySearch Labs (still hosts "Simple Search" natural-language experiment as of mid-2026): `https://www.familysearch.org/labs/`
- FamilySearch Catalog: an FTS icon appears on processed image groups (search inside a single image group).
- All-Collections Search on signed-in home page also routes into FTS.
- A free FamilySearch account is required.
- **Status note:** Per FamilySearch blog "Full-Text Search Leaves FamilySearch Labs" (30 Aug 2025): *"FamilySearch is thrilled to announce that Full-Text Search is now part of its standard search tools. Since its initial release in FamilySearch Labs during RootsTech 2024, the feature has undergone numerous enhancements to improve its power and usability."* David Ouimette's RootsTech 2026 syllabus confirms: *"Full-Text Search officially launched in August 2025."*

### 1.2 Searchable fields (start page)

Per FamilySearch Help Center ("Find the new full text search for historical records"): *"Begin by typing information in the Keywords, Name, Place, Year (Range), or Image Group Number (DGS) fields."*

| Field | Purpose | Notes |
|---|---|---|
| **Keywords** | Free text against the entire transcript | All operators (`+`, `-`, `"…"`, `?`, `*`) work here. |
| **Name** | Search NLP-recognized person-names only | Restricted to tokens the AI flagged as personal names. **Auto-handles last-name-first inversions** — Ouimette: *"your name search for 'Alexander Mills' may return Alexander Mills or Mills Alexander. However, your keyword search for 'Alexander Mills' may return Alexander Mills but not Mills Alexander."* |
| **Place** | Place name | Ouimette: *"searching by Place returns matching images that either contain the place in the transcribed data or in the corresponding record-collection metadata."* This dual-source matching is the source of place-related false positives. |
| **Year Range** | Numeric range | AI-recognized years in transcript and/or collection metadata. AI may misrecognize dates; documents often contain multiple dates. |
| **Image Group Number (DGS)** | Restrict to one digitized volume | Enter the number with no leading zeros. Combine with keywords to scan one volume. |

**Cross-field semantics** (Raymond, RootsTech 2025 syllabus): *"If more than one field is specified, results must match all specified fields. However, operators change which search terms (keywords and names) within a field are required."*

**Empirically observed** (Start Researching blog, "Just the name! My top tip"): typing a place into the **Place field** — rather than using the sidebar Place filter — causes the place name itself to appear in highlighted snippets, generating false-positive matches where only the place (not the name) appears in the text. *"When you use the place name in your initial search, the place name will show up in the highlighted search text, even when your name does not appear… when you search based on a name alone, and THEN filter results by place, you get results with the name only — in the correct place!"* This is the single highest-leverage agent rule.

### 1.3 Operators (verbatim semantics from Raymond, RootsTech 2025 syllabus)

| Op | Example | Behavior |
|---|---|---|
| (none) | `Ezekiel Pearce` | OR. *"By default, terms are optional… results must contain at least one of them."* Hit counts are large. |
| `+` | `+Ezekiel +Pearce` | AND. *"To require a term, place a plus sign directly before it, with no intervening space."* |
| `-` | `+Ezekiel +Pearce -Pierce` | NOT. *"To exclude results containing a term, place a minus sign directly before it."* |
| `"…"` | `+"Ezekiel Pearce"` | Phrase, with **one-word slop**. Raymond: *"First and last names enclosed in quotation marks must occur together. Specify the first name first… A little flexibility is allowed; a keyword is allowed to occur between the specified terms. The example matches Ezekiel John Pearce in addition to Ezekiel Pearce."* Ouimette: phrase `"Ebenezer Mills"` returned 2,173 results *"possibly with an additional word in between such as Ebenezer Royal Mills."* |
| `?` | `Ezeki?l` | Single-character wildcard. |
| `*` | `execut*r*` | Multi-character wildcard, including zero. *"matches executor, executrix, executors, executrices, executorship, executry, and several misspellings."* |

**Multiple required phrases** combine: `+"phrase one" +"phrase two"` (Price Genealogy: `+"Susan Pannebaker" +"Power of Attorney" +Illinois` returned exactly one document).

- **Operators are NOT case-sensitive.** Queries are case-insensitive (empirically confirmed by spot checks).
- **No Boolean keywords.** Bare `AND`/`OR`/`NOT` typed in the search box are treated as literal words, OR'd with the rest. Only the symbol form (`+`, `-`, `"`, `?`, `*`) is recognized.
- **No grouping parentheses are documented.** Neither Raymond's nor Ouimette's syllabus shows any `()` example. Treat parentheses as literal characters and avoid them.
- **Proximity operator (`~N`):** **NOT officially documented.** James Tanner (Family History Guide blog, "The Main Challenges of FamilySearch Full-text Search, Part Three") reports anecdotally: *"By searching for 'Sarah Miller'~10, you are telling the FamilySearch engine that these two words must appear within ten words of each other. But the results of my use of all these Boolean tools are mixed I am not sure that FamilySearch's full-text search understands them because the results are inconsistent."* **Treat `~N` as unsupported/unreliable.**

### 1.4 Wildcard rules (definitive)

Raymond, RootsTech 2025 syllabus: *"Wildcards cannot be used inside quotation marks and cannot be the first character of a term."* Ouimette, RootsTech 2026 syllabus: *"At this time, wildcards cannot be embedded in quotation marks."*

- `?` = exactly one arbitrary character.
- `*` = zero or more arbitrary characters.
- Wildcards may NOT appear inside `"…"`. Example `"Eben* Mills"` — *"Not yet supported"* (Ouimette).
- Wildcards may NOT be the first character of a term.
- Multiple wildcards in one term are permitted: `Sm?th??` returns Smithey, Smithie, Smethus.
- Best practice: ≥3 literal characters in a wildcard term; `t*ike` over-matches Thorndike. (FamilySearch's general wildcard help article — applicable to indexed search and empirically also to FTS — states *"To use a wildcard symbol in your search, in most cases, you must use at least 3 letters of the surname or given name"* and *"You can use up to four asterisks at a time."*)

**Empirical wildcard tactics** (Raymond, with sample counts on New York data, late 2024):
- `turnpike` → 222,551 hits; `tu*pike` adds 9,621 (catches "Tumpike," "Tunipike" — `rn`→`m` misreads); `t*pike` adds 5,425 more (catches "Tempike"); `t*ike` over-matches Thorndike.
- `Massachusetts` → also `Ma?sachusetts` to catch long-s misreads (long-s `ʃ` recognized as `f`), adds ~1,400 results.

### 1.5 Fuzzy matching, stemming, normalization — UNDOCUMENTED

FamilySearch has not published documentation on stop words, stemming, diacritic folding, case sensitivity, or hyphenation handling for FTS. Empirical observations across community sources:

- **Case insensitivity** — confirmed empirically.
- **Diacritic insensitivity** — partial; queries entered without diacritics generally match diacritic-bearing transcripts in Spanish/Portuguese collections, but coverage is uneven.
- **No stemming.** `marries` does NOT match `married`. Use `*` explicitly: `marri*`.
- **No phonetic / Soundex matching.** Family History Daily (independent test): *"Unlike the advanced search in the official FamilySearch tool, the experimental Full-Search Text tool will only return results that AI determines are an exact match to what was typed in. Results won't automatically include potential variations (for example, results with the name 'Steven Jarmon' in addition to the 'Stephen Jarman' spelling that was entered)."*
- **Abbreviations are NOT auto-expanded.** `Wm`≠`William`, `Jno`≠`John`, `Jas`≠`James`, `Thos`≠`Thomas`, `Chas`≠`Charles`. Run separate queries (Price Genealogy / Lineages: *"When crafting search terms, remember common name abbreviations and nicknames. Examples are Wm = William, Jas = James, Thos = Thomas, and nicknames Polly = Mary, Sally = Sarah."*).
- **Punctuation:** apostrophes, commas, periods are largely ignored at tokenization, but query without punctuation by default.
- **Unit of indexing is the IMAGE.** Per MyFamilyPattern's analysis of Daniel McMasters: *"It's important to note that one search result is presented for each mention of your search term per image, not per document. So, in the above example, the land deed covered three document pages across two microfilmed images. Daniel McMasters' name appeared on both images and so two results were returned for the one land deed document."*
- **Line-broken / hyphenated words** — empirically inconsistent. A surname that wraps across a page boundary may not be findable as a whole token. Try both halves.

### 1.6 Filters (post-search facets, left sidebar)

Filters operate on **collection metadata**, not the transcript text:

- **Collection** (auto-collection: place + record type + date range bucket; FamilySearch generates these dynamically).
- **Year** — first by century, then by decade. **The year shown is from collection metadata, NOT necessarily the date in the document.** Powell: *"be aware that document titles with dates may not reflect the document's actual date. Look anyway!"*
- **Place** — hierarchical: country → state/province → county → (sometimes) city. **The place is the digitized collection's metadata place, not the place mentioned in the document.**
- **Record Type** — categorical (deeds, probate, court, vital, naturalization, military, etc.).

**Critical agent rule:** filters never broaden, only narrow. Apply filters AFTER the initial broad search. If the initial search returns zero results, removing keywords is the first step; do not filter further. Use the "Edit Search" link in the left sidebar to revise the query without losing context (FamilySearch Help Center: *"On the search results page, you can change filters in the left sidebar… To change your search criteria, click the Edit Search hyperlink in the left sidebar. At the top right, you can toggle the Fact View on or off."*).

### 1.7 Indexing and transcription quirks

- **Faithful representation symbols** (Raymond, *"FamilySearch designed its text recognition software to produce a 'faithful representation' of the characters in a document, to the extent possible in simple text"*):
  - `✍` = clerk's flourish (last ink from a pen)
  - `⌨` = unrecognizable / uncertain symbol(s)
  - `█ ▓ ▒` = shading or bleed-through
  - `↔` = horizontal rule, long dashes, ditto strings
  - `⎬` = brace
  - `* 〰 ⚭ ✝ ▭` = standard church register symbols (birth, baptism, marriage, death, burial)
  - `$ £ ½` and circled marks `(© ℗ ® ② Ⓧ)` are passed through.
  Searching for these glyphs is technically possible but rarely useful; awareness helps an agent interpret transcripts.
- **Long-s (ʃ):** historically misrecognized as `f`. Workaround: `Ma?sachusetts`, `Bo?ton`, `wi?e`. Adds ~1,400 results in a sample run (Raymond).
- **Common HTR letter-confusion patterns** (Raymond + Powell + Brent Trout webinar):
  - `rn` ↔ `m` (Turnpike → Tumpike)
  - `m` ↔ `rn`/`in`/`iii`
  - `u` ↔ `n`/`ii`
  - `e` ↔ `c`/`o`
  - `l` ↔ `I`/`1`/`t`
  - `S` ↔ `F`/`f` (long-s and ornate copperplate caps; Trout webinar specifically calls out *"the confusion between 'S' and 'F'"* and *"Gasper vs. Casper"*)
  - `c` ↔ `e` (Cole/Cale/Cele — Powell example)
  - terminal flourishes can add spurious characters
  - double-l → `tt`, `H`, or `ll`
  - `5`↔`S`, `0`↔`O`/`Q`, `6`↔`G`/`b`
- **Marginalia** ARE indexed (Nicole Palsa: discovered an ancestor's name in the margin of a 1771 land survey, where the note had been added in 1780).
- **Struck-through text** is indexed as written; the AI does not interpret strike-through as deletion.
- **Multi-column / tabular data** is read row-major across columns; spurious "phrase" matches occur where Column-A row-N's first name aligns with Column-B row-N's surname (MyFamilyPattern documented case: `+William +Wilson` matched a 2-column page where Col A had "Lewis, William" and Col B had "Wilson, Robert" on the same row).
- **Auto-collection assembly is dynamic.** New images appear in existing collections at any time; coverage information per collection is not yet exposed (Raymond: *"FamilySearch would like to effectively present coverage information for each collection. This could include locality, time frames, and record type coverage"*).

### 1.8 Result page and document viewer features

- **Default sort:** approximate relevance (tightest matches first; less relevant later).
- **Pagination:** default 20 results/page; settable to 100 (Price Genealogy: *"It is far faster to scroll through the results than having to page multiple times"*).
- **Fact View toggle** (top right of results): switches each result tile from a transcript snippet to a structured list of recognized persons, places, and years. Useful for an agent to extract entities programmatically. FamilySearch Community announcement (Jan 7, 2025): *"We have released a new way to view search results. There is a toggle labeled 'Fact View' in the upper right corner. Instead of seeing sentences from the image transcript, you are shown names of persons, places and dates mentioned in the document. In addition to using the filters (under 'Results'), this new view can help you find what you're looking for faster."*
- **Edit Search** link (left sidebar) preserves filter state.
- **Per-document right-pane controls** (Ouimette + Raymond):
  - **Show Keywords** — yellow-highlight matches on the image.
  - **Show Translation** — AI-translates transcript to user's language; accuracy variable; recommend chatbot-assisted verification.
  - **Summarize** ("Summarize the Document") — AI-generated English summary of relationships, names, transaction; useful for triage. Raymond: *"This produces an English summary, even for non-English documents."*
  - **Edit** — community-correction of transcript (Community announcement, April 2026: "Transcript Editing Suspended" — temporarily suspended pending engineering update).
  - **Copy icon** — copies transcript to clipboard.
  - **Download icon** — image, transcription, and citation, in any combination.
  - **Attach to Tree** — links the image to a Family Tree person; *"FamilySearch is currently developing an enhanced version of the attach-to-tree process from full-text search"* (Community announcement, 22 Oct 2025).
  - **Citation button** (above image) — generates an FS-style citation. Raymond cautions: *"The citation does not meet industry standards and is often incomplete. Be prepared to create your own citation."*
  - **Group Data tab** (right pane) — exposes Image Group Number, image number, total image count, and the **ARK URL**. The ARK is the citation-stable identifier; *"FamilySearch engineers have indicated ARKs will work for the foreseeable future. Other identifiers may not be long-lived, including other URLs, film numbers, image group numbers, image numbers, and image counts."*

### 1.9 Hit-count interpretation

- Hit counts are **per-image-mention**, not per-document; double-page-spread documents generate ≥2 hits.
- A query that returns 19 million results indicates the OR default is in effect; switch to `+TermA +TermB` immediately.
- Snippet generation: the AI extracts the highest-scoring transcript window containing matched tokens; matches in marginalia or footnotes may not appear in the snippet but still count as hits.
- **Why some matches don't visibly highlight:** when the matched token appears in the transcript but not in the AI-judged "best" snippet, the result tile may show context without your query term; the term IS present in the full transcript view. More common with single-character wildcard queries.

### 1.10 Community-discovered tricks (cited)

- **Search name only, filter to place** (Start Researching, "Just the name! My top tip for using 'Full Text' on FamilySearch," published Apr 2026): *"Use a name (and only a name!) and then filter results down to a place (not name + place in your first search). This is my biggest and best tip, and how I conduct all my searches."*
- **Filter to PLACE first, then year, then record type** (Price Genealogy, "Research Game Changer Part 2"): *"Experience has shown that it is most useful to filter on Place first."*
- **Set page size to 100** (Price Genealogy).
- **For surnames that are also common words** (Rice, Hill, Ford), exclude collisions: `+Rice -paddy -planting` (Tanner).
- **For famous-name collisions:** `+Lincoln -Abraham` (Powell).
- **DGS internal scan:** when a collection is known to be relevant but FTS returns nothing, get the DGS from the catalog and paste it into the Image Group Number field with no other constraints, then add narrower keywords iteratively (Nicole Palsa, Kinfolks Substack).
- **Slavery research keyword scoring** (Raymond, NGS Magazine Oct–Dec 2024 + RootsTech 2025 syllabus): the keyword `Negr*` alone catches ~60% of all slavery-related document mentions; adding `Slave*` brings cumulative coverage to 83%; adding `Freedm?n` to 92%. Diminishing returns thereafter.
- **Robert Raymond's official advice** (RootsTech 2025): *"A particularly powerful approach for finding records about an enslaved person is to specify their first name (usually without a family name), the name of an enslaver or plantation or relative, and a common keyword associated with slavery. Filter by collection, record type, place, and time, as necessary."*

---

## PART 2 — RESEARCH METHODOLOGY ORIENTED ON THE GENEALOGICAL PROOF STANDARD (GPS)

### 2.1 GPS Standard #1 — "Reasonably Exhaustive Research"

FTS uniquely surfaces categories of records traditional indexed search misses:

- **Witness signatures on deeds** — Randy Seaver discovered Ignatius Dyer as a deed witness in Hawkins Co., TN, by searching the surname "Dyer" with a Tennessee place filter (Family Locket / Genea-Musings).
- **Estate appraisers and bondsmen in probate** — Diana Elder (Family Locket, "AI and FamilySearch Full-Text Search: Working Together to Make Discoveries"): *"In the records in counties where I knew Thomas resided, he appeared as a witness or estate appraiser, so he wasn't named in the main indexes of the probate or deed books I had previously searched. One record stood out: a deed in Clarke County, Georgia. I hadn't researched Clark County because I had no reason to believe Thomas would appear in a record there, but I was wrong!"*
- **Heirs-at-law and legatees named in wills** — beyond the typically-indexed testator and executor.
- **Sureties, guardians, administrators** in court records.
- **Powers of attorney filed in distant counties** — Price Genealogy / Lineages: a Juniata Co., PA POA recorded by Susan Pannebaker resident in Bureau Co., IL, named her father Jacob J. Ulsh.
- **Chains of title** — boundary-call language identifies adjoining landowners.
- **Enslaved individuals' first names** — Andre Kearns' "Finding Milly: Tracing enslaved ancestors using Experimental Search" (RootsTech 2024) and Robin Foster (Roots Revealed): *"do by these presents give, grant, bargain, sell unto the said Benjamin Pearce his heirs & assigns forever one negro wench named Pheobe, about nineteen years old, & her child Anna about eight months old."*
- **Marginalia** — Palsa's 1780 marginal note on a 1771 survey.
- **Tax-list and store-account entries** mentioning non-residents.

**Decision rule for the agent:** after exhausting indexed search, FTS should be run for every named person in the GPS-relevant orbit — target + spouse + parents + children + neighbors + in-laws + business partners — using the FAN club (Family/Associates/Neighbors) approach. Randy Seaver: *"with Full Text searches of these records, we have the possibility of finding more records with our ancestors names — deed and probate witnesses, neighbors, associates, etc. In other words- the FAN CLUB."*

### 2.2 When to use FTS vs. indexed Records search vs. Catalog browse

| Scenario | Tool |
|---|---|
| Known name + indexed event (BMD, census, vital) | **Indexed Records search** |
| Person mentioned but not as principal (witness, neighbor, slaveholder, heir, surety) | **FTS** |
| Pre-1850 U.S. research with thin indexed coverage | **FTS first**, indexed second |
| Latin American notarial protocolos | **FTS strongly preferred** |
| Mid-tier handwritten paragraph records (court minutes, town meetings, narrative reports) | **FTS** |
| What records exist for a place/time | **Catalog browse** → DGS into FTS to scan a specific volume |
| Need to identify a county/repository at all | **Wiki + Catalog**, then FTS |
| Burned-county scenarios | **FTS in adjacent counties** |
| Unusual scripts (Kurrent, Cyrillic, CJK) as of mid-2026 | **Manual browse** (FTS coverage too sparse) |

### 2.3 Query strategy by research goal

- **Identity resolution:** distinctive given+surname + place filter; Fact View toggle to compare matched entities; `-` to exclude wrong candidate's locale.
- **Kinship determination:** `+Surname +daughter +heir`; `+Surname +"in trust"` for marriage settlements; `+Surname +"my beloved wife"` for testamentary kin.
- **Migration tracing:** chain-of-title — search target's surname in successive states/counties along plausible migration corridors; date-range filters in 10-year buckets.
- **FAN cluster:** target surname AND associate surname both `+`'d; filter to one place; iterate associate list.
- **Slaveholding:** enslaver surname + slavery keyword (`+Negr*` or `+slave*`) + place filter; cross-reference enslaved given names to bills of sale and probate inventories.
- **Land / property:** boundary descriptions ("south 47 west," "to a white oak"), creek/landmark names, acreage + surname.
- **Military:** `+name +"pension"`, `+name +"bounty land"`; auto-collection 5000421 (Revolutionary War Pension and Bounty-Land Application Files); deposition language `+"personally appeared" +name`.
- **Burned-county workaround:** records re-recorded in adjacent or successor counties — search neighbors as filters.

---

## PART 3 — ALTERNATIVE SEARCH STRATEGIES

### 3.1 Decision tree for an agent

```
INITIAL: Name field "Given Surname"; place filter applied AFTER
  ├── 0 results       → drop place; try Keyword field; try wildcards
  ├── 1–50 results    → review all
  ├── 50–500 results  → add filter Year/RecordType
  └── >500 results    → add second required term (+associate, +occupation, +landmark)

If still 0:
  ├── try given as Keyword + surname as Keyword (separate operators)
  ├── try surname only + place
  ├── try Wm/Jno/Jas/Thos/Chas abbreviations
  ├── try wildcards on most-likely-misread letters (long-s, rn/m, c/e)
  ├── try last-name-first phrase: "Surname Given"
  ├── try maiden vs. married surname for women
  ├── try DGS-scoped search of the most likely volume
  └── try keyword-only search of context phrases (boilerplate) + place

If still 0:
  ├── verify the collection is in FTS (Genea-Musings tracker; auto-collection list)
  ├── fall back to manual browse of the image group
  └── log negative result with timestamp + exact query
```

### 3.2 Name-variant table (English-language US/UK records)

| Formal | Common abbreviations | Nicknames |
|---|---|---|
| William | Wm, Wm., Will. | Will, Bill, Billy |
| John | Jno, Jno., Jn° | Jack, Jno |
| James | Jas, Jas., Js | Jim, Jimmy |
| Thomas | Thos, Thos., Tho. | Tom |
| Charles | Chas, Chas., Cha. | Charley, Charlie |
| Robert | Robt, Robt., Rob. | Bob, Bobby, Robin |
| Richard | Richd, Richd., Rich. | Dick, Rick |
| Samuel | Saml, Saml., Sam. | Sam, Sammy |
| Joseph | Jos, Jos. | Joe, Joey |
| Benjamin | Benj, Benj., Benjm. | Ben, Benny |
| Henry | Hy, Hy. | Harry, Hank |
| George | Geo, Geo. | — |
| Alexander | Alexr, Alexr., Alex. | Alex, Sandy |
| Christopher | Christ., Xpr. | Kit, Chris |
| Margaret | Margt, Margt., Marg. | Peggy, Maggie, Meg |
| Mary | M., Mra. | Polly, Molly, May |
| Elizabeth | Eliz, Eliz., Elizth. | Betsy, Betty, Bess, Liz, Lizzie, Eliza |
| Sarah | S., Sa. | Sally |
| Catherine/Katherine | Cath., Catha. | Kate, Katie, Kitty |
| Martha | M. | Patty, Patsy |
| Frances | Fra. | Fanny, Frankie |
| Dorothy | Doro., Dor. | Dolly, Dot |
| Eleanor | Elen. | Nell, Nelly |
| Ann/Anne | A. | Nancy, Annie |
| Susannah | Susa., Sus. | Sukey, Sue |
| Rebecca | Rebec. | Becky |
| Jane | J. | Jenny, Jeanie |
| Abigail | Abigl. | Abby, Nabby |

**Latin / anglicized cross-walks** (Latin American and ecclesiastical records):
- Joannes ↔ Juan/John, Iacobus ↔ James, Maria ↔ Mary, Petrus ↔ Peter, Henricus ↔ Henry, Carolus ↔ Charles.
- Spanish ↔ English: Diego/Santiago/Jaime ↔ James, Catalina ↔ Catherine, Ricardo ↔ Richard, Guillermo ↔ William.
- German ↔ English: Johann/Hans ↔ John, Wilhelm ↔ William, Heinrich ↔ Henry, Friedrich ↔ Frederick, Karl ↔ Charles.
- **Quaker numbered months:** prior to 1752 calendar reform, "1mo" = March; after 1752, "1mo" = January. Always test both interpretations.

### 3.3 OCR / HTR error pattern table

| Pattern | Substitution | Example | Wildcard tactic |
|---|---|---|---|
| long-s `ʃ` | f, l, t | Massachusetts → Mafsachusetts | `Ma?sachusetts`, `wi?e` |
| `rn` | m, in, iii | Turnpike → Tumpike | `Tu*pike`, `*urnpike` |
| `u` | n, ii | Mountain → Mountan | `Mo?ntain` |
| `m` | rn, in, iii | William → Williain | `Willi*m`, `Wm*` |
| `c` | e, o | Cole → Cale, Cele | `C?le` |
| `e` | c, o | execute → cxccute | `*xecute` |
| `l` | I, 1, t | Alice → Atice | `A?ice` |
| ornate capital S | F | Scott → Fcott | `?cott` |
| double-l | tt, H, ll | Allen → Atten | `A??en`, `Al?en` |
| 5 / S | swap | Smith → 5mith | empirically rare |
| 0 / O / Q | numeric/letter | 1804 → I8O4 | year filter compensates |
| terminal flourish | extra char | `Henry✍` → `Henrys` | strip flourish |
| `&` ligature | et, &c, etc. | & → et | search both |
| `th` superscript | dropped | yᵉ → ye | search `ye` and `the` |
| superscript abbrev | dropped | Mrs → Mes | `M?s` |

**Era-specific handwriting profiles:**
- **Secretary hand (16th–17th c. English):** `e` looks like a tight backwards-c; multiple `s` forms; two-stroke `r`. Errors concentrate in word endings (-ed, -es, -eth).
- **Round / italic (17th–18th c.):** generally readable, but long-s and ligatures (st, ct, ſh) confuse models.
- **Copperplate / engrosser's (18th–19th c. legal):** stylized capitals (S, F, T, L) confuse capital-letter recognition. Brent Trout webinar specifically calls out *"the confusion between 'S' and 'F'"* and *"variations like 'Gasper' versus 'Casper'"*.
- **German Kurrent / Sütterlin:** AI models for Roman script perform poorly; `H`/`Y`, `e`/`n`, `B`/`L` most confused. As of 2026, FamilySearch's HTR is primarily trained on Latin script (English/Spanish/Italian/Portuguese/French/Dutch); Kurrent collections are not yet well-supported.
- **Spanish Procesal / colonial Spanish:** abbreviations on superscripts (`q'`=que, `dho`=dicho, `Vd`=usted) frequently truncated.

### 3.4 Phrase-and-reordering variants

For target "John Henry Smith":
1. `+"John Smith"` (slop allows middle name)
2. `+"John Henry Smith"`
3. `+"John H Smith"` and `+"John H. Smith"`
4. `+"J H Smith"` and `+"J. H. Smith"`
5. Name field: `"Smith, John"` (Name field handles inversion automatically)
6. Keyword field: `+"Smith John"` (separate query — Keyword does NOT auto-invert)
7. `+John +Smith +Henry` (no quotes; arbitrary co-occurrence window)
8. Surname-only with locality: `+Smith` filtered to county
9. `+"J. Smith"` for documents abbreviating given names

### 3.5 Co-occurrence / FAN searches

- Target + known associate's surname: `+"John Rodgers" +Caldwell` (Powell example).
- Target + known witness from an indexed deed (harvest more deeds where the witness signed).
- Target + spouse maiden surname: `+Brewer +Gay` (Powell — uncovers wills naming a married granddaughter).
- Target + occupation: `+Davis +blacksmith` (Powell).
- Target + neighbor's distinctive item: `+Cochran +"silver watch"` (Powell).
- Target + landmark: `+Rodgers +"Turnip Creek"` filtered to Lunenburg Co., VA (Powell).

### 3.6 Negative-space / exclusion searches

- Disambiguate two same-named people: `+"John Smith" +Pennsylvania -Ohio`.
- Famous-figure collisions: `+Lincoln +Kentucky -Abraham -President`.
- Common-word surname: `+Rice -paddy -planting` (Tanner).
- Filter out a known-irrelevant collection class: deselect in left sidebar.

### 3.7 Place-name variants

- **Pre-split / parent counties:** for post-1842 Catawba Co., NC research, also search parent Lincoln Co., NC; for post-1796 Tennessee, search parent NC counties.
- **County-name substitutions:** "Lauderdale Co.", "Lauderdale County", "County of Lauderdale" (Family History Daily example).
- **State abbreviations:** "Ala.", "Alabama"; "Va.", "Virginia", "Virga"; "N.C.", "No. Caro.", "North Carolina"; "Mass.", "Bay State."
- **Spelling variants:** Pittsburgh / Pittsburg (the H was dropped 1891–1911 by USGS); Worchester / Worcester; Cincinatti / Cincinnati.
- **Unit terms:** township, district, beat (AL/MS), precinct, hundred (DE/colonial VA), parish (LA), parish (UK ecclesiastical).
- **Historical jurisdictions:** "British North America" (pre-1867 Canada), "New Spain" (pre-1821 Mexico), "Spanish Florida," "District of Columbia," "Northwest Territory."
- **Place-filter sidebar simplification:** Start Researching: *"While most other genealogy searches will have you use the specific name of the location based on the time period — such as selecting 'Halifax, Nova Scotia, British North America' for records prior to 1867 and 'Halifax, Nova Scotia, Canada' for post 1867, in Full Text we just filter to 'Nova Scotia' then 'Halifax'."*

### 3.8 Date variants

- Year-only as keyword: `1834`.
- Written-out: `+"twenty-fifth day"`, `+"in the year of our Lord"`, `+"day of August"`.
- Quaker dates: `+"first month"`, `+"7th day of the 9th month"`.
- Regnal years (UK pre-1752 statutes): `+"in the * year of the reign of"`, `+"reign of King George"`.
- Abbreviated dates: `25 Augt`, `Septr 1834`, `Decr 17`, `Xber` (December), `9ber` (November in legal Latin).
- Use the Year Range filter for ranges; do NOT typically force year as keyword unless searching a specific recorded date.

### 3.9 Document-type-specific boilerplate phrases

Boilerplate is gold because it co-locates with target names and survives HTR errors better than personal names.

**Wills (English-American 17th–19th c.):**
- `"being of sound mind"` / `"sound and disposing mind"`
- `"to my beloved wife"` / `"to my dear and loving wife"`
- `"unto my son"` / `"unto my daughter"`
- `"my heirs and assigns forever"`
- `"Last Will and Testament"`
- `"do make and ordain this"`
- `"I give and bequeath"`
- `"executor of this my last will"`
- `"residue and remainder of my estate"`

**Deeds:**
- `"know all men by these presents"`
- `"in consideration of the sum of"`
- `"do grant bargain and sell"`
- `"to have and to hold"`
- `"warrant and forever defend"`
- `"sealed and delivered in the presence of"`
- `"acknowledge before me"`
- Boundary: `"beginning at a"`, `"thence north"`, `"to a white oak"`, `"corner to"`.

**Court / depositions:**
- `"personally appeared before me"`
- `"being duly sworn"`
- `"the deponent saith"`
- `"on this day came"`

**Probate / inventory:**
- `"appraisers of the estate of"`
- `"administrator of the estate"`
- `"inventory and appraisement"`
- `"sale bill"`, `"vendue"`
- `"widow's dower"`

**Slavery / enslavement** — HURTFUL CONTENT WARNING; necessary research vocabulary only. Raymond, RootsTech 2025 syllabus: *"Researching African American genealogy exposes one to hurtful records of racism and moral corruption. Searching the records may require the use of inappropriate terminology. The author does not condone the use of such terminology outside its necessary use in research."*
- `+Negr*` (catches negro/negroes/negro's/negress/negroe; ~60% coverage)
- `+slave*` (slave/slaves/slaveholder; cumulative 83%)
- `+Freedm?n` (freedman/freedmen; cumulative 92%)
- `+"aged about"` (94%)
- `+"her child"` (96%)
- `+Emanc*` (emancipate/emancipated/emancipation)
- `+Manum*` (manumit/manumitted/manumission — many false positives)
- `+"set free"`, `+mulatto`, `+"black man"`, `+"colored woman"`, `+"male child"`, `+"female child"`
- Spanish: `+esclav*`, `+"de color"`, `+moren*`, `+pard*`, `+"libre de color"`.

**Marriage settlements / antenuptial agreements:**
- `+"in consideration of the marriage"`
- `+"separate use"`
- `+"trustee for"` + spouse's name
- `+"sole and separate property"`

### 3.10 Wildcard / truncation strategies

- **Spelling-uncertain surname:** drop the most-likely-misread letter to `?` (Cole→C?le; Smith→Sm?th; Schmidt→Sch?idt or Sch*).
- **Surname prefix uncertainty (German, Slavic, Dutch):** leading wildcard is NOT supported. Workaround: explicit alternative spellings (`Schmidt`, `Schmitt`, `Schmid`, `Smit`).
- **Surname suffix variation:** `Underhil*`, `Mc*Master*`, `Müll*`.
- **Female maiden uncertainty:** given name + father's surname + place; OR father's full name + the descriptive phrase `"my daughter"`.

### 3.11 Iterative refinement rules

- **Too many hits (>1000):** add `+` to require both terms; add Place filter; add Year Range; add a third unique keyword (occupation, landmark, distinctive item).
- **Too few (<5) or zero:** drop quotes; add wildcard on most-likely-misread letter; try Keyword field if Name field used (or vice versa); try abbreviated given name; remove year filter (collection year ≠ document year); search a related collection by DGS.
- **Stable but wrong matches:** use `-` to exclude noise terms; switch from Keyword to Name field (or vice versa).
- **Place-filter trap:** if results all show the place name highlighted but not the target name, the place is matching either collection metadata or a verbose place mention; remove Place from query string entirely and use ONLY the sidebar Place filter.

### 3.12 Cross-reference triggers (when to spawn a sub-search)

When reading a result, the agent should automatically queue sub-searches for:
- Every named non-target person (witnesses, executors, appraisers, heirs, neighbors).
- Every named place not previously researched.
- Distinctive landmarks ("Buckeye Mountain," "Mill Creek").
- Distinctive inventory items ("silver watch No. 247," brand markings, "red brindle cow").
- Slaveholder ↔ enslaved name pairs (when one is found, search the other).
- Powers of attorney → search the named agent, then search the principal in the OTHER county where the principal currently resides.
- Marginal annotations referencing a later transaction → search the later party.

---

## PART 4 — KNOWN INDEXING AND COVERAGE QUIRKS (2024–2026)

### 4.1 Coverage scope

Per David Ouimette, RootsTech 2026 syllabus ("Your Golden Path to Ancestral Discovery"):
- *"Over 8,000 record collections, defined by place, record type, and time period"* (this is FamilySearch's count of internally-defined auto-collection definitions).
- *"About 2.5 billion images transcribed, with about a billion images added annually"* (this is the underlying transcribed-image total).
- *"Dozens of countries have over ten million transcribed images in Full-Text Search."*
- **Top countries by image volume:** United States, Italy, United Kingdom, Spain, Portugal, Canada, Brazil, Colombia, Australia, Mexico.
- **Top languages:** English, Spanish, Italian, Portuguese, French, Dutch.

**The user-searchable surface is smaller than the internal counts.** Per Randy Seaver's weekly Genea-Musings tracker (1 May 2026): *"there are now 6,665 searchable and full-text transcribed image collections on FamilySearch Full-Text Search this week, an increase of 4 from last week"* with *"over 1.95 BILLION 'results' in the collections."* The collection count has consistently tracked ~6,600–6,700 actively searchable collections through early 2026 (Seaver's weekly readings: 6,650 on 10 Apr, 6,649 on 17 Apr, 6,661 on 24 Apr, 6,665 on 1 May 2026), with **week-to-week deltas typically +4 to +6 (range −2 to +12)**. The FamilySearch blog at the August 2025 Labs graduation framed the size as *"almost 2 billion records from various countries and languages."*

**Annual growth context:** the FamilySearch 2025 Year-in-Review reports *"More than 2.2 billion new searchable names and images in historical records were added in 2025—totaling more than 22.7 billion for the website"* — note this aggregate covers all FamilySearch record types, not FTS-transcribed images alone; Ouimette's *"about a billion images added annually"* refers specifically to FTS.

Top groupings by image count, 24 January 2025 (Raymond, RootsTech 2025 syllabus):

| Group | Images |
|---|---|
| United States Legal | 348,715,895 |
| United States Vitals | 272,125,185 |
| United States Migrations | 168,836,528 |
| United States Land and Probate | 143,723,900 |
| United States Military | 100,801,883 |
| United Kingdom Military | 52,894,890 |
| United Kingdom Legal | 51,351,630 |
| United States Biographical | 47,612,085 |
| Brazil Legal | 34,279,132 |
| Canada Probate | 16,104,505 |
| Colombia Legal | 14,548,864 |
| Australia Probate | 10,514,785 |
| Argentina Legal | 10,056,083 |
| Canada Homestead | 8,863,123 |
| Mexico Various | 7,715,507 |
| New Zealand Probate | 6,386,014 |
| Ireland Residences | 3,893,933 |
| United States Enslavement Related | 2,938,754 |
| Costa Rica Legal | 2,725,439 |
| US Revolutionary War Pensions | 2,287,124 |

### 4.2 HTR vs. OCR distinction

- **HTR (handwriting)**: US Legal, US Probate, US Vitals (handwritten era), Mexico Notary, all colonial-era records, US Revolutionary War Pensions, Plantation Records, Latin American notarial protocols.
- **OCR (typed/printed)**: US Biographical (printed county histories, genealogies), US Migrations (typed 20th-c. passenger lists, naturalization petitions), printed military rolls.
- **Mixed**: US Military pension files (handwritten depositions + typed cover sheets); Australian probate (typed docket + handwritten will).

The same query syntax applies to both. OCR layers tend to be more accurate than HTR but produce errors on broken/faint type and small-font marginal stamps. Raymond emphasizes that the underlying technology *"recognizes a segment of characters, not single characters"* and so is technically not classical OCR.

### 4.3 Known accuracy issues by collection / era

- **Pre-1750 colonial records:** HTR accuracy markedly lower (secretary hand, archaic letterforms, abbreviation density).
- **German-language US records (PA, OH, WI, TX) in Kurrent script:** as of 2026, NOT well-supported; expect very high error rates. Search English transliterations.
- **Latin / Spanish colonial records pre-1700:** procesal and humanística scripts; AI models trained on later Spanish underperform; abbreviations (`q'`, `dho`, `dha`, `Vmd`) often expanded inconsistently.
- **Tabular data (tax lists, slave schedules, payrolls):** column alignment errors; spurious cross-column phrase matches.
- **Microfilm of microfiche of microfilm:** double-photographed records have lower contrast; AI accuracy drops.
- **Bound volumes with gutter shadow:** words near the spine often misread or dropped.
- **Document titles / dates in metadata may not match document content** (Powell): the auto-collection date range comes from metadata, not document content; do NOT exclude possibilities solely because the year filter doesn't match.
- **Empirically, ~10% error rate** in user-perceived results (Brent Trout / MyFamilyPattern testing): *"I find that about 10% of the results are errors. Mostly it's character recognition."*

### 4.4 Geographic / temporal gaps as of mid-2026

- **Mostly absent:** continental European vital records in non-Latin scripts (German Kurrent, Cyrillic, Greek), East Asian (Chinese, Japanese, Korean — though models are *"under development"* per Raymond), Arabic, Hebrew. Raymond: *"FamilySearch holdings come from 159 languages. The research team is working on models for 30 to 40 languages, with the goal of 95% accuracy per language."*
- **Sparse:** Eastern European (Polish, Czech, Hungarian); African; Pacific.
- **Strong:** US deeds and wills 1750–1900; UK Army records 19th c.; Latin American notarial protocols 17th–19th c.; Mexican notarial; US Freedmen's Bureau (post-1865); Revolutionary War pensions; Australian and New Zealand probate.
- **Improving:** Italian civil records (now #2 by volume in 2026 vs. not in top 10 in 2024); Brazilian and Portuguese notarial.

### 4.5 Multi-collection redundancy and opacity

A single record may be findable through multiple paths (FTS, indexed Records search, Catalog browse, Explore Historical Images, Image Group browse, plus possibly a partner site). FTS does NOT deduplicate against indexed Records search results. James Tanner (Family History Guide) warns: *"Particularly, with the Full-text Search and Simple Search functions, there is no way to know what part of the website's collections you have searched."* Agents should treat FTS coverage as **opaque and dynamic** and always log negative results with timestamp and exact query string for periodic re-check.

---

## CONCRETE WORKED EXAMPLES

### Example 1 — All deeds mentioning a 19th-c. farmer (Cornelius Feather, 1777–1853, Westmoreland Co., PA → Trumbull Co., OH → Mercer Co., PA)

```
Step 1 (Name field):  "Cornelius Feather"
Step 2 (Keywords):    +Feather +Cornelius
Step 3 (variants):    Feath* (Feathers, Fether, Fetter); Cornel* (Cornelius, Cornel, Corny, Corn's)
Step 4 (FAN):         +Feather +[known associate surname]
Step 5 (filter):      Place sidebar: US → PA → Westmoreland; then change to PA → Mercer; then OH → Trumbull
Step 6 (period):      Year Range 1795–1855
Step 7 (mineable):    +Feather +"my beloved wife" (testamentary mentions of wife Mary)
Step 8 (margins):     +Feather (no place filter — out-of-state references)
```

### Example 2 — Migration via chains of title (Underhill family NH → NY → OH 1800–1850)

```
Step 1: Name "Underhill" filtered to NH; review deeds 1801–1830
Step 2: For each deed, note (a) co-grantors/grantees, (b) acreage, (c) boundary calls naming neighbors
Step 3: Search each neighbor's surname in NH; build a peer migration cluster
Step 4: Spawn search "Underhill" filtered to NY; cross-check decade 1820s
Step 5: Search the SAME co-migrant surnames in NY same decade; intersection identifies receiving township
Step 6: Repeat for OH 1830s; intersection identifies arrival county
Step 7: For each transition deed, search boundary landmarks ("Mill Creek," "Sugar Loaf") to track properties in receiving deed books
```

### Example 3 — Identify enslaved persons via probate/deeds (Benjamin Pearce, Halifax Co., NC, d. 1810)

**HURTFUL CONTENT WARNING — research-only vocabulary.**

```
Step 1: +"Benjamin Pearce" filtered NC → Halifax County, year 1780–1815
Step 2: +"Benjamin Pearce" +Negr*    → bills of sale, gifts, manumissions
Step 3: +"Benjamin Pearce" +slave*
Step 4: +"Benjamin Pearce" +"last will and testament"
Step 5: When given names appear (e.g., Pheby, Trip, Anna), spawn:
          +Pheby +Halifax filtered NC, decade 1790s   → finds prior enslaver George Scurlock
          +Trip +"George Scurlock"                    → confirms separation and prior ownership
Step 6: +Pheby +"her child" filtered NC               → finds children's names
Step 7: Search post-1865 records: +Pheby OR +Phoebe in collection "United States, Freedmen's Bureau Records, 1734–1968"
Step 8: Cross-reference 1870 census (indexed) for Pheby/Phoebe in Halifax with surname Pearce or Scurlock
```

(Workflow as documented by Robin Foster, Roots Revealed, "A Huge Discovery with FamilySearch's Full-Text Experiment," and Andre Kearns, "Finding Milly: Tracing enslaved ancestors using Experimental Search," RootsTech 2024.)

### Example 4 — Married woman's unknown maiden name (Susan Pannebaker, IL)

```
Step 1: +"Susan Pannebaker"                       → too few; she's rarely a principal
Step 2: +Susan +Pannebaker +"daughter of"         → can hit deeds of distribution
Step 3: +"Susan Pannebaker" +"power of attorney"
Step 4: +Pannebaker +Illinois +"share of inheritance"
Step 5: Found: a Juniata Co., PA POA names "Susan Pannebaker of Bureau Co., IL, daughter of Jacob J. Ulsh"
Step 6: Spawn +"Jacob Ulsh" +Juniata to confirm and gather siblings
```

(Adapted from Price Genealogy / Lineages, "Research Game Changer Part 2.")

### Example 5 — Disambiguate two same-named men (two John Smiths in 1840s Tennessee)

```
Step 1: +"John Smith" filtered TN, decade 1840s   → 600+ hits
Step 2: Toggle Fact View → cluster by co-mentioned places (county, township, creek)
Step 3: Add known wife's given name: +"John Smith" +Sarah   → prunes to ~80
Step 4: Add known associate: +"John Smith" +Wilson          → tighter cluster
Step 5: Exclude irrelevant cluster: -Knoxville              → if known to be in Memphis area
Step 6: Search the boundary description from a known correct deed in other documents to find more deeds for the same property
```

### Example 6 — Latin American notarial research (Francisco García, Mexico City 1820s–1850s)

```
Step 1: Name field: "Francisco García"
Step 2: Place filter: México → Distrito Federal
Step 3: Year Range: 1820–1860
Step 4: Variants: +"Francisco Garcia" (no diacritic)
Step 5: Role keyword: +"Francisco García" +comerciante OR +propietario
Step 6: Use Show Translation on each promising image; use Summarize for triage
Step 7: Spawn searches for each escribano público (notary) named; co-occurring parties are usually local kin/business cluster
```

### Example 7 — Revolutionary War pension file deep dive

```
Step 1: Restrict to collection 5000421 (URL: /search/full-text/collection/5000421)
Step 2: Name field: "Ancestor Name"
Step 3: If empty: try abbreviated forms (Wm, Jno) and surname-only with state filter
Step 4: Widow application: +Ancestor +"widow of" +pension
Step 5: Service-related: +Ancestor +"served as" / +"enlisted"
Step 6: Declaration boilerplate: +Ancestor +"personally appeared"
Step 7: Cross-link with NARA: at https://catalog.archives.gov/id/300022 use "Search within this Series"
```

### Example 8 — Burned-county workaround (Hawkins Co., TN)

```
Step 1: Surname filtered to Hawkins County  → likely sparse
Step 2: Repeat in adjacent counties (Hancock, Sullivan, Greene, Grainger, Claiborne) — often re-recorded lost deeds
Step 3: Search target's surname in next county-up (Knox) and state capital (Nashville/Davidson) — for state land grants
Step 4: +Surname +"Hawkins County" anywhere — captures references in OTHER counties' deeds to a Hawkins-resident party
Step 5: Search store ledgers / account books in nearby towns (e.g., Rogersville)
```

### Example 9 — Property-only trace ("Turnip Creek," 200 acres, "three pines and a red oak")

```
Step 1: +"Turnip Creek"
Step 2: +"Turnip Creek" +"red oak"
Step 3: +"Turnip Creek" +"three pines"
Step 4: +"Turnip Creek" +"200 acres"
Step 5: For each match, identify grantor/grantee → spawn searches for each name
Step 6: Build chain backwards by date until original patent is found
```

### Example 10 — Quaker meeting records in numbered-month era

```
Step 1: +Surname +"monthly meeting"
Step 2: +Surname +"first month"   (catches any year)
Step 3: +Surname +"removed by" / +"removed to"  (Quaker migration certificates)
Step 4: +Surname +"by request"    (membership requests)
Step 5: Filter Place: PA, NJ, NC, OH (heavy Quaker presence)
```

---

## QUICK-REFERENCE CHEAT SHEET (TOP 20 TIPS)

1. **Default is OR.** Always use `+TermA +TermB` (no space after `+`) or risk million-result OR explosions.
2. **Phrases use `"…"` and tolerate one intervening token.** `"Ezekiel Pearce"` matches "Ezekiel John Pearce."
3. **Wildcards: `?` = 1 char, `*` = 0+ chars.** Never inside quotes; never as the first character; ≥3 literal letters recommended.
4. **No proximity operator (`~N`).** Treat any anecdotal `~N` usage as unsupported and unreliable.
5. **Five fields:** Keywords, Name, Place, Year Range, Image Group Number (DGS). Cross-field is AND; within-field is operator-controlled.
6. **Search by name only — apply place/year/record-type via the LEFT-SIDEBAR FILTERS, not by typing them into Place/Year fields up front.** This is the single highest-leverage tactic.
7. **Name field auto-handles last-name-first inversions; Keyword field does not.** Run both.
8. **Place field also matches collection metadata, not just transcript content.** Hence false-positive flood; filter, don't query.
9. **Filters are post-search refinements** — apply after results. Filter PLACE first, then date, then record type.
10. **Set page size to 100** to scroll faster.
11. **Use the Fact View toggle** to extract structured persons/places/dates per result; great for programmatic agents.
12. **Wildcards beat HTR errors:** `Ma?sachusetts` (long-s), `Tu*pike` (rn→m), `C?le` (cole/cale/cele).
13. **Common abbreviations are NOT auto-expanded.** Always run separate Wm/Jno/Jas/Thos/Chas queries.
14. **Stemming is NOT applied.** Use `marri*` to catch marries/married/marriage.
15. **No Soundex / phonetic.** "Stephen Jarman" ≠ "Steven Jarmon"; query both explicitly.
16. **Slavery research:** start with `+Negr*` (60% coverage) → add `+slave*` (cumulative 83%) → `+Freedm?n` (92%). Use the hurtful-content warning workflow.
17. **DGS scoping:** when a collection is known but search returns nothing, paste the Image Group Number into the DGS field and search inside the volume.
18. **Boilerplate phrases are co-occurrence gold:** `+"my beloved wife"`, `+"personally appeared"`, `+"in consideration of"`, `+"last will and testament"`, `+"know all men by these presents"`.
19. **One-image-per-hit:** a multi-image document yields multiple hits. Don't over-count; verify uniqueness by ARK URL.
20. **Always log negative results with timestamp and exact query string.** FTS coverage is opaque and dynamic — collection counts have grown ~+4–6/week in early 2026 (range −2 to +12; per Seaver). Today's miss may be tomorrow's hit; re-run periodic searches.

---

## CAVEATS

- **Documentation gap:** FamilySearch has not officially documented stop words, stemming, diacritic handling, case sensitivity, or hyphenation behavior; the wildcard minimum-character rule, while empirically observed, is documented only for indexed search, not specifically for FTS. Many syntactic claims in this report are based on Robert Raymond's RootsTech 2025 NGS-aligned syllabus and David Ouimette's RootsTech 2026 syllabus, which are the most authoritative semi-official sources.
- **Forward-looking statements are flagged:** Raymond's syllabus discusses planned attach-to-tree improvements and language expansion ("research team is working on models for 30 to 40 languages") — these are aspirations, not guaranteed to ship on any particular timeline.
- **Auto-collection counts and image volumes:** the "8,000+" in Ouimette's syllabus refers to internal collection definitions; the user-facing searchable count (Seaver's tracker) is in the 6,600–6,700 range as of early-to-mid 2026. The discrepancy is real; agents should not infer that all 8,000 are independently searchable from the FTS UI.
- **AI transcription accuracy is imperfect.** Empirical observations cluster around ~10% error rate at the user-perceived result level; cross-column false positives, long-s misreads, and stylized capital-letter errors are systematic. Always view the original image; do not rely on the transcript alone for genealogical proof.
- **The Edit transcription feature was temporarily suspended in April 2026** per a FamilySearch Community announcement; check status before instructing users to correct transcripts.
- **The "Simple Search" natural-language variant (announced December 2025)** is a separate Labs experiment and does NOT use the same operator syntax documented here. Operators in this reference apply to the Full-Text Search UI at `/search/full-text/`, not to Simple Search.