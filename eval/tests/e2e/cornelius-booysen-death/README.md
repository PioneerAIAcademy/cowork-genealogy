# Cornelius Hermanus Zacharias Booysen — death in the Transvaal

**Source PID:** `GWDS-CKP`
**Cornelius Hermanus Zacharias Booysen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1906; died not recorded in the tree.

## Research question

> When and where did Cornelius Hermanus Zacharias Booysen of Pretoria, Transvaal, South Africa die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GWDS-CKP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved — different answer (the hint is a false match).** The original
FamilySearch hint (`filtered-list-samples.csv` row 30, flag `adds_death`,
confidence 3) matched Cornelius to *South Africa, Transvaal, Probate Records
from the Master of the Supreme Court, 1869-1961*. That match is **wrong**: the
underlying document is the **death notice of Barend Christiaan Viljoen**, not
Booysen. Barend Viljoen is the person named as the deceased on the notice, and
it records *his* wife, children, and estate; Cornelius Hermanus Zacharias
Booysen does not appear as the deceased anywhere on it. The distinctive
four-element name was not enough to save the hint — the batch's ~50% false-match
rate held here.

**The correct answer, found independently.** Searching the sibling collection
*South Africa, Transvaal, Civil Death, 1869-1954* turned up a **death information
record** — a **Form of Information of a Death (B.M.D. 2)** — naming Cornelius
Hermanus Zacharias Booysen in the "Deceased" field (not a death certificate; the
distinction matters for how the informant's details are weighed). It records his
death on **9 September 1942** at the **hospital in Standerton, Transvaal**, usual
residence **Charl Cilliers, District Standerton**, occupation **general farmer**,
cause of death **coronary thrombosis**.

The one wrinkle a reviewer should not trip over: the record implies a birth year
of **~1902**, about four years off the tree's **1906**. That is an *age estimate*,
almost certainly supplied by a non-family informant (this is a death registration,
not a family-completed certificate), and it does **not** disqualify the match. The
identity anchor is the **exact full-name match** — every given name plus the
surname — which is highly distinctive. This is precisely the death-registration
case the search-records cross-check exception covers: a ≤5-year birth-year gap on
a civil death record, with an exact full-name match, is not the different-person
signal it would be on a birth or census record.

**Proof tier: Probable, not Proved.** This death information record was the
**only tangible evidence of the death found**, and the conclusion is graded at
**Probable** for two reasons: it is a single source with no independent
corroboration of the death event, and the ~1902-vs-1906 birth-year gap, though
explainable, was never independently resolved. The identity rests on the
distinctive exact full-name match plus place — strong, but not certainty. What
would raise it to **Proved** is one more anchor tying the Standerton-1942
decedent to the 1906 Pretoria tree man: the death record naming a wife or child
who matches the tree, a probate/estate file opened in his own name, or a burial
record. A correct agent run should conclude at Probable and name the age
conflict as the reason it stops short of Proved.

**For the next reviewer:** the trap in this fixture is following the hint
straight to the Master-of-the-Supreme-Court probate image and asserting
Booysen died in the Transvaal from it — that image is Viljoen's. The recoverable
truth lives one collection over (Transvaal Civil Death), keyed on the same
distinctive name. `f1` is written so that recovering the 1942 Standerton death
passes and asserting the probate hint as Booysen's death does not.
