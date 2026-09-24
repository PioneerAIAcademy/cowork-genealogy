# Isabella Inglis — parents Thomas Inglis and Jane Borthwick, and an 1867 Scottish marriage

**Source PID:** `KHL9-LKF`
**Isabella Inglis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of David Young, with two daughters born at Edinburgh in 1868 and 1870.

## Research question

> Who were the parents of Isabella Inglis, wife of David Young of Edinburgh, and when did the couple marry?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KHL9-LKF` with relatives). Nothing was
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

**Resolved 2026-09-24: TRUE MATCH, with one drafted value corrected.**

The hint record is the subject's own marriage. It was read directly
(`ark:/61903/1:1:X9T4-M2N2`, which resolves to Isabella's persona; the
citation button offers `ark:/61903/1:1:X9TW-11NJ`, the parent record filed
under the groom).

**What the index gives.** Isabella Inglis, age 23; parents Thomas Inglis and
Jane Borthwick Inglis; marriage to David Young, age 25, mechanical engineer,
birth year estimated 1842, on 25 December 1867; parents-in-law William Young
and Agnes Inglis.

**What decided the identity.** Not the name match, which is weak on its own:
a David Young married an Isabella Inglis in December 1867, and a David Young
and Isabella Inglis Young had a daughter ten months later. What settles it is
that the marriage entry names the two grandmothers, and the tree's daughters
carry exactly those names in the Scottish naming-pattern order — first
daughter **Jane** (b. 19 Oct 1868) for the maternal grandmother Jane Borthwick
Inglis, second daughter **Agnes** (b. 6 Sep 1870) for the paternal grandmother
Agnes Inglis. The daughters were entered into the tree from their own baptism
records, by someone who had not seen this marriage entry, so the corroboration
is independent rather than circular. The elder daughter's middle name,
**Inglis**, is the bride's own maiden surname carried in the usual Scottish
way, which is a second independent point of contact.

**The place was corrected, and this is the part a reviewer should check.**
The draft recorded the marriage at "Edinburgh, Midlothian, Scotland". **The
index carries no place at all** — no registration district, no parish, no
county; the only geography anywhere on the record is the collection title.
The place therefore drops to "Scotland", which is what f2's own description
had said all along. A separate profile carries "Innerleithen, Peeblesshire"
for this marriage, but that is tree data rather than record data and is
recorded here as a lead, not as an answer. Innerleithen is some thirty miles
from Edinburgh, so the draft's county was not merely unsourced but probably
wrong.

**The bride's age confirms the birth year.** Age 23 on 25 December 1867 puts
her birth between late December 1843 and December 1844, so f3's "about 1844"
stands as drafted and is correctly hedged.

**A duplicate profile, noted but not acted on.** The record is attached to
`97DG-FXS`, not to this fixture's subject `KHL9-LKF`. Comparison of spouse
and children shows these are one woman on two profiles — `97DG-FXS` carries
the marriage, `KHL9-LKF` carries the daughters' births. They were deliberately
**not** merged: merging rewrites the live tree, and this subject's tree is
captured in `starting-tree.gedcomx.json`. Nothing in CI would catch the
resulting drift — `check_e2e_fixtures.py` does not compare the fixture against
upstream, and `snapshot --check` is a manual command — so the divergence would
stay invisible until someone re-captured the fixture.

One thing to note rather than resolve: both mothers are Inglises (the groom's mother Agnes Inglis, the bride Isabella Inglis), so bride and groom may have been cousins. That is common enough in Edinburgh parish society to be unremarkable, but it does mean surname matching alone proves less here than usual, and the statutory register entry itself — with ages, addresses and fathers' occupations — is what settles it.
