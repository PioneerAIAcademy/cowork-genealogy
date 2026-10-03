# Full-Text Search Query Syntax — FamilySearch

Reference for constructing `fulltext_search` queries. FTS searches
AI-transcribed historical document images, not structured indexes.
Behavior differs fundamentally from indexed Records search.

## Search fields

| Field | Purpose | Notes |
|---|---|---|
| Keywords | Free text against entire transcript | All operators (`+`, `-`, `"…"`, `?`, `*`) work here |
| Name | NLP-recognized person names only | Auto-handles last-name-first inversions ("Mills Alexander" matches "Alexander Mills"). Keywords field does NOT auto-invert. |
| Place | Place name | Matches collection metadata only — NOT transcript text. Causes false positives because a document's actual place may differ from the collection's place metadata. **Prefer filtering by place after search rather than including place in the query.** |
| Year Range | Numeric range | Matches AI-recognized years in transcript and/or collection metadata. Documents often contain multiple dates. |
| Image Group Number | Restrict to one digitized volume | Enter without leading zeros. Combine with keywords to scan one volume. |

**Cross-field semantics:** If multiple fields are specified, results
must match ALL fields. Within a field, operators control which terms
are required.

## Operators

| Operator | Example | Behavior |
|---|---|---|
| (none) | `Ezekiel Pearce` | **OR** — results contain at least one term. Produces large hit counts. |
| `+` | `+Ezekiel +Pearce` | **Require** — term must appear. No space between `+` and term. |
| `-` | `+Ezekiel +Pearce -Pierce` | **Exclude** — omit results containing this term. |
| `"…"` | `+"Ezekiel Pearce"` | **Phrase** with one-word slop — matches "Ezekiel John Pearce" too. |
| `?` | `Ezeki?l` | Single-character wildcard. |
| `*` | `execut*r*` | Multi-character wildcard (zero or more). Matches executor, executrix, executors, etc. |

**Multiple required phrases:** `+"phrase one" +"phrase two"` works.

## Compound (double) surnames — Iberian / Latin-American names

For the naming convention itself — how the surnames are ordered, what
`de` and `y` do, whether a wife takes her husband's name, how the
practice differs by region and how emigrants' names were changed — read
the jurisdiction's own page rather than working from memory:

```
wiki_read({ url: "https://www.familysearch.org/en/wiki/Spain_Naming_Customs" })
wiki_read({ url: "https://www.familysearch.org/en/wiki/Portugal_Naming_Customs" })
```

What follows is the **query** rule, which is ours: the wiki describes the
names, not how to search a transcript index for them.

