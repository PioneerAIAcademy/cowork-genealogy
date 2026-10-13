# Nicola Domenichelli — death in June 1981, Salta, Argentina

**Source PID:** `G2WX-HZ5`
**Nicola Domenichelli is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1898; the tree carries an undated Death fact. Married Esther Jimenez on 2 March 1946 in Salta; she died 3 October 1970.

## Research question

> When and where did Nicola Domenichelli, born about 1898 and married to Esther Jimenez in Salta in 1946, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G2WX-HZ5` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 1, `hint-samples.csv` row 7,
flags `adds_spouse,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Argentina, Salta, Civil Registration, 1880-2000", a death entry for Nicolas Domenichelli (born 1897) who died 29 June 1981, registered 30 June 1981; the register image is from Rosario de la Frontera, Salta.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the June 1981 death, plus a `required` finding that the report documents
the rejection.

A plausible candidate on context, thin on identifiers. The index gives only a name and a birth year one off the tree's 1898, but the shape fits: the tree's wife Esther Jimenez died in 1970, so a widower in 1981 is what the tree predicts, and Esther's own birth registration is in Rosario de la Frontera, the town whose register holds this entry. The tree's existing sources are the 1946 Salta marriage (`ark:/61903/1:1:6ZYD-6L8N`, indexed as Nicolás Domenicheli) and Esther's 1970 death entry; neither is a re-index of this one.

The `adds_spouse` flag is an indexing artefact: the second person on the entry is indexed as "Viudo Viudo", which is the word *viudo* (widower) read as a name. Nobody should add a spouse from this record. The discriminating check is the register image linked from the hint record: an Argentine death act normally names the parents and birthplace, and the tree gives his parents as Michele Domenichelli and Diletta Berardinelli, with siblings born 1887–1894 in Roccasicura, Molise. Parents or an Italian birthplace on the act that match would settle it; different parents would make this a different Nicolás.
