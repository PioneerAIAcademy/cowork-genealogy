# Full-Text Search Query Syntax — FamilySearch

Reference for constructing `fulltext_search` queries. FTS searches
AI-transcribed historical document images, not structured indexes.
Behavior differs fundamentally from indexed Records search.

## Search fields

| Field | Purpose | Notes |
|---|---|---|
| Keywords | Free text against entire transcript | All operators (`+`, `-`, `"…"`, `?`, `*`) work here |
| Name | NLP-recognized person names only | Auto-handles last-name-first inversions ("Mills Alexander" matches "Alexander Mills"). Keywords field does NOT auto-invert. |
| Place | Place name | Matches BOTH transcript content AND collection metadata — major source of false positives. **Prefer filtering by place after search rather than including place in the query.** |
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

## What is NOT supported

- **No Boolean keywords.** `AND`/`OR`/`NOT` are treated as literal
  words. Use `+`, `-` symbols only.
- **No proximity operator (`~N`).** Anecdotally reported but
  unreliable. Do not use.
- **No grouping parentheses.** Treated as literal characters.
- **No stemming.** `marries` does NOT match `married`. Use `marri*`.
- **No phonetic/Soundex matching.** "Stephen Jarman" ≠ "Steven
  Jarmon". Search both explicitly.
- **No abbreviation expansion.** `Wm`≠`William`, `Jno`≠`John`,
  `Jas`≠`James`, `Thos`≠`Thomas`. Run separate queries.
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

## Filters (post-search)

Filters operate on **collection metadata**, not transcript text:

- **Collection** — auto-generated collections (place + record type +
  date range)
- **Year** — by century, then decade. Reflects collection metadata
  date, NOT necessarily the document's actual date.
- **Place** — hierarchical (country → state → county). Reflects
  collection metadata place, NOT places mentioned in the document.
- **Record Type** — deeds, probate, court, vital, military, etc.

**Critical rule:** Apply place and date via filters AFTER the initial
search, not by typing into Place/Year fields. This avoids false
positives from collection-metadata matching.

**Filter order:** Place first, then year, then record type.

## Hit-count interpretation

- Hits are **per-image-mention**, not per-document. A multi-page
  document generates multiple hits.
- A query returning millions of results means OR default is in
  effect — switch to `+TermA +TermB`.
- Some matches won't appear in snippets when the term is in the
  full transcript but not the displayed excerpt.

## Unit of indexing

The unit is the **IMAGE**, not the document. A deed spanning two
microfilm images yields two separate results. Deduplicate by
ARK URL.
