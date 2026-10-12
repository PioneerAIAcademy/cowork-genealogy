# Simon Heydöcker — death in August 1808, Laakirchen, Upper Austria

**Source PID:** `GZRZ-TNG`
**Simon Heydöcker is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth and an undated Death fact for him, and no sources. Husband of Katharina (no surname); father of Juliana Heidegger (born 15 June 1798) and Josef Heidegger (born 11 October 1801, died 1 March 1880, a farmer at Hochegg, Stötten 14), both born in Laakirchen, Gmunden, Upper Austria.

## Research question

> When and where did Simon Heydöcker die, the husband of Katharina and father of Juliana (born 15 June 1798) and Josef (born 11 October 1801) Heidegger at Laakirchen, Upper Austria?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GZRZ-TNG` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 36, `hint-samples.csv` row 39,
flags `adds_birth,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Österreich, Katholische Kirchenbücher, 1565-2007", a death entry for Simon Heydocker, born 1778, who died 24 August 1808; the index gives the place only as Austria, and the register image is from the Laakirchen death register beginning in 1807.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the August 1808 Laakirchen death, plus a `required` finding that the report documents
the rejection.

A strong candidate on name and parish. Heydöcker is a rare surname, the index spells it the same way bar the umlaut, and the children's Heidegger is a spelling of the same name; the register is Laakirchen's, the parish where both children were born. A birth about 1778 makes him 20 at Juliana's birth in 1798 and 23 at Josef's in 1801 — young but ordinary — and a death in 1808 fits a family with no children recorded after 1801. The tree's only sources are Matricula pages for the children's births and Josef's 1880 death, so none is a re-index of this entry.

What is thin is that the index names no wife, parents or house, so nothing ties this Simon to Katharina directly, and the birth year is an age at death turned into a year. The `adds_birth` flag is that computed year, not a baptism. The discriminating check is the Laakirchen death register entry itself: Upper Austrian death entries normally give the house and the man's status, and a house at Hochegg in Stötten (where Josef later farmed) or a widow named Katharina would settle it; a different house with a wife of another name would make this another Simon.
