# Matěj Janovský — wife Kateřina Votýpková and children Anna (1869) and František (1874), Malšice, Bohemia

**Source PID:** `GMBS-DQZ`
**Matěj Janovský is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1843; the tree carries an undated Death fact. Married Kateřina Votýpková (born about 1847) on 27 October 1866 at Malšice, Tábor, Bohemia; the tree gives the couple no children. The tree attaches him as a son of Jan Janovsky and Anna Puncochar of Žabonosy and Radim, Kolín district.

## Research question

> Matěj Janovský, born about 1843, married Kateřina Votýpková at Malšice, Tábor, Bohemia on 27 October 1866. Who were his wife or wives, and which children were born to him?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GMBS-DQZ` with relatives). Nothing was
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

**Resolved: FALSE MATCH, answerable differently (outcome 2)** (adjudicated 2026-10-28;
identity `different`; `image_basis: true`). Retrieval was tool-assisted (`dev/try-record-read.ts`,
`dev/try-record-search.ts`, and `dev/try-image-transcribe.ts` for the register pages); the
genealogist opened the deciding records on familysearch.org and made the identity call.

**The hint is another man.** The hint (`ark:/61903/1:1:657F-BZDF`, father persona in the
26 Jan 1874 Malšice baptism of Josef, `ark:/61903/1:1:657F-BZDD`) names a Matěj Janovský and a
mother Marie, with no surnames. Malšice was home to at least three married Matěj Janovskýs in the
period, each indexed with his own parents:

| Groom | His parents | Bride | Marriage | Index ark |
|---|---|---|---|---|
| **Tree person**, b. ~1843 | Ján Janovský & Anna Háková | Kateřina Votýpková (dau. Josef Votýpka & Anna Peštová) | 27 Oct 1866 | `ark:/61903/1:1:QG1P-HL64` |
| b. ~1840 | Matěj Janovský & Anna Matějčková | Marie Sokorová (dau. Vojtěch Sokora & Anna Hermanová) | 23 May 1871 | `ark:/61903/1:1:QG1P-68DD` |
| b. ~1840 | Václav Janovský & Kateřina Háková | Marie Fialová | 7 Jan 1873 | `ark:/61903/1:1:QG1P-QKZ7` |

**What decided it (direct evidence).** The baptism of **František**, born 4 Oct 1874 at Malšice
no. 80 and baptised the next day (`ark:/61903/1:1:657F-KZ8N`), is indexed to "Matěj Janovský" and
"Kateřina". Its register page (`ark:/61903/3:1:3QSQ-G93W-H9L5-B`) names the father as **son of Jan
Janovský and Anna Haklová (Háková)** and the mother as **Kateřina, daughter of Josef Vo[týpka] and
Anna Peštová**, the same parents as on the 1866 marriage. So eight months after Josef's January 1874
baptism, the tree person was still married to Kateřina and having children with her. No Malšice
burial of a Kateřina Janovská (1866–1890) and no second marriage of the tree person turned up in
"Czech Republic, Church Books, 1552-1981", so the remarriage reading has nothing behind it. The two
grooms who married a Marie before 1874 are the hint's candidates.

**Image calibration.**
- **František's page (`3:1:3QSQ-G93W-H9L5-B`): licensed.** Two other indexed entries on the page
  were compared and both matched on child, father, mother, day and month: Marie Šedivá (b. 24, bp.
  25 Sep 1874, father Václav Šedivý, mother Anna; `ark:/61903/1:1:657F-TVSR`) and Marie Matějčková
  (b./bp. 25 Sep 1874, father Jan Matějček, mother Veronika; `ark:/61903/1:1:657F-KZZW`). The OCR
  labelled the year column "[1870]", carried down from the page's first row; the index has all three
  entries in 1874, so the year comes from the index, not the reading. The house number (no. 80) is
  not licensed by the check and is not relied on.
- **Josef's page (`3:1:3QSQ-G93W-H9LR-R`): unlicensed.** Only one other entry on the page was found
  in the index (Josefa Černá, b. 28, bp. 29 Jan 1874, father Vojtěch Černý, mother Veronika;
  `ark:/61903/1:1:657F-BZXY`, which matched). The model's OCR misread the other page-mates' names
  (a reviewer reads them as Terezie Marie Papáčová, Marie Švecová and Jan Fiala), so the searches run
  under the OCR spellings found none, and the page was not licensed. Unchecked, the reading points at
  the 1871 groom of Marie Sokorová. **Nothing in the fixture rests on that reading**: f3 names neither
  of the two other grooms as the hint's father, and the rejection stands on the licensed František
  page and the indexes alone.

**The findings.**
- **f1 (required)** is František, born 1874, mother Kateřina Votýpková, image-confirmed.
- **f2 (not required)** is a daughter Anna, b. 17 May 1869, bp. 18 May 1869
  (`ark:/61903/1:1:657F-1961`), indexed to "Matěj Janovský" and "Kateřina". Her page
  (`ark:/61903/3:1:3QS7-L93W-H9JM-4`) was not read, so her link to this Matěj rests on him being the
  only Matěj Janovský found marrying a Kateřina at Malšice. That is why she is not required.
- **f3 (avoid)** fails an agent that gives Matěj a wife Marie or the son Josef (1874). Its
  description says only that the hint belongs to another Matěj Janovský who married a Marie at
  Malšice before 1874; the indexes leave two such grooms (1871 and 1873) and it names neither. Its
  `target_person` is "Marie Janovská", the wrong wife under her married name, rather than Josef,
  because the starting tree already holds Matěj's brother **Josef Janovský** (`LZG9-NLS`); naming
  Josef would make the avoid-guard's name matcher fire on the brother in every run. The judge still
  grades the Josef half from the description.

Other Matěj-and-Marie baptisms at Malšice belong to the same other family and are not the tree
person's: Anna, bp. 11 Jan 1875 (`ark:/61903/1:1:657F-1SW2`), and František, bp. 12 Feb 1877
(`ark:/61903/1:1:657F-YVF4`).

One thing to note in passing: the 1866 marriage entry indexes the groom with an Anna Háková, while the tree's mother for him is Anna Puncochar of the Kolín district, some 80 km away. The tree's parents for Matěj may be a separate mis-attachment. That does not affect this question.
