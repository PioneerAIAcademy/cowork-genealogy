# Collection-Specific Indexing Quirks — FamilySearch Records API

Read this reference when searching a specific collection family.
Quirks affect how queries should be constructed for that collection.

## US Federal Censuses (1790–1940)

- Indexed by community volunteers; mostly accurate but cursive
  handwriting causes common transcription errors: S/L, F/T, n/u,
  U/V confusions; double-S misread as F or "long s"
- **Compensation:** Use surname wildcards (`q.surname=Sm?th`);
  search by neighbors; for unindexed enumeration districts, switch
  to image browsing
- Collection-specific forms expose extra fields (Residence Year
  locked to census year, Race, Marital Status, 1935 Residence for
  1940 census)

## England parish registers (IGI Community Indexed)

- Pre-1837 parish records extracted decades ago — static "Legacy"
  collections with no updates or corrections since 2010 publication
- **Compensation:** Search by IGI batch number (`q.batchNumber`)
  to enumerate a parish exhaustively; cross-check with FreeREG and
  FindMyPast
- Batch number format: letter prefix + exactly 6 digits (e.g.,
  `C050761`). Left-pad with zeros if needed.
- Submitting batch number alone (no name) returns all extracted
  records in alphabetical order — canonical way to enumerate every
  christening or marriage from a single parish

## Mexico Civil Registration

- Post-2020 indexes often produced by Computer-Aided Indexing (CAI)
  with higher OCR-style error rates, especially with accented
  characters and joined cursive
- **Compensation:** Use wildcards generously (`q.fatherSurname=
  L*pez`); search dual surnames separately; search by parents'
  names instead of the principal

## Mexico Catholic Church Records

- Sometimes indexed without parents' names due to partial indexing
  templates
- **Compensation:** Drop the principal's name and search by
  `q.fatherGivenName/Surname` + `q.motherGivenName/Surname`

## Ellis Island Passenger Lists

- **Wildcards are explicitly disabled** in these collections
- **Compensation:** Try multiple specific spellings; search by
  ship name + arrival year via other parameters; use external
  Stephen Morse one-step tools

## United States SSDI (Social Security Death Index)

- Names may be indexed first-name-last-name without middle initial;
  some entries have only "Mrs." prefix
- **Compensation:** Search by SSN if known; use exact birth and
  death dates

## German Lutheran/Catholic Registers

- Given-name standardization incomplete: "Johann Friedrich" vs.
  "Friedrich Johann" may not match each other
- Umlauts (ä/ö/ü) may be indexed as ae/oe/ue or stripped
- **Compensation:** Use wildcards; try both name orderings; try
  both "Mueller" and "Müller" (diacritic stripping should handle
  this, but indexed text may store the "ue" spelling)

## Norway Church Books / "Norway, Marriages, 1660-1926" (collection `1468080`)

- Patronymic given names for women are transcribed with unstable
  vowels — the same underlying name has been observed indexed as
  **Unna**, **Urna**, and **Udna** across different records in the
  same collection family (confirmed from two separate live test runs
  against the real API: the target bride's own marriage entry indexed
  her as "Urna Halsteinsdr"; an 1801 census entry for the same woman
  indexed her as "Udna Halstensdatter"). This is a genuine transcription
  artifact of 18th/19th-century Gothic-script Norwegian handwriting, not
  a data-entry rule — it recurs across unrelated records for the same
  person.
- Both runs that hit this collection changed *which party was
  principal* and *dropped surname/place filters*, but neither run
  varied the *spelling of the given name itself* — so a real, findable
  record was missed twice in a row.
- The patronymic **surname** is independently abbreviated in the same
  index: the target bride's marriage entry indexes her surname as
  **Halsteinsdr**, not the full **Halsteinsdatter** — confirmed from a
  third live run where the given name WAS correctly varied to "Urna"
  but the surname was left at the full "Halsteinsdatter" (or varied
  separately, in a different search, back with the given name at
  "Unna"/"Inna") — the two variants were never tried *together in the
  same call*, and the record was missed a third time as a result.
- **Compensation — do this explicitly, not just structural query
  changes:** for any Norwegian patronymic given name, run the exact
  name AND at least these vowel-substituted spellings before widening
  to other repositories: swap the medial vowel (Unna → Urna → Udna →
  Anna), and try the single-letter-doubled/undoubled form (Unna → Una).
  Treat "I varied the query structure" and "I varied the name spelling"
  as two separate, both-required steps — doing one is not a substitute
  for the other. **When both the given name and the surname of a
  Norwegian patronymic are uncertain, vary them TOGETHER in the same
  search** — e.g. `givenName: "Urna"` + `surname: "Halsteinsdr"` in one
  call — not just one part at a time across separate searches. Also try
  the abbreviated patronymic ending directly: `-datter` → `-dr` (e.g.
  Halsteinsdatter → Halsteinsdr), the mirror of the vowel-substitution
  rule above for given names.

## Common collection IDs (verify before use)

| Collection | ID |
|---|---|
| US Census 1900 | `1325221` |
| US Census 1910 | `1727033` |
| US Census 1920 | `1488411` |
| US Census 1930 | `1810731` |
| US Census 1940 | `2000219` |
| US Census 1950 | `4464515` |
| England Births and Christenings 1538–1975 | `1473014` |

When in doubt, look up the collection and read the ID from the
response. Do not hardcode IDs without verification.
