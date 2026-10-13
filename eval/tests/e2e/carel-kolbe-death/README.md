# Carel Fredrik Kolbe — death in February 1876, Cape Town, South Africa

**Source PID:** `G4TS-FV8`
**Carel Fredrik Kolbe is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Baptised 6 December 1801 in Cape Town; the tree carries an undated Death fact. Son of Jacobus Kolbe (Colbeck) and Johanna Magdalena Paulsen; married Dolphina Carolina Hartog on 15 June 1857 in Cape Town (she died 2 September 1895). Their son, also Carel Fredrik Kolbe, was born in 1839 and died in Cape Town on 24 January 1898.

## Research question

> When and where did Carel Fredrik Kolbe, baptised 6 December 1801 in Cape Town, son of Jacobus Kolbe and Johanna Magdalena Paulsen, and married to Dolphina Carolina Hartog in Cape Town in 1857, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G4TS-FV8` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 25, `hint-samples.csv` row 816,
flags `adds_death,adds_burial`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "South Africa, Dutch Reformed Church Registers (Cape Town Archives), 1660-1994", a burial entry for Carel Fredrik Kolbey who died 21 February 1876 and was buried in Cape Town in 1876. The index gives no age, spouse or parents.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the February 1876 death, plus a `required` finding that the report documents
the rejection.

A plausible candidate on name and place. The given names match exactly, "Kolbey" is within the spelling spread the family's own entries show (Kolbe, Kolbé, Kolbee, Kolbeck, Colbeek), and Cape Town is where he was baptised and married. He would have been 74. Of the two Carel Fredrik Kolbes in the tree, the son died in 1898, so the father is the only tree candidate. None of the subject's existing sources is a burial or dated after 1867: they are baptism, banns and marriage entries from 1801 to 1867, so this is not a re-index of anything already in the tree.

The gap is that the index cannot tell generations apart. The son Carel Fredrik (born 1839) was married (the tree cites his civil marriage entry), and the Cape naming custom gives a first son his paternal grandfather's name, so an infant grandson called Carel Fredrik Kolbe dying in 1876 is a live alternative that the tree would not show. The discriminating check is the age on the burial register image linked from the hint record: about 74 fits the subject, and a child's age makes this the grandson.
