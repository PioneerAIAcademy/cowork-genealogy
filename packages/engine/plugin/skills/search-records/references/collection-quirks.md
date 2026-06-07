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
