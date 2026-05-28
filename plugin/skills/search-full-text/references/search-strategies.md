# Full-Text Search Strategies — FamilySearch

Strategies for constructing and iterating `fulltext_search` queries.
FTS does not auto-expand abbreviations or apply phonetic matching —
the agent must generate variants explicitly.

## When to use FTS vs. indexed Records search

| Scenario | Tool |
|---|---|
| Known name + indexed event (BMD, census, vital) | Indexed `record_search` |
| Person mentioned as witness, neighbor, heir, surety, appraiser | **FTS** |
| Pre-1850 US research with thin indexed coverage | **FTS first** |
| Latin American notarial protocolos | **FTS strongly preferred** |
| Narrative paragraph records (court minutes, meetings) | **FTS** |
| Burned-county research | **FTS in adjacent counties** |

FTS uniquely surfaces: witness signatures on deeds, estate appraisers
and bondsmen in probate, heirs-at-law in wills, sureties and guardians,
powers of attorney in distant counties, chains of title, enslaved
persons' given names, marginalia, tax-list and store-account entries.

## Core tactic: name only → filter

Search a name (or surname + contextual keyword), then filter by
Place → Year → Record Type using post-search filters. Do NOT put
place in the initial query — it causes false positives from
collection-metadata matching.

## Decision tree by hit count

```
0 results     → drop place; try Keywords field; try wildcards
1–50 results  → review all
50–500        → add Year/RecordType filter
>500          → add second required term (+associate, +occupation)
```

**Still 0 after above:**
1. Try given name in Keywords + surname in Keywords (separate `+`)
2. Try surname only + place filter
3. Try abbreviations (Wm, Jno, Jas, Thos, Chas)
4. Try wildcards on likely-misread letters
5. Try last-name-first phrase: `"Surname Given"`
6. Try maiden vs. married surname for women
7. Try an Image Group Number-scoped search of the most likely volume
8. Try keyword-only search of boilerplate phrases + place filter

**Still 0:**
- Verify the collection is in FTS (coverage is not complete)
- Fall back to manual image browsing
- Log negative result with exact query

## Name variant queries (must run explicitly — no auto-expansion)

| Formal | Abbreviations to search separately |
|---|---|
| William | Wm, Wm., Will. |
| John | Jno, Jno., Jn° |
| James | Jas, Jas., Js |
| Thomas | Thos, Thos., Tho. |
| Charles | Chas, Chas., Cha. |
| Robert | Robt, Robt., Rob. |
| Richard | Richd, Richd., Rich. |
| Samuel | Saml, Saml., Sam. |
| Joseph | Jos, Jos. |
| Benjamin | Benj, Benj., Benjm. |
| Henry | Hy, Hy. |
| George | Geo, Geo. |
| Margaret | Margt, Margt., Marg. |
| Elizabeth | Eliz, Eliz., Elizth. |

Also search nicknames: Peggy/Margaret, Polly/Mary, Sally/Sarah,
Bill/William, Dick/Richard, Jack/John, etc.

**Cross-language equivalences (for ecclesiastical/colonial records):**
- Latin: Joannes↔John, Iacobus↔James, Petrus↔Peter,
  Henricus↔Henry, Carolus↔Charles
- Spanish: Diego/Santiago↔James, Catalina↔Catherine,
  Guillermo↔William
- German: Johann/Hans↔John, Wilhelm↔William, Heinrich↔Henry,
  Friedrich↔Frederick

## Phrase and reordering variants

For target "John Henry Smith," try progressively:
1. `+"John Smith"` (slop allows middle name)
2. `+"John Henry Smith"`
3. `+"John H Smith"` and `+"J H Smith"`
4. Name field: `"Smith, John"` (auto-inverts)
5. Keywords field: `+"Smith John"` (does NOT auto-invert)
6. `+John +Smith +Henry` (arbitrary co-occurrence)
7. Surname only with place filter: `+Smith`

## FAN / co-occurrence searches

The unique value proposition of FTS. Search for:
- Target + associate surname: `+"John Rodgers" +Caldwell`
- Target + spouse maiden surname: `+Brewer +Gay`
- Target + occupation: `+Davis +blacksmith`
- Target + neighbor's distinctive item: `+Cochran +"silver watch"`
- Target + landmark: `+Rodgers +"Turnip Creek"`

## Exclusion searches

- Disambiguate same-named people: `+"John Smith" +Pennsylvania -Ohio`
- Famous-figure collisions: `+Lincoln +Kentucky -Abraham -President`
- Common-word surname: `+Rice -paddy -planting`

## Place-name variants to try

- Pre-split parent counties (e.g., for post-1842 Catawba Co., NC,
  also search parent Lincoln Co.)
- Variant forms: "Lauderdale Co.", "Lauderdale County", "County of
  Lauderdale"
- State abbreviations: "Ala.", "Va.", "Virga", "N.C.", "No. Caro."
- Spelling variants: Pittsburgh/Pittsburg, Worchester/Worcester
- Historical jurisdictions: "British North America" (pre-1867
  Canada), "New Spain" (pre-1821 Mexico)

## Date variants to try

- Year as keyword: `1834`
- Written-out: `+"twenty-fifth day"`, `+"day of August"`
- Quaker dates: `+"first month"`, `+"7th day of the 9th month"`
- Abbreviated: `25 Augt`, `Septr 1834`, `Xber` (December)
- Use Year Range filter for ranges; do NOT force year as keyword
  unless searching for a specific recorded date

## Boilerplate phrase searches

Co-locates with target names and survives HTR errors better than
personal names.

**Wills:** `"being of sound mind"`, `"to my beloved wife"`,
`"unto my son"`, `"I give and bequeath"`, `"Last Will and Testament"`,
`"residue and remainder of my estate"`

**Deeds:** `"know all men by these presents"`,
`"in consideration of the sum of"`, `"to have and to hold"`,
`"sealed and delivered in the presence of"`

**Court/depositions:** `"personally appeared before me"`,
`"being duly sworn"`, `"the deponent saith"`

**Probate:** `"appraisers of the estate of"`,
`"administrator of the estate"`, `"inventory and appraisement"`

**Slavery research** (hurtful content warning — research vocabulary):
- `+Negr*` (~60% coverage) → `+slave*` (cumulative 83%) →
  `+Freedm?n` (cumulative 92%)
- `+"aged about"`, `+"her child"`, `+Emanc*`, `+Manum*`
- Spanish: `+esclav*`, `+"de color"`, `+moren*`

## Iterative refinement

- **Too many (>1000):** add `+` to require terms; add Place filter;
  add Year Range; add third keyword
- **Too few or zero:** drop quotes; add wildcards; try Keywords
  instead of Name field (or vice versa); try abbreviations; remove
  year filter (collection year ≠ document year)
- **Wrong matches:** use `-` to exclude noise; switch Name↔Keywords

## Cross-reference triggers

When reading a result, queue sub-searches for:
- Every named non-target person (witnesses, executors, appraisers)
- Every named place not previously researched
- Distinctive landmarks, inventory items, or brand markings
- Slaveholder ↔ enslaved name pairs
- Powers of attorney → search named agent and principal
- Marginal annotations referencing later transactions
