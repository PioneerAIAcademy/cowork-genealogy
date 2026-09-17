# Hinrich Burmeister — a second son Hinrich, baptised 1687 at Schönberg

**Source PID:** `G8CJ-7VL`
**Hinrich Burmeister is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 30 November 1653 at Schönberg, Mecklenburg; died 26 February 1693, buried February 1694, Schönberg.

## Research question

> Did Hinrich Burmeister of Schönberg (b. 1653) have a son Hinrich baptised 29 July 1687, and is the 'Elsch Burmeister' named as the child's mother his first wife Liesbeth Oldenburg?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G8CJ-7VL` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — the parish carries several contemporaneous Hinrich Burmeisters, and
telling them apart is the whole task. See "Notes for reviewers".

## Notes for reviewers

**Resolved 2026-09-17 (issue #2306): the hint is a FALSE MATCH. Both original
findings are refuted. The answer to the research question is "no" on both
halves.**

The hinted ark `ark:/61903/1:1:QPV4-RPBS` is not the child on the 29 July 1687
baptism — it is that record's **father** persona (the child is
`ark:/61903/1:1:QPV4-RPYG`), and it is unattached in the FamilySearch tree. So
FamilySearch was proposing "this record's father is your Hinrich", which is why
it raised the `adds_spouse` flag against the mother, "Elsch Burmeister".

**The control the draft lacked.** The subject's own documented son's baptism —
18 August 1683, `ark:/61903/1:1:QPVH-33NS`, the source behind tree person
`P71D-DRJ` — names the mother **"Liesebeth Burmeister"**. This register does
write his first wife under her married surname, and it writes her as
*Liesebeth*, not *Elsch*. The draft's argument that "Elsch" is just the Low
German short form for the same woman was reasonable a priori but is not how
this clerk actually recorded her.

**The disproof.** The Hinrich-and-Elsch(e) couple is a separate, contemporaneous
Schönberg family with a coherent series of its own:

| Event | Date | Ark |
|---|---|---|
| Baptism, Jochim | 11 May 1686 | `ark:/61903/1:1:QPV4-VLP6` |
| Burial, Jochim | 11 Jul 1686 | `ark:/61903/1:1:QPVH-MYG1` |
| **Baptism, Hinrich** | **29 Jul 1687** | `ark:/61903/1:1:QPV4-RPYG` ← the hinted child |
| Baptism, Jochim (again) | 16 Oct 1690 | `ark:/61903/1:1:QPV4-RS8D` |

The 16 October 1690 entry is the record that decides it. Liesbeth Oldenburg
died **4 January 1689**, and the subject had remarried to Anna Meyborg on
**27 February 1690**. A couple still bearing children under the name Elsche in
October 1690 is therefore not the subject and Liesbeth, by either wife. That
makes Elsch a different woman, married to a different Hinrich Burmeister — and
the 29 July 1687 child theirs, not the subject's. The 1686→1690 reuse of
"Jochim" after the 1686 burial is that family's own necronym, and it binds the
three entries into one household independently of anything in the subject's
tree.

**What was searched and came up empty.** A marriage-typed search of
"Deutschland, ausgewählte evangelische Kirchenbücher 1500-1971" (collection
`3015626`) for a Hinrich Burmeister at Schönberg, Mecklenburg-Strelitz,
1680–1695, returns 17 matches in full (no pagination). Only two are marriages
of a Hinrich Burmeister: 24 October 1682 to Liesabeth Ollenborgs at Schönberg
(`ark:/61903/1:1:QPV4-KKZX`, the subject) and 23 October 1688 to Anne
Oldenborgs at **Schlagsdorf** (`ark:/61903/1:1:QPV4-JMVS`) — a different man,
Heinrich Burmeister of Rieps (`L2XQ-H7D`, b. 1650, d. 1708), whose own children
are all baptised at Rieps. **No marriage of a Hinrich Burmeister to an Elsch or
Elisabeth exists in that window**, so Elsch is not an unrecorded third wife
either. Separately, **no burial of a son Hinrich of Hinrich Burmeister appears
at Schönberg between the 18 August 1683 baptism and the 29 July 1687 hinted
event** — so nothing supports the necronym reading the draft floated, under
which the 1683 boy died and his name was reused. Tree person `P71D-DRJ` carries
a bare `Death` fact with no date and no burial source.

**What is deliberately left open.** A 20 January 1691 Schönberg baptism of a
Hinrich Burmeister (`ark:/61903/1:1:QPV4-G7GT`) names the parents as Hinrich and
**Anna** Burmeister, and the subject married Anna Meyborg on 27 February 1690 —
eleven months earlier — and had Jochim by her in December 1692. That is a real
candidate for a genuine second son named Hinrich. It is **not** encoded as the
answer, because a separate Hinrich-and-Anna couple was also baptising children
at Schönberg in the same years, including another Hinrich on 9 May 1687
(`ark:/61903/1:1:QPV4-2MW3`) when the subject's wife was still Liesbeth. The
index cannot separate the two couples, and the adjudicating genealogist declined
to invent a resolution the evidence does not carry. Finding `f3` therefore
requires only that the agent report the 1687 hint as unsupported; asserting the
1691 child as the subject's son is neither required nor penalised.

**Two tree defects noticed in passing, not acted on here.** (1) `GD6Y-89H`,
the tree person holding *both* the 9 May 1687 and 20 January 1691 baptisms, is
conflated — two baptisms on one person — and its tree mother is Anna Oldenburg
(`L2XQ-HZ4`) of the Rieps family, which is a bad merge and settles nothing.
(2) `ark:/61903/1:1:QPV4-PW12`, which the tree carries as the subject's
*marriage* to Anna Meiborgs on 27 February 1690, is indexed as a **Burial**
(confirmed by both `record_read`'s fact type and the `source_attachments` tag),
and does not surface in a marriage-typed search of the collection.

**A note on `f1`'s `required: false`.** Outcome-3 fixtures normally carry the
`avoid` finding as `required: true`. Here it cannot be. `f1`'s claim
unavoidably contains the name "Hinrich Burmeister", so `apply_avoid_guard`
(`eval/harness/e2e/judge.py`) matches those tokens against `P71D-DRJ` and
`P9PK-53N` — both legitimately in the starting tree, neither in the exempt set
(which is `{G8CJ-7VL}` only) — and forces `f1` to `matched: "false"` no matter
what the agent does. With `required: true` that makes `pass` unreachable and
the fixture ungradable. `f1` is therefore `required: false`; the guard still
fires and still records the miss, but does not gate the verdict. The
do-nothing-run protection that `required: true` normally provides is carried by
`f3`, which is `required: true` and requires the agent to actually document the
negative conclusion. `f2` is `required: true` and its tokens were measured
clean against the starting tree.