A name of the form `Given Paterno Materno` (e.g. "Francisco **Naveda
Somarriba**") carries the father's surname *and* the mother's surname.
To find the **parents**, require the two surnames as a **co-occurrence**,
not a phrase:

- ✅ `+Naveda +Somarriba` — both must appear, in any position. This is
  the form that reaches the parentage records.
- ❌ `+"Naveda Somarriba"` — the phrase (even with one-word slop) only
  matches where the *child's own* compound name is written out
  contiguously. It misses the parentage records — exactly the ones you
  want.
- Once the mother's fuller form is known, `+"Somarriba González"
  +Naveda` trims noise while still requiring the father's surname.

**Why the phrase fails, stated precisely.** In the **father's** own
records he is named with his paternal surname and the mother with hers,
so the two words sit on different people and are not adjacent. Do not
generalise that to "the two surnames never appear adjacent" — they can.
A married woman is routinely written with her own surnames plus her
husband's ("María Somarriba de Naveda"), so adjacency is available on
her, and the wiki page above describes the forms that produce it. The
co-occurrence is still the right query: it matches the adjacent case too,
and the phrase does not match the non-adjacent one.

When in doubt which word is paternal and which maternal, run the
co-occurrence — it does not care about order.

## Scoping FTS to a collection ID

The FTS corpus is partitioned into its **own** auto-generated collections
that do **not** line up with `record_search` collection IDs or a
`collections_search` survey. A `collectionId` borrowed from those sources
frequently excludes the very FTS volume that holds the answer, silently
returning zero.

**Safe path — use `includeFacets: true` on the first call.** When
`includeFacets: true`, the response includes a `facets` array. Find the
**Collection** group in `facets`; each item in that group carries a
`filterParam` string — the exact `collectionId` value to pass on a scoped
follow-up call. That value is safe because it names a real FTS partition
that already returned hits.

```
# Step 1: unscoped, with facets
fulltext_search({ keywords: "+Flynn +Patrick", includeFacets: true, projectPath })
# Step 2: scoped to one facet-derived partition
fulltext_search({ keywords: "+Flynn +Patrick", collectionId: "<filterParam from the Collection group in facets>", projectPath })
```

**Never borrow a `collectionId` from `record_search` or `collections_search`.**
Search the whole corpus first; narrow only via `recordPlace*` / `recordType` /
year-range filters, a known `imageGroupNumber`, or a `collectionId` taken from
`includeFacets` results.

## What is NOT supported

- **No Boolean keywords.** `AND`/`OR`/`NOT` are treated as literal
  words. Use `+`, `-` symbols only.
- **No proximity operator (`~N`).** Anecdotally reported but
  unreliable. Do not use.
- **No grouping parentheses.** Treated as literal characters.
- **No stemming.** `marries` does NOT match `married`. Use `marri*`.
- **No phonetic/Soundex matching.** "Stephen Jarman" ≠ "Steven
  Jarmon". Search both explicitly.
- **No abbreviation expansion** in `keywords` and `place` fields.
  `Wm`≠`William`, `Jno`≠`John`, `Jas`≠`James`, `Thos`≠`Thomas`. Run
  separate queries. Call `get_name_variants` first to build an explicit
  given-name variant list; run each variant as a separate query.
- **Case insensitive** — confirmed.
- **Diacritic insensitivity** — partial; generally works for
  Spanish/Portuguese but coverage is uneven.

## Wildcard rules

- `?` = exactly one character; `*` = zero or more characters
- **Cannot appear inside quotes:** `"Eben* Mills"` does not work
- **Cannot be the first character of a term:** `*Smith` is invalid
- Multiple wildcards per term allowed: `Sm?th??`
- Best practice: ≥3 literal characters per wildcard term
- Up to four `*` per term
- **Combining `?` and `*` to cover variants of different lengths:** put `?`
  where exactly one letter differs, and a trailing `*` where the ending is
  optional/variable-length — `*` must trail, not lead into a fixed suffix.
  To cover Flynn/Flinn/Flyn/Flynne in one term: `Fl?n*` (`?` covers y-vs-i,
  trailing `*` covers "nothing" or "ne"). **NOT** `Fl*nn`: `*` before a
  fixed `nn` suffix requires the string to literally END in "nn", which
  excludes Flyn (ends in one "n") and Flynne (ends in "e").

## Filters (post-search)

Filters operate on **collection metadata**, not transcript text:

- **Collection** — auto-generated collections (place + record type +
  date range)
- **Year** — by century, then decade. Reflects collection metadata
  date, NOT necessarily the document's actual date.
- **Place** — hierarchical (country → state → county). Reflects
  collection metadata place, NOT places mentioned in the document.
- **Record Type** — deeds, probate, court, vital, military, etc.

**Scoping guidance:** Place filters match collection metadata — that is
the useful place to narrow. Use `recordPlace*` when the plan item or
the user names a jurisdiction. Date (`yearFrom`/`yearTo`) and record
type are allowed too, but collection metadata dates can be off (see
references/transcription-quirks.md's "Auto-collection dates/places come
from metadata, not document content"), so apply them more cautiously.
**If a filtered search returns zero results, re-run it without that
filter before logging anything as not found.**

**Filter order:** Place first, then year, then record type.

## Hit-count interpretation

- Hits are **per-image-mention**, not per-document. A multi-page
  document generates multiple hits.
- A query returning millions of results means OR default is in
  effect — switch to `+TermA +TermB`.
- `highlightTerms` lists the bare terms a result matched on, not a
  marked-up excerpt of surrounding text — and once a search is staged,
  the full transcript isn't available to check context directly.

## Unit of indexing

The unit is the **IMAGE**, not the document. A deed spanning two
microfilm images yields two separate results. Deduplicate by
ARK URL.
