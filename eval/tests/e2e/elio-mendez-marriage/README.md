# Elio María Méndez — marriage in July 1924, Guaraque, Mérida, Venezuela

**Source PID:** `PQLG-9J4`
**Elio María Méndez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1910 in Tovar, Mérida (an estimate); the tree carries an undated Death fact. Husband of Domitila Castro (born about 1905, Tovar), with no marriage fact and no parents for either. Their children Elia Rosa (1926), José Ildemaro (1927), Ylda Antonia (1928) and José Angel (1929) were born in Guaraque and baptized at Santa Bárbara, Guaraque; Libsen (1931) was born in Tovar.

## Research question

> When and where did Elio María Méndez marry Domitila Castro, the mother of his children born 1926–1931 in Guaraque and Tovar, Mérida, Venezuela, and who were his parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `PQLG-9J4` with relatives). Nothing was
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

**Resolved 2026-10-16 (#3349): true match.** The hint record —
"Venezuela, Registro Civil, 1843-2021", marriage of Elio María Méndez and
Domitila Castro, 3 July 1924, Santa Bárbara, Guaraque, Mérida
(`ark:/61903/1:1:XSX4-1KWV`), naming his parents Ángel Méndez and Magdalena
Luna and hers Vicente Castro and Rosalina Rosalez — concerns tree person
`PQLG-9J4`. The findings stand as drafted; the hint ark is now cited in both.
It came from a hint batch (`filtered-list-samples-3.csv` row 30,
`hint-samples.csv` row 974, flags `adds_father,adds_mother,adds_marriage`,
confidence 3) in which roughly half the hints are false matches.

**The check the issue named came back empty.** No indexed baptism of the
couple's children names grandparents. Both indexes of each Santa Bárbara,
Guaraque baptism were read and give the parents only: Elia Rosa 7 Apr 1926
(`ark:/61903/1:1:QGKF-L6BP`, `VN54-XKV`), José Ildemaro 19 Mar 1927
(`QGKN-VB3L`, `VN54-R55`), Ylda Antonia 29 Feb 1928 (`QGKN-NMDH`,
`VN54-2GY`), José Angel 10 Nov 1929 (`QGKN-VVCG`, `VN54-LG7`), Oscar Olinto
14 Feb 1931 (`QGKN-N8RL`, `VN54-5JC`). One image was read: Elia Rosa's
baptism page, `ark:/61903/3:1:S3HY-6P4W-R8Z`, by `dev/try-image-transcribe.ts`.
It was checked against the two other indexed entries on that page. María
Dorotea Arellano Márquez (`VN54-XKF`, 4 Apr 1926, parents Nepomuceno Arellano
and Ramona Márquez) matched. Rosalía García Arellano (`VN54-XK5`) did not: the
index names her father Pedro Antonio García, the reading Isidro Antonio
García. The whole reading was therefore discarded and nothing here rests on
it. `image_basis` is off.

**Why it is a match anyway.** The call rests on the identification of the
couple and on Elio's own birth record, not on grandparents:

- **One couple.** Every Elio Méndez × Domitila Castro record in the
  Venezuelan indexes fits one family: Elia Rosa 1926, José Ildemaro 1927,
  Ylda Antonia 1928, José Angel 1929 and Oscar Olinto 1931 baptized at
  Guaraque; Trina Libsen 1933 (`QGK6-PLNQ`), Francisco Antonio 1934
  (`QGKX-G8QV`) and María Alba 1939 (`QGKX-PRLK`) at Nuestra Señora de Regla,
  Tovar. No second marriage of the pair and no colliding birth turned up.
- **Same parish.** The 1924 marriage is at Santa Bárbara, Guaraque, 21 months
  before Elia Rosa's baptism there.
- **His parents, independently.** José Elio Méndez Luna was born 2 Dec 1898
  at Tovar, son of Ángel María Méndez and Magdalena Luna (civil birth
  `ark:/61903/1:1:6KKX-J941`; baptism 12 Dec 1898, Nuestra Señora de Regla,
  Tovar, `ark:/61903/1:1:VNPC-7CS`). Tovar is the tree's birthplace for Elio,
  and José Ildemaro's 1927 civil birth (`6KPQ-ZNWZ`) gives Elio's birth as
  1899.
- **The groom carries his mother's surname.** The parish index of the same
  marriage, Archdiocese of Mérida (`ark:/61903/1:1:VN5H-SFS`), names him Elio
  María Méndez Luna and her Domitila Castro Rosalez, with the same four
  parents. It is not independent of the hint: the hint's image
  (`3:1:3QS7-L9G1-6KWY`) is on the same parish film as the QGKF baptisms, so
  the two are one register entry indexed twice.

The ruling was made by the assigned genealogist on the combined evidence: the
missing grandparents limit what can be claimed about the wider ancestry but do
not outweigh the consistent marriage, parentage, place and family chronology.

**Two details settled.** *Age:* neither marriage index states an age. The
tree's unsourced "about 1910" is wrong; he was born 1898 (above), about 25 at
the marriage. Elia Rosa's 1926 civil birth (`6KTL-CXJG`) gives his birth as
1895 at Guaraque — a minor conflict with the 1898 Tovar birth record. *Spelling:*
both indexes spell the bride's mother "Rosalez", as f1 does.

**Re-index check.** None of the tree's sources is this marriage, and no tree
person has `XSX4-1KWV` attached. The two Arquidiócesis de Barquisimeto sources
on Elio and Domitila (`6BK5-HB2N`, `6BK5-HB2J`) are the 22 Aug 1973 marriage of
their son Francisco Antonio Méndez Castro (born 1944) at Barquisimeto, not a
marriage of theirs. The hint's principal persona is indexed under the garbled
name "Eli María Castro Francisca"; the record's title reads "Elio María Méndez
y Domitila Castro".

**Tools.** Retrieval was tool-assisted (`dev/try-person-read.ts`,
`try-record-read.ts`, `try-record-read-index-fields.ts`,
`try-record-search.ts`, `try-source-attachments.ts`,
`try-image-transcribe.ts`; spec §3.6). The identity judgement is the
genealogist's.
