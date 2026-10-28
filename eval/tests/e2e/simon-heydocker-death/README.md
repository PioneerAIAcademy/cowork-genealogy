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

**Resolved: false match (1808 hint) with substitute confirmed — Simon Heydöcker died 6 April 1836 at Stötten (Nötten), house 14, Laakirchen, aged 68.** The hint — "Österreich, Katholische Kirchenbücher, 1565-2007", the Laakirchen death entry for Simon Heydocker, died 24 August 1808, aged 30 (born about 1778), place indexed only as Austria (`ark:/61903/1:1:6VYC-Q9W5`) — is a different, younger Simon. `expected-findings.json` is a `"polarity": "avoid"` guard against that death (f1) plus a required positive finding that the agent writes the 6 April 1836 death (f2). The heading above still names the rejected hint, as in other resolved false-match fixtures; it is not the answer.

The tree gives little to test against: Simon and Katharina carry no sources, and the children's sources are Matricula page images, not indexed records, so the hint is not a re-index of anything attached (`source_attachments` returns it unattached). The indexes alone decide it:

- **Marriage, 18 November 1787, Laakirchen** (`ark:/61903/1:1:6VYC-29XS`), the deciding record: Simon Hegdöcker, **aged 21** (born about 1766), and Katharina Plank, born about 1768.
- **Seven baptisms at Laakirchen to Simon Heydöcker and Katharina Plank(in)**: Maria, 12 January 1789 (`ark:/61903/1:1:6VYH-61Z5`); Magdalena, 25 June 1790 (`ark:/61903/1:1:6VYH-4T54`); Johann, 18 June 1791 (`ark:/61903/1:1:6VYH-BLRG`); Katharina, 14 October 1792 (`ark:/61903/1:1:6VYH-GT9D`); Simon, 1 August 1795 (`ark:/61903/1:1:6VYH-2WKD`); Juliana, 15 June 1798 (`ark:/61903/1:1:6VYH-C1S3`) — the tree's Juliana; and Joseph, 7 October 1801 (`ark:/61903/1:1:6VYH-6C3N`) — the tree's Josef (the tree gives 11 October). These tie Katharina's surname, Plank, to the tree's couple.
- **The hint's man was 30 in August 1808**, born about 1778: about nine at the 1787 marriage and ten at Maria's birth. He cannot be Katharina's husband.

The register image was also read, as corroboration only (`image_transcribe` on `ark:/61903/3:1:S3HY-DBP9-FC`, film 004197022 image 46). Calibration: two other indexed entries on the same page, Mathias Wanchamer (died 24 July 1808, aged 74, `ark:/61903/1:1:6VY4-8J7L`) and Elisabeth Senbergerin (died 26 October 1808, aged 79, `ark:/61903/1:1:6VYC-Q9HK`), matched the index on name, date and age, so the reading is licensed for those fields. It reads the hint entry as "Simon Heÿdecker, lediger Inwohner zu Oberzköckham", house 45, aged 30, died of gangrene after an injury. The status *lediger* (unmarried) and the house are not fields the calibration compared, so they are not licensed and the call does not rest on them. `image_basis` is off.

**Searched and not verified as his death** (after Joseph's 1801 baptism): FamilySearch record search, all Austrian records, for Simon Heidegger as a death 1798–1860 and for Simon Heydocker with any event 1740–1860 (FamilySearch's name matching also returned Heydöcker, Heydecker, Heudecker and Hegdocker spellings), and for a Katharina with spouse Simon Heidegger, any event 1790–1850. Laakirchen deaths of a Simon: 24 March 1814, aged 63 (`ark:/61903/1:1:6VYC-Q94Q`; born about 1751, too old); 22 December 1821, aged 27, son of a Simon (`ark:/61903/1:1:6VY4-6DVY`; the son born 1795, not the father); and 6 April 1836, no age indexed (`ark:/61903/1:1:6VYC-Q99N`). A Simon Heidegger died at Linz on 8 April 1834 aged 67 (`ark:/61903/1:1:6VTT-RT5H`); the place is not Laakirchen and nothing ties him to Katharina. The 6 April 1836 Laakirchen entry (`ark:/61903/1:1:6VYC-Q99N`) is Simon's death record. A re-read of its image page (`ark:/61903/3:1:S3HY-DBPS-JD`, image 64) on 2026-10-26 found both calibration neighbours agreeing with the index: Anna Maria Pomayr aged 63 ✓ (`ark:/61903/1:1:6VYC-QM1Z`) and Peter Lietmayr aged 35 ✓ (`ark:/61903/1:1:6VYC-Q9SH`, 2 June 1836). The image reads: "Nötten | 14 | Simon Heydocker beschwerter Auszügler | Kath. | 68 | Gicht." Age 68 at death 6 April 1836 places birth ~1768, consistent with the 1787 marriage aged 21. House Nötten 14 is the same property where son Josef Heidegger lived until his 1880 death. The fixture is re-resolved as outcome 2: the 1836 death is confirmed. (An earlier calibration run by the fixture author read Pomayr as aged 53 — that was a one-off model reading error; the index and the 2026-10-26 human re-read both give 63.)

The avoid guard exempts GZRZ-TNG, so an 1808 death written onto him is graded by the judge alone. A stub person for the 1808 Simon with a death fact is caught mechanically — and so would be a stub for the son Simon (born 1795) carrying his 1821 death, a false positive the guard cannot tell apart; no such stub is expected from this question.

Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-person-read.ts`, `try-source-attachments.ts`, `try-record-read.ts`, `try-record-read-index-fields.ts`, `try-record-search.ts`, `try-record-search-film.ts`, `try-image-transcribe.ts` against live FamilySearch; spec §3.6). The identity judgement was the genealogist's.
