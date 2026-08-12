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

**Resolved: answerable, but differently.** The baptism event in the hint is real and well-evidenced — this is not a false match on the event itself. What's wrong is narrower and more specific: the tree's claim that **Katalin Horák** is the mother.

**The event (well-evidenced):** János Banyári, baptized 1 September 1844, Kľak, Nová Baňa, exact match on name, date, and place, father named as István Banyári. This part of the hint should be encoded as a father-child relationship (István Banyári → János) at Probable tier.

**The mother (not proved — likely a tree error, not a false match on János himself):** the baptismal record names the mother as Katalin (Káti) Liskovics, not Horák. Rather than stopping there, a live debugging run (see below) checked further and found the tree's own already-accepted son, István (christened 1846, already in the tree as `LDSJ-SXK`), has his own baptismal record — and *it* names the mother as **Katalin Szeget**, a third name. A further parish search turned up yet a third Banyári-family baptism (1853) naming a fourth mother, Elisabetha Szeged. Across every actual primary record found for a Banyári family in this parish and era, **no record anywhere names a mother "Horák."** The tree's "Katalin Horák" is unsourced compiled data, and the more likely explanation is that it is simply incorrect — not that the 1844 hint belongs to some unrelated coincidental family.

Two alternative explanations for the name mismatch were considered and set aside before reaching this conclusion:
- **Could "Káti" be a diminutive of "Katalin"?** Plausibly yes (a standard Hungarian short form) — but this only resolves the given name; the surname question is untouched by it.
- **Could "Horák" be a middle name, with "Liskovics" the real surname?** Doesn't fit 1840s Hungarian/Slovak Catholic church-record naming (one given name, one surname, no middle-name category).

No independent record (e.g., the couple's marriage, which would give Katalin's true maiden name) was found — several search variants for the marriage came back nil, and the marriage register itself is not indexed (though it is a viewable, digitized collection — see below). No birth date exists anywhere for either possible mother to help disambiguate by age.

**Do not resolve the discrepancy by substitution.** Neither "Liskovics" nor "Szeget" is independently confirmed as Katalin's real name — flag `LDSJ-SXL`'s current "Horák" surname as unverified/likely wrong, but do not rename her to either alternative without further evidence.

**A tool limitation, not an archival gap.** The FamilySearch collection here is index-and-images — the original register pages (and the unindexed marriage register) are viewable by a human; a debugging run's blocked conclusion was only because its automated OCR reader had no API key configured, not because the pages are inaccessible. A manual page-by-page browse of the digitized Kľak parish register, or a run with OCR access, could still resolve which name (if either found so far) is Katalin's real one — that is the concrete next step, not a dead end.
