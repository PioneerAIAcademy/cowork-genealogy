# Elsa Brita Heikkinen — birth in May 1832, Iisalmi, Kuopio, Finland

**Source PID:** `M76V-5PF`
**Elsa Brita Heikkinen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 16 June 1832 in Iisalmi rural parish, Kuopio; the tree carries no birth and an undated Death fact. Her baptism names her parents as Anders Johan ("And Joh") Heikkinen and Lisa Pardanen; the tree also attaches Maria Eskelinen, who died in 1826, as a second mother.

## Research question

> When and where was Elsa Brita Heikkinen, christened 16 June 1832 in Iisalmi, Kuopio, Finland, daughter of Anders Johan Heikkinen and Lisa Pardanen, born?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `M76V-5PF` with relatives). Nothing was
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

**Resolved 2026-10-13 (#3333): true match.** The hint record
`ark:/61903/1:1:QLVK-ZPHR` ("Finland, Church Census and Pre-Confirmation
Books, 1600-1916") is tree person M76V-5PF, and f1 stands as drafted: born May
1832, Iisalmi. The hint came from `filtered-list-samples-3.csv` row 10,
`hint-samples.csv` row 359, flag `adds_birth`, confidence 3.

**Retrieval.** All of it used the `packages/engine/mcp-server/dev/try-*.ts`
scripts against live FamilySearch, not familysearch.org by hand:
- `try-record-read` on the hint, the tree's baptisms and the other Elsa Brita
  entries named below.
- `try-source-attachments` on the hint.
- `try-volume-search` for Iisalmi, 1851-1860.
- `try-record-search-film` on the hint's volume, image group 102151558.
- `try-record-search` of the church census (collection 2805467) and of
  "Finland, Baptisms, 1657-1890" (collection 1778464).

**Baseline.** The hint is attached to no tree person, including L83R-7VP, so
it re-indexes nothing the tree already holds. The tree's own baptism for the
subject (`ark:/61903/1:1:XBFJ-HS6`) gives christening 16 Jun 1832, Iisalmen
mlk, parents "and Joh Heikkinen" and Lisa Pardanen, and no birth date. The
same couple's children Christina (`1:1:XBFK-3C3`, chr. 26 May 1827) and David
(`1:1:XBFV-X4F`, chr. 11 Apr 1830) were also christened in Iisalmen mlk.

**What the hint says.** The 1851-1860 communion book of Iisalmi rural parish
lists Elsa Brita Heickinen at Kilpisaari, born May 1832, with no day. It is
indexed as her own one-person household, with no parents or co-residents. The
index's month is the date f1 asserts.

**What decided it: the indexes alone.**
- **Name.** Elsa Brita Heickinen. Heickinen is the parish's Swedish-form
  spelling, which the tree's 1822 baptism of Anna Greta Heickinen, under the
  same father, also uses.
- **Month and parish.** A May 1832 birth falls a few weeks before the 16 Jun
  1832 Iisalmen mlk christening.
- **Corroborating day, from other books.** Other Iisalmi communion-book
  entries for Elsa Brita Heikkinen give the full date **31 May 1832**, 16 days
  before the christening:
  - the 1851-1860 entries `1:1:QLJD-J32M` and `1:1:QLJ8-2451`;
  - the 1861-1870 entry `1:1:QLJR-G283`, at Kilpisaari, the hint's own
    village a decade later.

  That day is corroboration from those records, not a date the hint
  establishes. The hint's own index says only May 1832, which is why f1 keeps
  the month.
- **No competing candidate.**
  - **Baptisms, father Heikkinen.** Searching "Finland, Baptisms" for an
    Elsa whose father is a Heikkinen, 1831-1833, finds only two in Iisalmen
    mlk. One is the subject. The other is plain Elsa (`1:1:XBFJ-HSZ`), chr.
    16 Jan 1832, daughter of Ephr. Heikkinen and Anna Br. Sonninen. She is
    the "Elsa Efraimsdr. Heikkinen, b. January 1832" of Lapinlahti's church
    census, a different person born in a different month.
  - **Baptisms, father Heickinen.** The same search finds none in Iisalmi.
  - **Baptisms, mother Lisa Pardanen.** The same search finds only the
    subject.
  - **Church census, 1831-1833 births.** In collection 2805467 the only
    other Elsa Brita Heikkinen of 1832 in the parish is born November 1832,
    at Hernejärvi (`1:1:QLV2-CPNQ`). The month separates her.

**Limitation, weighed and accepted.** No indexed record ties the Kilpisaari
entry to Anders Johan Heikkinen and Lisa Pardanen:
- The only other person indexed on the hint's page (`3:1:3Q9M-CS49-B976-Z`)
  is Catharina Heickinen, b. 1823 (`1:1:QLVK-ZP4P`), who is not one of the
  tree's siblings.
- Neither parent appears at Kilpisaari in that volume.
- Elsa Brita (b. May 1832) is entered as a one-person household on several
  farms in the same book: Kilpisaari, Kääriänsaari (`1:1:QLVK-Z4DR`) and
  `1:1:QLV2-X3B2`. That is the pattern of a young woman in service away from
  her parents.

The genealogist judged that the missing parental link does not outweigh the
name, month, parish, the 31 May day across the later books, and the absence of
any competing candidate.

**Image: not read.** The page image was not transcribed. The indexes settled
the call, and the page has only one other indexed entry, too few to calibrate
a reading. `image_basis` is not set.

**The tree's own confounders, for the grader.**
- **L83R-7VP.** "Elsa Riitta Heikkinen", b. May 1832, is very likely a
  duplicate of the subject (Riitta is the Finnish form of Brita). An agent
  that spots and reasons from it is on the right track.
- **Maria Eskelinen.** The tree attaches Maria Eskelinen (d. 2 Feb 1826) as a
  second mother. The baptism names Lisa Pardanen, and Anders Johan's marriage
  to Eskelinen (`1:1:F8YL-54S`) predates the Pardanen children. The Eskelinen
  link should not be used to test this record.

**What an agent must find.** The birth in May 1832 in Iisalmi rural parish,
from the communion-book entry above. A run that also reports 31 May 1832 from
the later books is consistent with f1, not a miss.

**How this call was made.** The evidence was retrieved by Claude Code and the
identity verdict made by the assigned genealogist (@Emruthwill).
