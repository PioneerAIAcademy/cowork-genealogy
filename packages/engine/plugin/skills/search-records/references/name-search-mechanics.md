# Name Search Mechanics — FamilySearch Records API

Reference for constructing name parameters in `record_search` queries.
Examples are written in the upstream API's own `q.*` syntax; the tool
takes **camelCase** parameters. Crosswalk:

| API syntax | `record_search` parameter |
|---|---|
| `q.surname` / `q.givenName` | `surname` / `givenName` |
| `q.surname.1` / `q.givenName.1` | `surnameAlt` / `givenNameAlt` |
| `q.surname.exact=on` | `surnameExact: true` |
| `q.givenName.exact=on` | `givenNameExact: true` |
| `q.surname.exact.1=on` | covered by `surnameExact` when `surnameAlt` is set |
| `q.<relative>GivenName` / `q.<relative>Surname` | `<relative>GivenName` / `<relative>Surname` — `spouse`, `father`, `mother`, `parent`, `other` |
| `q.sex` | `sex` |

**`surnameExact` and `givenNameExact` are narrower than they sound and
are usually the wrong reach** — they change how many results come back,
they re-shuffle the ones they keep, and on a misspelled
index they can drop the
target outright. See "Default fuzzy matching" below and
`docs/specs/record-search-tool-spec-v2.md` § "What `.exact=on` actually
does" (repo-side; not readable from here — the summary below is the
operative version).

## Wildcards

| Wildcard | Meaning | Rules |
|---|---|---|
| `*` | Zero or more characters | Allowed at start, middle, or end (`*bou` is valid — measured). |
| `?` | Exactly one character | May appear at any position (e.g., `q.surname=Sm?th`). |

**Constraints — two long-standing ones did not survive measurement:**
- ~~Minimum 3 non-wildcard letters per name field~~ — **not enforced.** A
  two-letter stem (`Sm*`) was accepted and expanded *more* broadly than a
  three-letter one (`Smi*`), which is the comparison that shows the wildcard was
  honoured rather than quietly dropped.
- ~~Up to four `*` per name field~~ — **not enforced.** A five-star pattern was
  accepted and returned a different count from its four-star prefix, so the
  fifth star bound.
- **Wildcards + `.exact=on`: the wildcard still expands, and the variant
  interpretation is what switches off.** Now measured rather than asserted, by
  reading whole pools rather than sampling them: in a scope small enough to read
  in full, a fuzzy `Smith` search contained every one of the `Smyth` records in
  that scope, `Smith` + `surnameExact` contained none of them, and `Sm?th` +
  `surnameExact` contained them all again. So exactness removes the spelling
  variants and leaves the pattern match intact — the two mechanisms are
  independent.
- ~~Wildcards disabled in Ellis Island collections~~ — **refuted.** Inside the
  Ellis Island passenger collection, a one-character wildcard on a rare surname
  returns both spellings it can match, and every record of the bound spelling
  reappears in the wildcard's results — checked by reading both sets in full,
  not by sampling them. Wildcards work there; use them.
- ~~In place parameters, wildcards work only in the innermost jurisdiction
  level~~ — **refuted, and the rule has the wrong shape.** A wildcard placed at
  the innermost, middle, or outermost level of a place string returns the same
  total to within a rounding error, so the level is irrelevant. It is not simply
  ignored either — a wildcarded place still filters hard, and to something much
  narrower than the same place written literally. What it actually resolves to is
  **not established**, so treat a wildcard in a place parameter as unpredictable
  and prefer an explicit place name.

## Default fuzzy matching (without `.exact=on`)

Without `.exact=on`, the API auto-applies:
- **Diacritic stripping:** "RENÉE" matches "Renee"
- **Case insensitivity**
- **Space/punctuation ignored:** "MacDonald" = "Mac Donald";
  "O'Hara" = "OHara"
- **Standardized given-name variants:** Wm→William, Margt→Margaret,
  Eliz→Elizabeth, Robt→Robert, Geo→George, Jno→John, Thos→Thomas
- **Some common nicknames:** Peggy↔Margaret, Polly↔Mary, Dick↔Richard,
  Jack↔John, Bill↔William. **Fuzzy does reach these** — measured
  2026-08-08 by id-level membership test: `Betty` records are returned
  by a fuzzy `Elizabeth` search, `Peggy` by `Margaret`, and `Polly` by
  `Mary` (8 of 8 across 3 populations). Only those three diminutives
  were membership-tested. What varies is **rank**, not coverage — see
  "Common nickname equivalences" below before assuming a search has
  surfaced them.
- **Phonetic/edit-distance spelling variants** (algorithm unpublished).
  This is the mechanism that bridges an index misspelling — `Neal` finds
  a record indexed `Neill` — and it is the main reason a surname search
  should stay fuzzy.
- **Soundex** is part of default fuzzy (no separate toggle)

