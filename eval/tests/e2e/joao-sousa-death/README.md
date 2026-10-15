# João Gomes de Sousa — death in December 1919, Câmara de Lobos, Madeira, Portugal

**Source PID:** `GLRZ-VRK`
**João Gomes de Sousa is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 13 October 1851 in Câmara de Lobos, Madeira; the tree carries an undated Death fact. Son of João Gomes de Sousa (1811–1890) and Maria Corrêa Henriques (died 1892); the tree marries him to Ana Augusta de Jesus on 30 April 1865 in Câmara de Lobos.

## Research question

> When and where did João Gomes de Sousa, born 13 October 1851 in Câmara de Lobos, Madeira, son of João Gomes de Sousa and Maria Corrêa Henriques, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GLRZ-VRK` with relatives). Nothing was
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

**Resolved: answerable, but differently (outcome 2) — the death is genuine, the identity is unresolved.** Adjudicated 2026-10-13 by the assigned genealogist (#3341). This fixture comes from a hint batch (`filtered-list-samples-3.csv` row 20, `hint-samples.csv` row 698, flags `adds_death,adds_burial`, confidence 3). The hint, `ark:/61903/1:1:6YP6-D37M`, is the death of a João Gomes de Souza on 14 December 1919 in Câmara de Lobos, civil extract nº 480, book 9, registered 15 December, son of João Gomes de Souza and Maria Henriques, indexed "Barria" on this copy and "Correia" on the second copy (`6B9P-F8GR`). It is a real death in this family. What the evidence cannot establish is *which* João it is, so the expected finding is that the report leaves the 1851 João's death unresolved or names the competing candidate. It is not a guard against the 1919 date: the record may well be his.

**Two sons named João.** João Gomes de Sousa and Maria Correa Henriques had a son João baptised 10 November 1839 (`ark:/61903/1:1:F2W4-HXP`) and another João born 13 October 1851, baptised 13 January 1852 (`ark:/61903/1:1:6NGD-BL9Q`; the index names only the mother). The elder is the João Gomes de Souza, born 1840 and son of that couple, who married Anna Augusta de Jesus on 30 April 1865 (`ark:/61903/1:1:X911-WXWP`). He fathered children born 1865–1883 whose baptisms name the same grandparents, and is recorded as living and married at his son Francisco's wedding on 29 November 1905 (`ark:/61903/1:1:X91B-LBSN`). He would have been about 80 in December 1919. No record of the 1851 João was located after his baptism: no marriage, no children, no childhood death. He would have been 68. The tree's GLRZ-VRK merges the two: the 1851 birth sits on the elder brother's 1865 marriage and family, which is why the tree has him marrying at thirteen.

**Why the record cannot decide it.** Both copies of the entry FamilySearch holds are *extracts* ("Extracto do registo de obito"): the hint's image `ark:/61903/3:1:3Q9M-CSM5-Q9MC-1`, and a second copy indexed as `ark:/61903/1:1:6B9P-F8GR` (mis-dated 1900; image `ark:/61903/3:1:3Q9M-CSQ7-C9LL-L`). The extract form carries the name, parents, birthplace and the death and registration dates, but no age, marital status or spouse. The two 1919 Câmara de Lobos death volumes that `volume_search` returns (image groups 101516996 and 101795488) are both extract books. The full act, book 9 nº 480, which would give age and spouse, was not found among FamilySearch's images. The original register at the Arquivo Regional da Madeira may settle it.

**The draft's rival was the wrong man.** The draft named João Antonio de Sousa (L2B6-R63) as the alternative. His own family records name a wife, Maria Correa Henriques — daughter Adelaide's 1887 death (`ark:/61903/1:1:65YF-3Z3Z`) and son Manuel Antonio's 1903 marriage (`ark:/61903/1:1:X91B-C294`) — and that 1903 index flags both parents as deceased, which would rule him out of a 1919 death. The real rival is the elder namesake brother above. The tree's L2B6-R63 also carries the 1839 baptism (`F2W4-HXP`), which by its parents belongs to the elder João Gomes.

**Method.** Retrieval was tool-assisted (`dev/try-record-read.ts`, `try-record-search.ts`, `try-volume-search.ts`, `try-image-transcribe.ts`); the identity judgement was the genealogist's. Death searches covered "Portugal, Registro Civil, 1437-2023" and the Madeira Catholic registers, João Gomes de Sousa/Souza, Câmara de Lobos, 1851–1940, with the parents' names; Ana Augusta de Jesus's death was searched 1880–1940 without a usable match. The image readings are **unlicensed**: each extract page holds only one other entry (Ignacia de Jesus, nº 479), fewer than the two indexed neighbours the calibration check needs. The two transcriptions also disagree on the registrar's name. The parents' names come from the indexes. The one thing the resolution takes from the images is that the printed extract form has no age, marital-status or spouse field, which is a reading of the page rather than of handwriting; because the verdict rests on it, `image_basis` is on and the hint's image ark is cited in `expected-findings.json`.
