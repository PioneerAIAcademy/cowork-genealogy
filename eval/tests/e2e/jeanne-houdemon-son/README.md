# Jeanne Houdemon — a son baptised in 1679 at Saint-Michel-de-la-Roë

**Source PID:** `GDD7-55R`
**Jeanne Houdemon is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 4 March 1642 at Saint-Michel-de-la-Roë, Mayenne; died 15 January 1713 and buried there the next day. Daughter of Pierre Houdemon and Marie Houillot. She married Michel Ferré at Saint-Michel-de-la-Roë on 7 February 1663; the tree gives them six children, three of them with baptisms (Michel 1671, Marguerite 1674, Marie 1682) and three undated (Jeanne, Michelle, Renée). Her sister Renée Houdemon (born 1644) is also in the tree.

## Research question

> Jeanne Houdemon married Michel Ferré at Saint-Michel-de-la-Roë, Mayenne, on 7 February 1663; the tree records their children Marguerite, baptised 18 April 1674, and Marie, baptised 29 December 1682. Did the couple have any child baptised between those two dates?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GDD7-55R` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 12, `hint-samples.csv` row 391,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "France, Mayenne, Parish and Civil Registration, 1427-1897", the baptism of François Ferré at Saint-Michel-de-la-Roë on 14 April 1679, son of Michel Ferré and **Jeanne Jourdan**. The index gives no godparents.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming François Ferré (bapt. 1679) as her son, plus a `required` finding that the report documents
the rejection.

A plausible candidate on father, place and date, with one obstacle: the mother's surname. The father's name and the parish match exactly, and April 1679 falls in the 1674–1682 gap between the couple's dated baptisms, when Jeanne was 37. The surname is the problem — the index reads **Jourdan**, not Houdemon. Against that, the indexers have already read her surname as Houdemon, Houderon, Houderoun, Goudron and plain "Jeanne" across her own sources, and "Jourdan" sits within that spread for a hand where H/G/J and -mon/-ron/-dan are easily confused. None of the tree's sources is this baptism.

The second risk is a competing household. Her sister **Renée Houdemon** also had children surnamed Ferré in the same parish (René and Marie, April 1678; Jacquinne, 1675; Marguerite, 1680), so there was more than one Ferré–Houdemon couple baptising children here in these years, and a Michel Ferré/Fevre also appears beside Renée in 1686. The discriminating check is the baptism image: read the mother's surname on the page, comparing it with how the same curé wrote "Houdemon" on the 1674 Marguerite and 1682 Marie entries, and the father's name against Renée's husband's on the 1678 and 1680 entries. If the 1679 entry reads Houdemon (or a recognisable form of it) with father Michel, the son is Jeanne's; a genuinely different surname, or Renée's husband as father, makes it someone else's child.
