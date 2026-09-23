# Full-Text Search Strategies — FamilySearch

Strategies for constructing and iterating `fulltext_search` queries.
FTS `keywords` and `place` fields do not auto-expand abbreviations or
apply phonetic matching — the agent must generate variants explicitly
for those fields. The `name` field auto-expands recognized English
given names with historical diminutives.

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
7. Try DGS-scoped search of the most likely volume
8. Try keyword-only search of boilerplate phrases + place filter

**Still 0:**
- Verify the collection is in FTS (coverage is not complete)
- Fall back to manual image browsing
- Log negative result with exact query

## Name variant queries for keywords/place (must run explicitly — no auto-expansion)

The `name` field auto-expands recognized given names. The table below
applies only to `keywords` and `place` searches.

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

**Cross-language equivalences (for ecclesiastical/colonial records).**
Read the word list for the record's language rather than recalling
equivalents — these lists are long, and a half-remembered handful is how
a variant search misses the one spelling the clerk used:

```
wiki_read({ url: "https://www.familysearch.org/en/wiki/Latin_Genealogical_Word_List" })
wiki_read({ url: "https://www.familysearch.org/en/wiki/Spanish_Genealogical_Word_List" })
wiki_read({ url: "https://www.familysearch.org/en/wiki/German_Genealogical_Word_List" })
```

Substitute the language actually in the record; the slug is
`{Language}_Genealogical_Word_List`. Run each equivalent you take from
the list as its own query — the `keywords` and `place` fields do not
expand anything.

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

### Compound-surname parentage (Iberian / Latin-American)

When the subject's own name is `Given Paterno Materno` (e.g. "Francisco
**Naveda Somarriba**"), the two surnames are the father's and the
mother's. The convention itself — ordering, `de` and `y`, regional
variation, what happened to the name on emigration — is on the
jurisdiction's `{Country}_Naming_Customs` page; read it rather than
reciting it.

To find the parents, **decompose the compound into a co-occurrence** —
`+Naveda +Somarriba` — and run it **unscoped** (no `collectionId`; the
answer often sits in a different FTS collection than you'd guess). Do
**not** search the adjacent phrase `+"Naveda Somarriba"`: in the
**father's** own records he carries the paternal surname and the mother
the maternal one, so those words sit on separate people and are not
adjacent, and the phrase form matches only where the child's compound
name is written out. It is not true that the two surnames never appear
adjacent — a married woman is often written with her own surnames plus
her husband's ("María Somarriba de Naveda"). The co-occurrence is still
the right query, because it matches that case as well.

Escalate precision as you learn the names:
1. `+Naveda +Somarriba` (both surnames required, unscoped).
2. `+"Somarriba González" +Naveda` (mother's fuller form once known).
3. `+Naveda +Somarriba +Limpias` (add the parish once a locality is in
   hand) — or apply the place *filter* rather than a keyword.

**Two register forms the `{Country}_Naming_Customs` page does not carry.**
Measured 2026-09-23 against the live corpus: `Spain_Naming_Customs` covers the
four-part name, `de`/`y`/`e`, and emigrant reversal, and carries neither of
these. They stay here under ADR-0012's provision for craft the wiki
demonstrably lacks.

- The maternal surname is often written with the particle **`de la`** —
  `María de la Somarriba` for `María Somarriba`. The clerk wrote it and the
  transcription preserves it, so an entry carrying it will not match a query
  for the bare surname.
- The paternal surname appears in a **plural form** in a minority of entries —
  `Navedas` for `Naveda`, `Gonzáles` for `González`. Both forms occur for the
  same household, sometimes in consecutive acts.

Search both separately; the singular alone misses the acts that use the other.

This is the single highest-yield move for "where was X from / who were
X's parents" when X emigrated and the destination records only say
"native of Spain": the origin-country parish acts naming both parents
are reachable by the surname co-occurrence even when X's own baptism is
unindexed.

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
- Historical jurisdictions: the name the place carried in the record's
  own era is frequently not its modern one. Read the country's
  `{Country}_Genealogy` page (and its historical-geography page where it
  has one) for the names and dates rather than working from memory, then
  search each name as its own variant.

## Date variants to try

- Year as keyword: `1834`
- Written-out: `+"twenty-fifth day"`, `+"day of August"`
- Quaker dates: `+"first month"`, `+"7th day of the 9th month"`. The
  numbering shifted when the year start moved in 1752, so the same month
  name maps to two different numbers either side of it — `wiki_search`
  for "Quaker dates" returns the conversion chart. Do not convert one
  from memory.
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
- Widen in this order, which is the order of observed yield:
  `+Negr*` → `+slave*` → `+Freedm?n`. Each adds records the one before
  it missed, so run them as separate searches rather than stopping at the
  first. No probe in this repo measures their coverage, so no percentage
  is quoted here — treat the ordering as a tactic, not a statistic.
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
