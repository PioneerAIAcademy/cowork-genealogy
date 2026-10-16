# Konrad Grubenmann — burial in March 1787, Teufen, Appenzell Ausserrhoden, Switzerland

**Source PID:** `KP47-72Q`
**Konrad Grubenmann is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 21 August 1698 in Teufen, Appenzell; the tree carries a Death fact of 17 March 1787 with no place and no source. Married Barbara Oberteufer on 19 April 1724; she died 18 February 1742. Their children were born 1727–1740 in Stein, Appenzell, and baptized at Hundwil.

## Research question

> When and where was Konrad Grubenmann, born 21 August 1698 in Teufen, Appenzell, who married Barbara Oberteufer in 1724, buried?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KP47-72Q` with relatives). Nothing was
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

**Resolved 2026-10-16 (#3346): true match.** The hint record
`ark:/61903/1:1:6FZ1-148K` ("Schweiz, Katholische und Reformiert
Kirchenbücher, 1418-1996", Teufen burial register) is the burial of tree person
KP47-72Q. f1 is revised in one respect: the same burial is also entered in the
Stein register, so f1 accepts either Teufen or Stein as the place. The hint came
from `filtered-list-samples-3.csv` row 26, `hint-samples.csv` row 882, flags
`adds_spouse,adds_burial`, confidence 3.

**Retrieval.** All of it used the `packages/engine/mcp-server/dev/try-*.ts`
scripts against live FamilySearch, which spec §3.6 permits for retrieval:
`try-person-read` on KP47-72Q and on his son KP47-CJ1;
`try-record-read` on the hint and on the Stein entry;
`try-record-read-index-fields` on those two and on the 21 Mar 1787 Teufen
entry, for the indexed ages (the other arks cited below come from search
results); `try-source-attachments` on the hint; and
`try-record-search` sweeps for Conrad and Konrad Grubenmann's burials
(1742–1800), for baptisms (1694–1704), for marriages (1742–1790), for an Anna
Reff, and for children of Conrad Grubenmann and Anna Reff. No page image was
read.

**Baseline.** The tree's only record sources for Konrad are two of his
children's baptisms (Jacob 1728, `ark:/61903/1:1:66JR-3LFG`; Ulrich 1734,
`ark:/61903/1:1:66V4-B623`). The tree's death date of 17 Mar 1787 has no source
and no place, and was probably copied from this register. The hint record is
attached to nobody, so it does not re-index anything the tree already holds.

**What decided it: the indexes alone.**
- **Age.** The hint's index gives his age as **88 years**. That is an indexed
  age field, not an estimate; the index's "born 1699" is just 1787 minus 88.
  Konrad was baptized 21 Aug 1698 in Teufen as Conradt Grubeman, son of Jacob
  Grubeman and Barbara Iller (`ark:/61903/1:1:6FZK-GBNL`), so he was 88 years
  7 months old. That matches the tree's birth date and parents. His marriage
  entry names him as Jacob's son (`ark:/61903/1:1:66J1-62P2`, Conrad
  Grubenmann × Barbara Oberteüffer).
- **The same burial, a second register.** A separate entry in the Stein burial
  register, on a different film (8195413, against Teufen's 8125885), records
  Conrad Grubenmann, **aged 88**, buried 17 Mar 1787 in Stein, wife Anna Väfin
  (`ark:/61903/1:1:6F88-WZBR`). Stein is where the family lived and where all
  of Konrad's children were born. One burial entered in both his home parish
  and his parish of residence fits him, and it is why f1 accepts either place.
  Which parish actually held the burial is not settled from the index.
- **The son is ruled out.** Hans Konrad Grubenmann (KP47-CJ1), baptized at
  Hundwil 28 Jul 1731 to Conrad Grubenmann and Barbara Obertrüfer
  (`ark:/61903/1:1:66VH-QD4S`), would have been 55, not 88. The tree gives him
  no spouse, death or record of his own.
- **No same-age namesake found.** The burial sweep turns up many other Conrad
  Grubenmanns in Teufen and Stein, and each has a different age or date:
  - one buried 21 Mar 1787 in Teufen, aged 81, wife Maria Fruch
    (`ark:/61903/1:1:6F8M-S5P8`);
  - one buried 1771, born about 1704 (`ark:/61903/1:1:6FZ1-R2C8`);
  - one buried 1771, born about 1706 (`ark:/61903/1:1:6FZ1-Y6JK`);
  - one baptized 18 May 1701, son of Conrad and Wibrath Hürler
    (`ark:/61903/1:1:6FZK-RN51`).
  
  No other Conrad Grubenmann baptized 1697–1700 turned up. This is
  **incomplete**: the year-filtered baptism searches did not return even
  Konrad's own 1698 baptism, which was found only by searching for his parents.
  So the sweep shows that no rival turned up, not that none exists.

**Left unproven: the wife.** The Teufen entry names Anna Reff and the Stein
entry Anna Väfin. No marriage of a Conrad Grubenmann to either name is indexed
for 1742–1790, and no baptism of a child to that couple was found. She would
be a second wife married after Barbara Oberteufer's death on 18 Feb 1742, and
the evidence does not establish that marriage. f1 records her as named in the
entries and does not grade her: only the burial is scored.

**What an agent must find.** The burial on 17 March 1787, from either register
entry above, with Teufen or Stein as the place.

**How this call was made.** The evidence was retrieved and the verdict drawn by
Claude Code, at the direction of the assigned genealogist (@Emruthwill), who
confirmed the outcome and the conditions above.
