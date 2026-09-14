# María Concepción Fuenmayor — parents Juan and Graciliana, and a 1912 Maracaibo marriage

**Source PID:** `GMH9-3BJ`
**María Concepción Fuenmayor is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1893 in Maracaibo; death not recorded in the tree.

## Research question

> Who were the parents of María Concepción Fuenmayor of Maracaibo, and when did she marry Eduardo Berrueta Fernández?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GMH9-3BJ` with relatives). Nothing was
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

**Resolved 2026-09-14 — outcome 1, true match.** The hint record
`ark:/61903/1:1:QVMV-ZVBD` is the marriage of María Concepción Fuenmayor
(`GMH9-3BJ`) and Eduardo Berrueta Fernández on 13 January 1912 at Nuestra Señora
de la Chiquinquirá, Maracaibo. Both findings stand as drafted: the hint supplies
her parents (Juan Fuenmayor and Graciliana Fuenmayor) and a marriage date the
starting tree lacks entirely.

**What decided it was the groom's side, not the bride's.** The record's Eduardo
Berrueta is the son of **Andrés Berrueta and María del Rosario Fernández** —
exactly what the tree's spelling of the husband, **Eduardo Berrueta Fernández**,
encodes under the Venezuelan two-surname convention, and the tree gives that name
from the children's baptisms without ever naming his parents. Husband, in-laws,
date and place all match. The date works cleanly too: 13 January 1912 comes
sixteen months before the couple's first recorded child, María del Rosario
Berrueta Fuenmayor, baptised 10 May 1913 in the same parish complex.

**The bride's given name is an indexing variant, and this collection's indexing
is demonstrably loose.** The record indexes her as *María Tereza*; the tree
carries her as *María Concepción*. That was the one thing standing in the way,
and it resolves as an index slip rather than a second bride. The 14 sources
already on the starting tree are all from this same collection and already spell
her four different ways — *María Concepción*, *Concepción*, *María*, and *María
Concepcion Fuenmayor de Berrueta* — while mangling the groom across the same
entries as *Eudardo*, *Eudaldo*, *Enidaldo*, *Berreta* and *Barueta*. A given-name
variant here carries very little weight against a four-way match on the groom's
parents, the date and the parish. The competing reading — two Fuenmayor brides
marrying an Eduardo Berrueta in Maracaibo in the same window — was looked for and
not found.

**The hint is not a re-indexing of a source she already has.** None of the 14
sources on the committed snapshot is `QVMV-ZVBD`; twelve are baptism entries for
the couple's children (1913–1930) and two are unrelated Urdaneta entries. So the
marriage and the parents are both genuinely new information relative to the
starting tree, which is what makes this fixture gradeable.

**One note for anyone re-deriving this against the live tree.** The record is now
attached to the `GMH9-3BJ` profile on familysearch.org, but it was **not** attached
when the snapshot was captured on 2026-09-07 — so the live profile shows one more
source than `starting-tree.gedcomx.json` does. The committed snapshot is the
fixture and is correct as-is; the agent under test starts without that source
attached, which is the point. Expect `snapshot --check` to report this as upstream
drift.
