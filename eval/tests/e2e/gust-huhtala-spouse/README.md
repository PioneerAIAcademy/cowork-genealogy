# Gust Johs Huhtala — wife Lisa Jöransdotter and son Jöran (b. 1820, Kauhava)

**Source PID:** `K46D-YPY`
**Gust Johs Huhtala is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of Kauhava, Vaasa, Finland, with five children christened there between 1817 and 1830.

## Research question

> Did Gust Johs Huhtala of Kauhava, Vaasa have a son Jöran, born 3 February 1820 to a wife named Lisa Jöransdotter — or does that baptism belong to a different Huhtala household?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K46D-YPY` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 10, `hint-samples.csv` row 356,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Finland, Baptisms, 1657-1890", a christening of 7 February 1820 at Kauhava, Vaasa for Jöran, born 3 February 1820, naming parents Gust Johs Huhtala and Lisa Jordr (Jöransdotter).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Lisa Jöransdotter as his wife and Jöran as their son, plus a `required` finding that the report documents
the rejection.

Two objections point the same way, and the reviewer should test whether they hold.

First, the interval. The tree already has a son of this couple, Gustaf, born **22 March 1820** and christened 24 March at Kauhava. The hinted Jöran was born **3 February 1820** — seven weeks earlier. One woman cannot bear both. Either the tree's Gustaf date is wrong, the two are twins mis-transcribed, or these are two different mothers.

Second, the patronymic. The tree names the wife **Kaisa Johdr** — Katarina Johansdotter — while the hint names **Lisa Jordr**, Elisabet Jöransdotter. Those differ in both the given name and the father's name, so this is not the ordinary Finnish spelling variance that a reviewer can wave through.

Together they read as a second Gustaf Johansson Huhtala at Kauhava, which for a Finnish farm-name surname in a single parish is the normal situation rather than an unlucky coincidence — the farm name attaches to whoever holds the farm. Note that every one of the tree's five children rests on the same derivative index (Finland, Baptisms, 1657-1890) as the hint, so the two sides are of equal weight; settling this needs the Kauhava communion books or the original register, not more index entries.
