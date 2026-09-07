# Patrick Hoban — a wife Ellen and a son Thomas Dee (m. 1895, Halifax)

**Source PID:** `KK3W-WLT`
**Patrick Hoban is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1836, Halifax, Nova Scotia, to Richard Hobin and Margaret Kilfoyle of County Kilkenny; resident at Halifax in 1868 and 1881; death not recorded in the tree.

## Research question

> Was the Patrick whose son Thomas Dee married Bessie Butler at Halifax in 1895 the same man as Patrick Hoban (b. 1836), and was his wife an Ellen?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KK3W-WLT` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 16, `hint-samples.csv` row 494,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Canada, Marriages, 1661-1949", an 1895 marriage entry for Thomas Dee (b. 1874, Halifax) and Bessie Butler (b. 1875, Halifax), naming the groom's parents as Patrick and Ellen and the bride's as Martin and Ann.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Ellen as his wife and Thomas Dee as his son, plus a `required` finding that the report documents
the rejection.

This one looks like a false match, and the reviewer's job is to say so with evidence rather than on impression.

The hint's groom is Thomas **Dee**, born about 1874 at Halifax, whose parents are given only as bare given names — Patrick and Ellen. The subject is Patrick **Hoban/Hobin**, whose wife the tree records as **Catherine Donovan** (married 18 November 1867 at Halifax) and whose son Thomas Patrick **Hobin** was born 11 February 1873 and baptised 20 February 1873. So the hinting engine has matched on a first name, a city, and a son called Thomas born within a year or two — and nothing else. The surname is wrong and the wife's name is wrong.

What makes this a good test rather than a trivial one is that the subject is densely documented — 27 sources, including his own marriage, four children's baptisms and the 1881 census — so the material to refute the hint is all on the tree side and easy to reach. The expected outcome (c) shape would be an `avoid` guard on Ellen-as-wife and Thomas Dee-as-son, paired with a required finding that the report documents the rejection and says what the evidence actually shows.

Note for the corpus: the batch CSV labels this row Ireland. Every record is Nova Scotian; Ireland is where the subject's parents were born (County Kilkenny), and the fixture is tagged CA-NS.
