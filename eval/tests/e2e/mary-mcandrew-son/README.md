# Mary E McAndrew — additional son John (b. 1873, Detroit)

**Source PID:** `G13G-P68`
**Mary E McAndrew is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
12 July 1848, New Brunswick, Canada; died 31 March 1925, Detroit,
Wayne, Michigan.

## Research question

> Did Mary E. McAndrew (G13G-P68) and her husband John Mogan of
> Detroit have any children besides the five already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-10, PID `G13G-P68` with relatives). It already
contains five children of Mary and John Mogan — Thomas Frank (b. 1876),
John Vincent (b. 1879), Anna Irene (b. 1884), Edward Lawrence (b. 1885),
and Mary L. (b. 1888) — and the hinted sixth child does not appear.
Nothing was stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — "Mary Morgan" and "John Morgan" are extremely common names in
1870s Detroit, the tree family is recorded under the variant **Mogan**
(records for this family use Morgan and Mogan interchangeably — see the
attached-sources list on the subject), and the agent must distinguish a
genuine additional son from a false hint while the couple's known
children begin only in 1876.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples.csv` row 2, flag `adds_son`, confidence 3)
in which roughly half the hint records are **false matches**, and the
authors do not know which. `expected-findings.json` was transcribed
from the hint record — Michigan, Births and Christenings, 1775-1995:
John A Morgan, born 6 March 1873, Detroit, parents John Morgan and
Mary Morgan. The genealogist + developer teams must decide:

- **(a) true match** — keep the findings as written;
- **(b) different answer** — other additional children are documented
  instead: edit `expected-findings.json` accordingly;
- **(c) no findable answer** — the 1873 birth belongs to a different
  Morgan family: replace the findings with a `"polarity": "avoid"`
  guard naming the 1873 John A Morgan birth (spec §3.4.1 — the harness
  mechanically fails a run whose final tree contains the avoided claim)
  plus a `required` finding that the agent's report documents that no
  additional children could be established and why the hint record was
  rejected.

Points a reviewer should weigh: the tree already has a son **John
Vincent Mogan, b. 12 May 1879** — if the hint is a true match the
family would have two sons named John (or the 1873 record is an
early/conflicting record for the same son, which would make this
`adds_son` hint itself questionable); Mary's marriage to John Mogan has
no date in the tree, so whether the couple was married by 1873 is
unestablished; the couple's residence trail (Detroit from 1870) is at
least consistent with an 1873 Detroit birth.
