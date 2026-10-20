# James F. Gleason — a wife Norah and a son Robert F. Gleason born in Boston in 1893

**Source PID:** `L4ZG-21Q`
**James F. Gleason is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1 March 1865 in Boston, son of John Gleason and Delia A. Fitzgerald; died in Boston on 13 August 1896. The tree records no spouse and no children for him. His parents' other children are Francis J. (1867–1891), John A. (1869–1885), Emma Letitia (b. 1871), and four born in Lowell between 1886 and 1893.

## Research question

> Did James F. Gleason, born 1 March 1865 in Boston, son of John Gleason and Delia A. Fitzgerald, who died in Boston on 13 August 1896, marry and have children?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L4ZG-21Q` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 3, `hint-samples.csv` row 126,
flags `adds_spouse,adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Massachusetts, Town Clerk, Vital and Town Records, 1626-2001", a Boston birth register entry for Robert F. Gleason, born 20 May 1893, naming his parents as James F. Gleason and Norah (no maiden surname indexed).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Norah as his wife and Robert F. Gleason as his son, plus a `required` finding that the report documents
the rejection.

The CSV tags this row "British Colonial America"; the record and every tree event are in Boston, so the fixture is tagged `US-MA`.

On name, place and date the hint fits: same given names and middle initial, Boston, and the subject would have been 28. But the subject's own death record, already attached to him as a tree source ("Massachusetts, State Vital Records, 1638-1927", James F. Gleason, 13 Aug 1896), indexes his marital status as **Single**, his occupation as clerk, and names his parents as John and Delia A. Fitzgerald. A man single at his death in 1896 is unlikely to be the husband in an 1893 birth entry, so this reads as a probable false match: Boston had more than one James Gleason of this generation. The marital status lives only in that source's index, not in the tree's facts, so an agent has to read the source to see it.

The discriminating check is the 1896 death register image: confirm it says single rather than married or widowed. If it does, look for the Gleason–Norah marriage (about 1890–1893, Massachusetts) and see whether the groom's parents are John Gleason and Delia Fitzgerald.
