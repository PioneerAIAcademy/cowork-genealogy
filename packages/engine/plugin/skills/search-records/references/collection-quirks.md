# Collection-Specific Indexing Quirks — FamilySearch Records API

Read this reference when searching a specific collection family.
Quirks affect how queries should be constructed for that collection.

## US Federal Censuses (1790–1940)

- Indexed by community volunteers; mostly accurate but cursive
  handwriting causes common transcription errors: S/L, F/T, n/u,
  U/V confusions; double-S misread as F or "long s"
- **Compensation:** Use surname wildcards (`surname=Sm?th`);
  search by neighbors; for unindexed enumeration districts, switch
  to image browsing
- **A wildcard at the start or middle of a surname can be as useful as one at
  the end.** A family surnamed Bipes was indexed across records as Bipes,
  Bippes, Biepes, Bieps, Bifes, Bipers, Bippers, and Piper — no single
  trailing wildcard catches all of these. When a surname keeps resisting
  every explicit variant, try a leading or middle wildcard (`surname=?ip*s`
  or `surname=B*p*s`) alongside the usual trailing one.
- Collection-specific forms expose extra fields (Residence Year
  locked to census year, Race, Marital Status, 1935 Residence for
  1940 census)

## England parish registers (IGI Community Indexed)

- Pre-1837 parish records extracted decades ago — static "Legacy"
  collections with no updates or corrections since 2010 publication
- **Compensation: the IGI batch number.** It enumerates a parish exhaustively
  and is the canonical way to work one. How to obtain one, what it rejects, how
  it pages and what a nil under it means are all on `record_search`'s
  `batchNumber` parameter — read them there.
- **Reading a nil here:** these are static extractions, so a nil under a correct
  batch is a statement about the extraction, not about the parish.
- Cross-check with FreeREG and FindMyPast via `search-external-sites`.

## Mexico Civil Registration

- Post-2020 indexes often produced by Computer-Aided Indexing (CAI)
  with higher OCR-style error rates, especially with accented
  characters and joined cursive
- **Compensation:** Use wildcards generously (`fatherSurname=
  L*pez`); search dual surnames separately; search by parents'
  names instead of the principal

## Mexico Catholic Church Records

- Sometimes indexed without parents' names due to partial indexing
  templates
- **Compensation:** Drop the principal's name and search by
  `fatherGivenName/Surname` + `motherGivenName/Surname`

## Ellis Island Passenger Lists

- Wildcards work here like anywhere else. (The long-standing claim that they
  were disabled in these collections was refuted by measurement and is not
  carried struck through — see `name-search-mechanics.md`'s Constraints.)
- **Still useful:** multiple specific spellings, ship name + arrival year
  via other parameters, and the external Stephen Morse one-step tools —
  passenger-list indexing is rough regardless of whether wildcards work.

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
