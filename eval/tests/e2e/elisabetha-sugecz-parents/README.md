# Elisabetha Sugecz — parents Thomas Sugecz and Susanna Petrich

**Source PID:** `G4C9-Y6C`
**Elisabetha Sugecz is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree (married abt. 1814, Madžarevo, Varaždin, Croatia); died not recorded in the tree.

## Research question

> Who were the parents of Elisabetha Sugecz, wife of Thomas Pofuk-Harmicar of Madžarevo, Varaždin, Croatia?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G4C9-Y6C` with relatives). Nothing was
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

**Resolved 2026-07-31 — the hint is a false match, and no record answers the
question.** This fixture came from a hint batch (`filtered-list-samples.csv`
row 11, flags `adds_father`/`adds_mother`, confidence 3) in which roughly half
the records are false matches. This is one of them. `expected-findings.json` is
now a restraint test: an `avoid` finding on the hint's claim, plus a `required`
finding that the report documents the negative conclusion.

**What refuted the hint.** The hint record (`1:1:QKMN-XYBK` — baptism 14 August
1786, Madžarevo, parents Thomæ Sugecz and Susanæ Petrich) cannot be this woman,
on age. Her own attached sources place nine children's baptisms at **Remetinec**
between 1816 and 1837, and the 8 October 1837 baptism of Andreas Harmiczar
(`1:1:QKMN-LM5B`, attached in the tree to G4C9-Y6C) names Elizabethæ Sugecz,
wife of Thomæ Harmiczar, as his mother. An August 1786 baptism would put her at
**51** at that birth and 49 at Sophia's in 1836. Working back instead from a
sourced 1816 first child and a sourced 1837 last child places her own birth
around 1793–1798. The original draft note weighed 1786 only against the "abt
1814" marriage (age 28, plausible) and never tested it against the later
children — that omission is what made the hint look strong.

Two secondary checks point the same way. The record's own "Possible Tree Match"
is **LK25-1K1**, a bare September-2015 FamilySearch extraction stub with no
spouse, no children and no sources (parents likewise stubs, LK25-129 /
LK25-12S), so the hint cannot be rescued as an unmerged duplicate of
G4C9-Y6C — and FS lists no possible duplicates for either. Place also diverges:
the hint is Madžarevo, every one of her children's baptisms is Remetinec, and
her profile's "Madžarevo" marriage place carries no attached source at all.

**Why no substitute answer was encoded.** Searching *Croatia, Church Books,
1516-1994* for children of Thomæ Sugecz and Susanæ Petrich (Varaždin,
1780–1802) returns exactly two: Margaritha, 17 June 1783, and the Elisabetha of
1786 — so that couple has no later daughter of the right age, and the hint's
*parents* are wrong, not merely its record. A wider name search surfaces three
Madžarevo baptisms of an Elisabetha Sugecz, and only one survives the age test:

| Baptism | Parents | Verdict |
|---|---|---|
| 14 Aug 1786 (`1:1:QKMN-XYBK`) | Thomæ Sugecz + Susanæ Petrich | refuted — 51 at the 1837 birth |
| 15 Nov 1795 (`1:1:QKMN-XK63`) | Geor Sugecz + a Catharina | age fits (21 in 1816, 42 in 1837); **unlinked** |
| 28 Sep 1810 | Thomæ Sugecz + Hellenæ | impossible — age 6 at the 1816 first child |

The 1795 entry is already attached to a *different* tree person, **G4N9-RHT**
(Elisabetha Žugec, parents Georgius Žugec `G4CX-3LJ` and Catharina `G4CX-3LG`,
five siblings 1799–1811), who has **no spouse and no children** — so she is a
loose end, not a duplicate of the subject, and nothing links her onward to
Thomas Pofuk-Harmicar. Her mother's surname is unrecorded in both the index
(`Cath Sug??`) and the tree, which would make a thin expected finding even if
the identification were sound.

**What was searched and came up empty:** no indexed marriage entry exists for
Thomas Pofuk / Poffuk / Harmicar / Harmiczar with Elisabetha Sugecz / Žugec at
Madžarevo or Remetinec, 1812–1816 — checked under both surname spellings, and a
full name-search of the collection returns only baptisms, no marriage event. A
marriage record naming the bride's father is the one document that would have
settled this, and it is not in the indexed collection. Her nine children's
baptisms name her but never her parents. Note the coverage asymmetry that
probably explains the gap: the children are indexed at Remetinec while the
marriage is recorded at Madžarevo — a different register, unevenly covered.

**What this fixture therefore measures: restraint, not recall.** A pass means
the agent refused the 1786 attribution and documented why. Surfacing the 1795
baptism as an age-plausible *hypothesis* is good work and satisfies `f2`;
asserting it as her parentage is over-claiming, since no record connects that
girl to this woman. Absence from an index is not absence from the register, so
an unindexed Madžarevo marriage or an original-image read could still answer
this question later — anyone revisiting should start there.
