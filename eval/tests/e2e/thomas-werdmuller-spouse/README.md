# Thomas Werdmüller — a son David by Regula Steiner (bapt. 1698, Zürich)

**Source PID:** `9MF3-9S6`
**Thomas Werdmüller is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 22 February 1657 at the Grossmünster, Zürich; died 14 November 1704, Zürich.

## Research question

> Did Thomas Werdmüller of Zürich (b. 1657) have a son David baptised 27 March 1698 by a Regula Steiner, while married to Dorothea von Muralt?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `9MF3-9S6` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 28, `hint-samples.csv` row 870,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Schweiz, Katholische und Reformiert Kirchenbücher, 1418-1996", a baptism of 27 March 1698 at Zürich for David Werdmüller, naming parents Thomas Werdmüller and Regula Steiner.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Regula Steiner as his wife and David as his son, plus a `required` finding that the report documents
the rejection.

The refutation, if it holds, is unusually clean: the subject married **Dorothea von Muralt** on 2 March 1686 and she did not die until **14 January 1735** — thirty-one years after the subject himself. So at the hinted baptism of March 1698 he was married to her and she was very much alive. A legitimate child by a Regula Steiner in 1698 is therefore not a second marriage but an impossibility, and the entry belongs to another man.

That other man is not hard to imagine. Werdmüller is a Zürich patrician family and Thomas repeats in it every generation — the tree itself holds two, the subject (1657-1704) and his father (1618-1675) — so the register will carry several Thomas Werdmüllers alive at once. This is the same failure mode as a common surname, produced instead by a narrow naming pool inside one wealthy lineage.

Before settling on (c), two checks. The tree's own sourcing is thin — two sources, one of them a bare "Thomas/Werdmueller" — so confirm Dorothea's 1735 death is actually evidenced and not a submitter's assumption. And read the register entry for the 1698 baptism rather than the index: Zürich baptismal registers name godparents, which in this family will place the child in the right branch immediately.