Adding `.exact=on` to a name parameter disables all of the above for
that parameter. Each parameter can be set to exact independently
(e.g., exact surname with fuzzy given name). **Disabling it is rarely
what you want:** it narrows the count, and it re-shuffles the records it
keeps — but it cannot bring back a record the fuzzy search buried. Read over
whole result sets on a rare surname, every record the exact search returned
was already in the fuzzy one's: it is a subset, so it only ever subtracts.
(Measured on the surname qualifier, in marriage records.) It also switches off
the misspelling bridge above. On one measured case, `surname: "Neal"`
with `surnameExact` returned **0** where the fuzzy search returned the
target. Reach for it only when you have confirmed how the index spells
the name, or when you need a defensible count for an exhaustiveness
claim.

## Surname-only and given-name-only

- **Surname only:** Allowed. Recommended when given name was indexed
  as "Baby," "Infant," or initials.
- **Given name only:** Not allowed standalone — requires at least one
  other parameter (place, date, parent, spouse).

## Initials

- `q.givenName=J*` — the three-letter minimum this once cited is **not enforced** (see Constraints above; measured on `q.surname`). Whether a one-letter given-name stem behaves the same was not measured.
- `q.givenName=J W` works as a literal match against records indexed
  with initials
- Use `.exact=on` on the given name when searching initials

## Middle names

The given-name parameter is multi-token. Search order is ignored
(with single surname). Include middle name when known — some records
index "John W. Smith" only as "John W" or "John William."

## Quoted values

When a name value contains a space, quote it in the API parameter:
`q.givenName="Sally Mae"`. Single-token names need no quotes.

**Boolean AND/OR/NOT and plus/minus operators are NOT supported** in
indexed Records search parameters.

## Common indexing error patterns

These patterns arise from handwriting misreads in the indexing process.
Use wildcards to compensate.

| Original handwriting | Common misreadings | Wildcard strategy |
|---|---|---|
| Capital `S` (cursive, looped) | `L`, `J`, `T` | `?mith`, `?ones` |
| Capital `F` | `T`, `J`, `S` | `?inley` |
| Lowercase `n` | `u`, `v` | `Hu?ter`, `Pe??y` |
| Lowercase `u` | `n`, `v` | `Bru?n`, `Ba?er` |
| Long `s` (ſ) | `f`, `F` | `Wa?on`, `Bi?op` |
| Double `s` (ſs) | `fs`, `B`, `S` | `Ros?` |
| `e` / `o` | each other | `Sm?th`, `H?lmes` |
| `a` | `o`, `u`, `e` | `H?rt`, `J?nes` |
| `r` / `n` | each other | `Ba?ker` |
| `c` / `e` / `t` | each other | `Mi?hael` |
| `i` / `j` / `l` / `1` | each other | `?ohnson` |
| `h` / `k` | each other | `?ane` |

**Other patterns:**
- Suffixes (Jr., Sr., II, III) commonly dropped — search without
- Prefixes (von, van, de, Mc/Mac) normalized or dropped — try with
  and without; try contracted (M' for Mc) and expanded forms
- Hispanic dual surnames misordered — try `q.surname=García` and
  `q.surname=López` separately
- Female names: US records use married surname; Spanish/Italian
  preserve maiden; Quaker/Scandinavian use patronymics
- "Willm" / "Will'm" may not standardize to William — search both

## Common nickname equivalences

**Fuzzy reaches the diminutives it was tested on; rank, not coverage,
decides whether you see them.** Measured 2026-08-08 (qualifier probe,
section E — host-side): every one of the eight diminutive records came back from
the fuzzy search for its formal name, across Elizabeth→Betty, Margaret→Peggy and
Mary→Polly. But each was ranked only within its own pool: two of the eight fell
inside a 500-deep scan, both in a pool of about a thousand, the better of them
in the mid-300s; the other six were not seen within that scan at all, in pools
of tens of thousands and up. `record_search` returns 20
results per page by default (50 with `subjectId`), max 100 — so even the
best-ranked case is invisible unless you deliberately page a few hundred deep.
Narrowing is what makes one visible: with the query narrowed onto the surname,
a bound `Betty` record was present around the middle of a couple-hundred-row
set that was read to the end.

**Every other row below is untested**, and the cross-language entries
(`Hans`/`Honza` for John, `Diego` for James, `Paco` for Francis) are a
different mechanism — do not assume fuzzy bridges those.

**Search the other name as its own `givenName` value.** Nothing you can
set widens the expansion — `givenNameExact` only narrows it — so when the
pool is too large to scan, asking for the diminutive directly is the only
move that guarantees you see it. A top-N sample cannot tell you otherwise:
it cannot distinguish ABSENT from OUTRANKED.

**Mind the direction.** Your tree usually holds the **formal** name
while the record may be indexed under the **nickname**, so the move that
recovers the record is normally formal → nickname: search `Betty` when
the tree says `Elizabeth`. (An earlier revision of this file advised the
reverse — "try formal names explicitly when fuzzy doesn't produce
results" — which restates the search you have already run. The reverse
case is real but rarer: a source gave you a familiar name and the record
indexed the formal one.)

A christening or baptism is among the entries *least* likely to use the
familiar form: the register records the formal baptismal name, often
Latinised. Familiar forms surface later — in censuses, which recorded
whatever the household said aloud, and in civil registration, wills and
gravestones.

| Formal | Nicknames seen in records |
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
