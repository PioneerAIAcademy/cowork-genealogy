# Jacob Klatkiewicz — son Stanislaus baptised 1886 at Ceradz, Posen

**Source PID:** `LDZR-XPT`
**Jacob Klatkiewicz is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 21 June 1827 at Garaschewo, baptised 1 July 1827 at Gluschin, Posen; died and buried at Runkeln/Rumianek, Posen West.

## Research question

> Is the Stanislaus Klatkwicz baptised 2 May 1886 at Ceradz, Posen the son of Jacob Klatkiewicz and Hedwig Kurek that the tree records as born in 1884 at Rumianek?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LDZR-XPT` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 22, `hint-samples.csv` row 677,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Deutschland, Preußen, Posen, Katholische und Lutherisch Kirchenbücher, 1430-1998", a baptism of 2 May 1886 at Ceradz, Posen West for Stanislaus Klatkwicz, born 30 April 1886, naming parents Jacob Klatkwicz and Hedvigis Rurek.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Hedvigis Rurek as a second wife, plus a `required` finding that the report documents
the rejection.

The `adds_spouse` flag is a red herring and the reviewer should say so plainly: the hint's **Hedvigis Rurek** and the tree's **Hedvirgis Kurek** differ by one letter, R for K, in a Gothic-script register where exactly that confusion is routine. They are the same woman, and no second wife should be created.

The real question is the child. The tree records a son **Stanislaw, born 1884 at Rumianek**; the hint gives **Stanislaus, born 30 April 1886 and baptised 2 May at Ceradz** — two years and about fifteen kilometres apart. Either the tree's 1884/Rumianek is an unsourced approximation of this same baptism, or the couple had two sons of that name, which would mean the first died. The tree cannot settle it: it carries exactly **one** source for the whole family, and several of its children are entered as placeholders — `:Ludwika Klatkiewicz`, `Eldest Klatkiewicz`, `One More Klatkiewicz` — which is the signature of a submitter recording a remembered sibling set rather than transcribing a register.

One age check worth doing: the subject was born in 1827, so he would be 58 at this birth. Not impossible, but it makes the wife's age the thing to establish, and the tree gives her none.
