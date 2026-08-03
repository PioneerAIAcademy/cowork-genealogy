# Katalin Horák — additional son János (b. 1844)

**Source PID:** `LDSJ-SXL`
**Katalin Horák is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Katalin Horák and her husband István Banyári of Kľak, Nová Baňa, Slovakia have a son named János, baptized 1 September 1844?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LDSJ-SXL` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: false match, no findable substitute.** The hint's baptismal record names János Banyári's parents as István Banyári and Káti Liskovics — a different wife from Katalin Horák, not a mistranscription of her name. "Liskovics" bears no resemblance to "Horák," a materially weaker name link than almost any other record in this batch (most others are routine spelling variants of the same surname).

Two alternative explanations were considered and set aside:

- **Could "Káti" be a diminutive of "Katalin"?** Plausibly, yes — it's a standard Hungarian short form. But granting that only resolves the given name; the surname mismatch remains, and a shared common given name alone is a weak identity anchor, not confirmation.
- **Could "Horák" be a middle name rather than a full surname, with "Liskovics" the real one?** This doesn't fit how 1840s Hungarian/Slovak Catholic church records name people — one given name, one surname, no formal middle-name category.

No independent record was found confirming "Liskovics" as Katalin's maiden name, and no birth date exists anywhere in this picture for either couple's parents to compare ages: neither Katalin nor her husband István Banyári has a birth date in the tree (only a bare, dateless death fact each), and neither the hint's István Banyári nor Káti Liskovics has any recorded facts beyond their names. The only two dates present — the hint child János's 1844 baptism and the tree's existing son István's 1846 christening — are not in conflict with each other (a plausible ~2-year sibling gap); the case does not turn on dates.

What tips this to false match is that "Banyári" is evidently common enough in this parish to have already caused confusion within the tree's own existing data, independent of this hint: Katalin's profile carries a second "Couple" relationship to another man named a variant of "István Banyári" whose child was born in 1938 (a different era and place entirely, mis-standardized to a location in India) — an apparent erroneous merge of an unrelated 20th-century family. Given the name is demonstrably prone to this kind of conflation, the more likely explanation for the hint is a second, unrelated István Banyári in the same small parish — not an error in how Katalin's name was recorded.

This is an honest "no findable substitute" outcome, not a fully closed case: the maiden-name question for "Liskovics" was considered but not independently verified either way.
