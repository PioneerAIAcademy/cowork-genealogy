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

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 13, `hint-samples.csv` row 403,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Deutschland, ausgewählte evangelische Kirchenbücher 1500-1971", a baptism of 29 July 1687 at Schönberg for Hinrich Burmeister, naming parents Hinrich Burmeister and Elsch Burmeister.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Elsch Burmeister as a separate wife, plus a `required` finding that the report documents
the rejection.

The date fits the first marriage exactly. The subject married Liesbeth Oldenburg on 24 October 1682 and she died 4 January 1689; a baptism on 29 July 1687 falls squarely inside that marriage, at the same parish, and "**Elsch**" is the ordinary Low German short form of Elisabeth — the same woman as "Liesbeth", entered under her married surname Burmeister, which is exactly how these Mecklenburg registers name mothers. Read that way the hint's `adds_spouse` flag is an artifact: the hinting engine saw a name it could not reconcile and proposed a new wife.

What is genuinely new is the **child**. The tree already has a son Hinrich by Liesbeth, christened 18 August 1683. A second son of the same name in 1687 means either the 1683 boy died young and the name was reused — the necronym pattern, entirely standard here — or the 1687 entry is a duplicate indexing of the 1683 baptism, or it belongs to a different Burmeister couple in a parish that clearly had several (the subject, his father, and two of his sons are all called Hinrich Burmeister).

That name density is the real difficulty. The tree carries thirteen sources from this one collection already, so start by checking whether the hinted ark is among them.
