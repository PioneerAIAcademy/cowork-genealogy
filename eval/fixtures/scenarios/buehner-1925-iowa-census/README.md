# buehner-1925-iowa-census

John Buehner (b. about 1858, Iowa), last found in the 1915 Iowa State Census, married
to Caroline (maiden name Holdiman). Shaped on alpha feedback #4653/#4656/#4658 (issue
#4699): every surname-anchored search of the 1925 Iowa State Census (collection
`2224537`) nils, including spelling variants, and he is in fact indexed under a
transcription error no tried variant guesses — reachable only by dropping the
surname and anchoring on the place and his wife's given name.

- **Objective:** find where John Buehner was living in 1925.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`), one `planned` item: pli_001, 1925 Iowa State
  Census. Its rationale names his wife Caroline (maiden name Holdiman) as a
  household anchor.
- **Log:** 0 entries.
- **GedcomX persons:** I1 (John Buehner, b. about 1858, Iowa; 1915 residence Iowa),
  I2 (Caroline Buehner, maiden name Holdiman, b. about 1862, Iowa).
- **Relationships:** R1 Couple (I1, I2).

## What the skill must do

Search the 1925 Iowa State Census under Buehner and at least one spelling variant;
all nil. Before reporting him not found, drop the surname entirely and anchor on
`recordCountry` + the place + his wife Caroline's given name (`spouseGivenName`/
`otherGivenName`), and run one wildcard surname search (`Bu*ner` shape) — both per
issue #4699. The surname-free search reaches the actual 1925 household, indexed
under a surname the tried variants never guessed; the wildcard search still nils.

Hand-authored; no real person.
