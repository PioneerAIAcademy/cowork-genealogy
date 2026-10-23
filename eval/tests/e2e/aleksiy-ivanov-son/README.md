# Алексий Васильев Иванов — the 1885 Samara "son Павел" hint is a false match

**Source PID:** `L8PL-3W8`
**Алексий Васильев Иванов is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No birth or death date in the tree; it carries an undated Death fact. Husband of Елизавета Васильева; father of Виктор, born 29 October 1894 in Samara, and Павел, born 15 February 1902 in Samara. His only attached source is Виктор's 1894 birth entry in the Samara metrical books, which names the parents as Алексей Васильев Иванов and Елизавета Васильева.

## Research question

> What children did Алексий Васильев Иванов of Samara, husband of Елизавета Васильева and father of Виктор (born 29 October 1894) and Павел (born 15 February 1902), have besides these two?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L8PL-3W8` with relatives). Nothing was
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

**Resolved: FALSE MATCH** (adjudicated 2026-10-22). Retrieval was tool-assisted
(MCP `record_read` / `image_transcribe` / `record_search` against live
FamilySearch); the identity judgement is the genealogist's. The hinted record —
"Россия, Самарские метрические книги, 1748-1934", birth of Павел Иванов,
2 November 1885, Samara (`ark:/61903/1:1:6V7Y-N9KZ`, Pavel's child persona; the
hinted persona is his father Vasiliy, `ark:/61903/1:1:6V7Y-N9K6`, used as
`hint.persona_ark`) — is **not** a son of the subject. Its parents are **Василий Иванов** and **Степанида Иванова**, peasants
of the village of Sarbon; the subject is **Алексей (Алексий) Васильевич Иванов**
of Samara, husband of **Елизавета**. The hinting engine matched only on the
surname Ivanov (the commonest Russian surname), the Samara region, and the son's
name Павел — a name the subject's family does carry, but for a different son born
in **1902** (`L8PL-3WN`, already in the starting tree), not 1885.

Two readings could have kept the hint alive; the register image closed both.
(1) The indexer might have read the father's patronymic "Васильевъ" as the given
name "Василий" — i.e. the father was really "Алексей Васильев" (the subject). The
1885 page image (`ark:/61903/3:1:3QSQ-G99H-SF57`, entry 107) is written
**"Василій Ивановъ"** — a given name Vasiliy, not a patronymic — so this is
disproven, not a reading artefact; the mother is **Степанида**, not Елизавета.
(2) The DigitalArtifact's catalogue coverage reads 1871–1875 against the indexed
1885 date; the page header reads **"Метрической книги на 1885й годъ"**, confirming
the page is 1885 and the indexed year is correct.

**Image reading licensed (calibration).** Because the father's-name reading rested
on the page image, two other indexed entries on the same image were read and
compared to the FamilySearch index: entry 103 **Прасковья Ефимова**
(`ark:/61903/1:1:6V7Y-N9KQ` — father Игнатій Ефимовъ, mother Екатерина Алексѣева,
1 Nov 1885) and entry 106 **Димитрій Максимовъ** (`ark:/61903/1:1:6V7Y-N9VJ` —
father Петръ Максимовъ, mother Агафья Егорова, 24 Oct 1885). Both matched the
index exactly, so the reading of the target entry is licensed for
child/father/mother/date (`image_basis: true`).

**Searched and empty.** A collection search of "Россия, Самарские метрические
книги" for Павел Иванов births in Samara, 1884–1886, returns many unrelated Ivanov
families (the name is ubiquitous there), none tying to Алексей and Елизавета. No
record establishes any additional child of the couple beyond Виктор (1894) and
Павел (1902). The fixture therefore tests that the agent declines the hint and
documents the negative conclusion rather than attaching the 1885 Pavel.

**Second opinion (Isaac Boateng).** A second genealogist, Isaac Boateng,
independently reviewed the case and concurs with the false-match conclusion: the
1885 birth record is that of Павел, son of **Василий Иванов (Vasiliy Ivanov)** and
**Степанида Иванова (Stepanida Ivanova)**, and **not** a son of Алексий Васильев
Иванов (`L8PL-3W8`). As grounds he cites the differences between the two families
in the **parents' given names**, **social class**, **residence**, and **parish**,
and the fact that Алексий already has a **separate son Павел, born in 1902**
(`L8PL-3WN`). This is a concurring genealogist's *assessment*, distinct from the
primary record evidence set out above — the documentary basis for the conclusion
remains the 1885 birth record (`ark:/61903/1:1:6V7Y-N9KZ`) and its page image
(`ark:/61903/3:1:3QSQ-G99H-SF57`); Isaac's opinion corroborates that reading rather
than adding new record evidence.
