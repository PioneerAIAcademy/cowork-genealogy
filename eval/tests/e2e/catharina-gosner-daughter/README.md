# Catharina Gosnerin — daughter Magdalena Schedler (chr. 1743, Triesen)

**Source PID:** `KZS8-RS7`
**Catharina Gosnerin is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Joannes Schedler of Triesen, with four children christened there between 1741 and 1756.

## Research question

> Did Catharina Gosnerin and Joannes Schedler of Triesen, Liechtenstein have a daughter Magdalena, christened 12 June 1743?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KZS8-RS7` with relatives). Nothing was
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

**No independent second reader — PR review is the second read.** Issue #2310
asked for a named second opinion on the identity call. None was available, so
this landed with PR review standing in for it. **Reviewer: you are that second
read.** Please treat the verdict below as a proposal to check, not a settled
finding, and say so on the PR if you disagree.

Why the requirement was relaxed rather than met: it was written when the call
looked borderline, the wife-naming convention argument being genuinely
plausible. It stopped being borderline once the marriage record turned up —
a union dated 10 August 1751 against a christening of 12 June 1743 is
arithmetic, not judgement. What is written below is enough to re-derive the
call without repeating the research; the one thing that could overturn it is
named explicitly under "The loose end: Antonius, 1741".

**Verdict: false match (outcome 3).** The 12 June 1743 baptism of Magdalena
Schedler at Triesen belongs to a different couple. `expected-findings.json`
now carries an `avoid` guard against asserting her as Catharina Gosnerin's
daughter, paired with a `required` negative conclusion.

The draft's argument — since refuted — was that the record's
**Catharina Schedlerin** and the tree's **Catharina Gosnerin** are one woman
written two ways, the husband's surname with the feminine `-in` ending being
how eighteenth-century Alemannic registers name a wife.

**The marriage settles it.** Joannes Schedler married Catharina Gosnerin at
Triesen on **10 August 1751** (`ark:/61903/1:1:XLG8-6ZS`, "World Miscellaneous
Marriages, 1662-1945", collection 1809045). The 1743 christening precedes that
by eight years, so Magdalena cannot be a daughter of this marriage however the
mother's surname is read. The index falls in behind it exactly: mother
**Schedlerin** for the children of 1743, 1746, 1748, 1749 and 15 March 1751;
mother **Gosnerin** for 12 November 1751, 1754 and 1756. A first wife, then a
remarriage, then a second family.

That also explains the corroborating oddity rather than merely noting it: both
women bore a son named **Josephus** in 1751, christened **15 March**
(`ark:/61903/1:1:X5C1-98R`, mother Schedlerin) and **12 November**
(`ark:/61903/1:1:X5C1-9D3`, mother Gosnerin), eight months apart to a father
named Joannes Schedler in one parish. No single woman bore both. The November
entry is the source the tree already carries for the couple's son Josephus, so
the contradiction sits inside the fixture's own evidence.

The convention argument fails on its own terms too. This index records
maiden names in the `-in` form throughout — Frumeltin, Lampertin, Eberlin,
Neglinin, Buelerin, Selin, Pfeiferin, Schuelin, and Gosnerin itself — and
`Schedlerin` appears as the mother's name for several plainly distinct women
in these years (Maria, Barbara, Trina, Margaritha, Barfla). In a parish where
Schedler is the common surname, women born Schedler marrying Schedler men is
ordinary, and the register writes their maiden name like everyone else's.
Catharina Schedlerin has her own coherent sequence at Triesen: Magdalena
1743, Christina 1746, Wolfgangus 1748, Adamus 1749, Josephus 1751.

**What was searched and came up empty.** FamilySearch collection 1708589
("Liechtenstein, Births and Baptisms, 1650-1875"), surname Schedler, Triesen,
1735–1760: all **750** matching records enumerated across 8 pages — not a
ranked sample — of which 106 fall at Triesen proper. Catharina Gosnerin
appears as mother in only four (1741, 1751, 1754, 1756), and in no 1743
entry. The ten-year gap between 1741 and 1751 is real but is not filled by
this baptism.

**One thing is unresolved, and it is not the answer.** The 7 December 1741
christening of Antonius (`ark:/61903/1:1:X5CB-B3T`) names Catharina Gosnerin
as mother, yet the marriage is dated August 1751 — ten years later. Antonius
is attached to this couple in the starting tree. Four readings are open and
none has been tested: the 1741 entry is mis-indexed; there are two women
named Catharina Gosnerin at Triesen; the 1751 record is a convalidation of an
older union; or the 1741 father is a different Joannes Schedler. **This does
not touch the Magdalena question** — 1743 precedes 1751 on every one of those
readings — but a reader who notices it should know it was seen and left open,
not missed. Resolving it is a separate question about Antonius.

**Retrieval was tool-assisted** (spec §3.6): `dev/try-record-read.ts` and
`dev/try-record-search.ts` against live FamilySearch. Every ark cited above
was opened and read directly rather than taken from a search summary. The
identity judgement is the genealogist's.

**Provenance of the marriage record.** The adjudicator's own sweep covered
baptisms only and missed it; it was surfaced by the debug run of `/research`
against this fixture on 2026-09-23 and then verified independently against
live FamilySearch before being written here. Recorded because it changes
which record does the disproving, and because the original argument — the
1751 Josephus pair alone — was the weaker one.

**Two caveats a later reader should weigh.** The collection is *index-only* —
the 1743 entry carries no linked image or film reference, so the register
page cannot be consulted and the whole call rests on one indexing pass
(7 February 2020). And the index is visibly noisy: `Catharina Schedlerin`
appears with several different fathers (Joannes, Petrus, Peter, Stephan,
Stephanus), father forms vary (Hans, Johann, Joannes), and two separate
Josephus baptisms are both dated 12 November 1751 — one to Joannes and
Gosnerin, one to Stephan and Catharina Schedlerin — which looks like one
event indexed twice. That noise does not touch the March-versus-November
comparison, which turns on two different dates, but it is why the second
reader matters.
