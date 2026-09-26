# Joanni Jacobo Clotten — marriage to Maria Magdalena Weber, 30 June 1716

**Source PID:** `MZ13-TN6`
**Joanni Jacobo Clotten is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; father of two children christened at Boppard/Oberwesel, Rheinland in 1717 and 1720.

## Research question

> When did Joanni Jacobo Clotten marry the 'Mariae Magdalenae' the tree records as his wife, and what was her surname?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `MZ13-TN6` with relatives). Nothing was
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

**Resolved: TRUE MATCH** (outcome (a)) — adjudicated 2026-09-25 against the
register image, not the index alone.

**The verdict.** The hint is the marriage of this tree's Joanni Jacobo Clotten
(`MZ13-TN6`). Entry 4 on image `ark:/61903/3:1:3Q9M-CSJG-4SKS-Y` reads
*"30. Juni 1716"*, Johannes Jacobus Klotten and Maria Magdalena Weber. The
findings stand as drafted, with one field corrected (below).

**What decided it was the parish, and it matches.** The draft's open question
was whether the 1716 marriage was in the same parish as the 1717 and 1720
christenings, since a Trier-diocese marriage forty kilometres away would be a
different couple. It is not: the register volume is Boppard Catholic marriages
1711–1794, and the tree places both christenings at Boppard Oberwesel. Same
parish grouping, same denomination.

**One field corrected, and it was a draft slip rather than a different answer.**
`f1`'s place read `Rheinland, Bistum Trier`, which is the *collection title*
(`Deutschland, Rheinland, Bistum Trier, katholische Kirchenbücher, 1543-1958`),
not the event place. The record's own marriage fact gives `Boppard, Sankt Goar,
Rheinprovinz, Preußen, Deutschland`. The couple, the date and the event type are
unchanged, so this stays outcome (a); only the jurisdictional level moved, from
the diocese down to the parish the record actually names.

**This tightens the finding deliberately.** Under the date/place denotation rule
(`docs/specs/e2e-test-spec.md` §7.1), a place that merely *contains* the claim is
not `supported`, so a run answering "Bistum Trier" now fails `f1` where the draft
would have passed it. That is intended: the indexed record hands Boppard to the
agent directly, so reaching the parish is a fair bar.

**Step 1a image-reading calibration — passed.** The entry was read by eye from
the scan, which the calibration rule covers. Two other entries indexed by
FamilySearch from the same image were read and compared:

| | index | register | |
|---|---|---|---|
| `1:1:D6JH-CD2M` | Simon Lamberti + Margaretha Geiss, 16 Jun 1716 | as indexed | match |
| `1:1:D6JC-6VMM` | Antonus Lamberti + Anna Nassen, 14 Sep 1716 | as indexed | match |

Both match, so the reading is licensed. Note the rule names *child, father,
mother and date*, framed for a baptism; on a marriage entry the analogue applied
here is **groom, bride and date** — three compared fields, not four.

**What the calibration does not license.** It covers the compared fields. The
**parish** is not one of them: Boppard comes from the register volume's own
identity (the `ChurchMarriage` artifact's coverage, 1711–1794) and from the
place on every indexed entry of that page, not from a field checked against the
index on the entry itself.

**What was searched and did not settle it.** The same marriage is indexed four
times, from four separate filmings of the register — `3Q9M-CSJG-4SKS-Y`,
`3Q9M-CSJG-S95C-M`, `3Q9M-CSJG-4SK5-R` and `3Q9M-CSTY-3C43` — under both the
`Klotten` and `Clotten` spellings, all agreeing on 30 June 1716 at Boppard. The
`S95C-M` filming was also read and carries **no** 30 June 1716 entry, so
pagination differs between films; that absence is a fact about that film, not
about the register. A first pass over `4SKS-Y` also missed the entry before a
closer reading found it at position 4 — worth recording, because an absence on
one reading of one film is weak evidence either way.

**Not our couple, checked and excluded:** `Joannes Eltten` + Anna Gertrude Volck,
15 Jan 1716 at Boppard (`1:1:D6JC-6FN2`) — a plausible-looking mis-indexing of
`Klotten`, but a different given name, bride and date. `Joes Clotten` + Agnete
Jacobs, 26 Jan 1717, is a second Clotten marrying at Boppard within the year; the
surname is locally common, which is a caution for identity confidence rather than
a competing candidate here.

**Corroborating, unchanged from the draft:** the tree records the wife as a bare
"Mariae Magdalenae" with no surname — the state baptismal entries alone leave
behind — and the hint supplies **Weber**. A marriage on 30 June 1716 sits fifteen
months before the first christening (3 October 1717). `Clotten`/`Klotten` is one
name; the tree's own sources already drift as far as `Dotten`.

**Provenance.** Retrieval was tool-assisted (`dev/try-record-read.ts` and
`dev/try-record-search.ts` against live FamilySearch) per `e2e-test-spec.md`
§3.6. The identity judgement and the register reading were the genealogist's.

