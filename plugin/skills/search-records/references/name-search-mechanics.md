# Name Search Mechanics — FamilySearch Records API

Reference for constructing name parameters in `search` queries.
All examples use API query parameters (`q.*`).

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
- **Common nicknames:** Peggy↔Margaret, Polly↔Mary, Dick↔Richard,
  Jack↔John, Bill↔William
- **Phonetic/edit-distance spelling variants** (algorithm unpublished)
- **Soundex** is part of default fuzzy (no separate toggle)

Adding `.exact=on` to a name parameter disables all of the above for
that parameter. Each parameter can be set to exact independently
(e.g., exact surname with fuzzy given name).

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

Auto-applied in fuzzy search but may fail on partial standardizations.
Try formal names explicitly when fuzzy doesn't produce results.

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
