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
not which ones rank first, and on a misspelled index they can drop the
target outright. See "Default fuzzy matching" below and
`docs/specs/record-search-tool-spec-v2.md` § "What `.exact=on` actually
does".

## Wildcards

| Wildcard | Meaning | Rules |
|---|---|---|
| `*` | Zero or more characters | Up to four `*` per name field. Allowed at start, middle, or end (`*bou` is valid). |
| `?` | Exactly one character | May appear at any position (e.g., `q.surname=Sm?th`). |

**Constraints:**
- Minimum 3 non-wildcard letters per name field
- Wildcards + `.exact=on`: wildcard still expands but no additional
  variant interpretation is applied to the matches
- **Wildcards disabled in Ellis Island collections** — use explicit
  spelling variants instead
- In place parameters, wildcards work only in the innermost
  jurisdiction level

## Default fuzzy matching (without `.exact=on`)

Without `.exact=on`, the API auto-applies:
- **Diacritic stripping:** "RENÉE" matches "Renee"
- **Case insensitivity**
- **Space/punctuation ignored:** "MacDonald" = "Mac Donald";
  "O'Hara" = "OHara"
- **Standardized given-name variants:** Wm→William, Margt→Margaret,
  Eliz→Elizabeth, Robt→Robert, Geo→George, Jno→John, Thos→Thomas
- **Some common nicknames:** Peggy↔Margaret, Polly↔Mary, Dick↔Richard,
  Jack↔John, Bill↔William. **Coverage here is partial and not
  inspectable** — measured 2026-08-04, fuzzy `Elizabeth` reached `Eliza`
  and `Betsy` but not `Betty`, which had 105 records in the same result
  window. Treat the nickname table further down as a list of names to
  *search*, not a list fuzzy has already covered for you.
- **Phonetic/edit-distance spelling variants** (algorithm unpublished).
  This is the mechanism that bridges an index misspelling — `Neal` finds
  a record indexed `Neill` — and it is the main reason a surname search
  should stay fuzzy.
- **Soundex** is part of default fuzzy (no separate toggle)

Adding `.exact=on` to a name parameter disables all of the above for
that parameter. Each parameter can be set to exact independently
(e.g., exact surname with fuzzy given name). **Disabling it is rarely
what you want:** it narrows the count without changing which records
rank first, so it cannot surface a buried record — and it switches off
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

- `q.givenName=J*` is rejected (fails 3-letter minimum)
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

**Fuzzy matching covers some of this table, not all of it, and you
cannot tell which from the outside.** Measured 2026-08-04: a top-100
sample of fuzzy `givenName: Elizabeth` returned `Elizabeth:72 Eliza:14
Betsy:10` — two of the nicknames below — and **no `Betty`**, while a
search for `Betty` surfaced 105 such records in the same window. Fuzzy
matching does reliably bridge standardized *abbreviations* (`Wm` →
`William`, `Eliz` → `Elizabeth`; see the default-fuzzy list above), so
the gap is specifically in nickname coverage.

**Search the other name as its own `givenName` value.** Nothing you can
set widens the expansion — `givenNameExact` only narrows it further —
so a nickname the index used and fuzzy did not reach is only reachable
by asking for it directly.

**Mind the direction.** Your tree usually holds the **formal** name
while the record may be indexed under the **nickname**, so the move that
recovers the record is normally formal → nickname: search `Betty` when
the tree says `Elizabeth`. (An earlier revision of this file advised the
reverse — "try formal names explicitly when fuzzy doesn't produce
results" — which restates the search you have already run. The reverse
case is real but rarer: a source gave you a familiar name and the record
indexed the formal one.)

A christening or baptism is the entry most likely to use the familiar
form, because it recorded what the family called the child.

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
