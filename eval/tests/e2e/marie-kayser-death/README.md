# Marie Philippine Kaÿser — death in July 1780, Luxembourg

**Source PID:** `GKZY-81X`
**Marie Philippine Kaÿser is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Theodore Hochhertz and mother of Jodoc Frederic (b. 1776) and Nicolas (b. 1778) Hochhertz.

## Research question

> When did Marie Philippine Kaÿser, wife of Theodore Hochhertz of Luxembourg, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GKZY-81X` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-22 — true match, finding refined (outcome 2): same person and month as the hint, with the burial date, image citation and place corrected.**
Adjudicated by Paaboat; second opinion from genealogist **Solomon Baidoo**, who
read the original image independently and confirmed the match. Retrieval was
done by hand on familysearch.org; the identity judgement is the two genealogists'.

**What decided it.** The hint's index persona (`ark:/61903/1:1:6PX5-KV4H`,
"Luxembourg, Church and Civil Registration, 1601-1923") was checked against the
register page image (`ark:/61903/3:1:3QS7-L9WM-9S4L`). On the image the entry
sits among the late-July 1780 entries, under the heading "Julii 1780", with
"Maria Philippina" in the left margin: she died about 25 July and was buried
26 July 1780 (burial place as written: Reichstet). The husband is written
**Hochhertz** on the image. The index's "Hochbertz" is a transcription error,
not a second surname, and he is identified as Theodore Hochhertz, apothecary of
Luxembourg city: the tree's husband. The entry calls her *uxor* (wife) and
gives her age as 43 *annorum*, so she is not the couple's infant daughter of
the same name (below). Age 43 puts her birth about 1737, which fits children
born in 1776, 1778 and 1780. An earlier reading of 4 July was
wrong and was corrected on re-examination. `f1` requires July 1780 at month
precision. The place is written only as "Luxembourg": the page carries no
parish header, and Reichstet is the burial place as written, not an established parish.

**Consistency with the tree.** The tree's sons Jodoc Frederic (b. 1776) and
Nicolas (b. 1778) were both born before the death, and so was a daughter,
Maria Philippina, baptised to this couple on 12 March 1780. A death four months
after that confinement fits the evidence. A search of the same
collection for Hochhertz/Hochbertz baptisms at Luxembourg from 1780 to 1800
found no child born after the death, and nothing turned up a second
Hochhertz/Hochbertz couple. The tree's only source, an 1805 civil act
(`ark:/61903/1:1:WQ8T-8N2M`, "Luxembourg, Registres d'état civil, 1796-1941"),
names her in its index with name and sex only; its image, read 23 September
2026, names her as défunte — consistent with a death in 1780.

**Still unverified.**
- *Parish.* The register page carries no parish header; the location appears
  only on the volume's title page.
