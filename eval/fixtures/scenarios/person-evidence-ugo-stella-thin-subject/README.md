# person-evidence-ugo-stella-thin-subject

Ugo Stella, known only by his name, and a 1942 Milan marriage that names a man of the
same name as the bride's father: the alpha-feedback case behind issue #2213 d29.

- **Questions:** 1 — q_001 (`in_progress`). **Plans:** 1 — pli_001 `in_progress`.
- **Log:** log_001, `record_search`, `positive`, results in `results/log_001.json`.
- **Sources:** src_001, the 1942 marriage. **Assertions:** a_001-a_009, extracted:
  a_001-a_002 father of the bride (Ugo Stella, persona P1), a_003 mother of the bride
  (Giuseppa Bilancioni), a_004-a_008 the bride (Mafalda Stella, b. 1908 Sassoferrato),
  a_009 the groom. **Person evidence:** 0.
- **GedcomX persons:** I1 (Ugo Stella) — a name and nothing else.

`same_person` scores P1 against I1 at 0.02. The name is all the two share, and the tree
holds nothing else to compare.

## What the skill must do

Make no `probable` or `confident` link of a_001-a_002 to I1, and add no fact to the
tree: the record's Ugo Stella is a possible namesake. Graded by
`test_thin_subject_namesake_not_linked` (tag `thin-subject-namesake`).

Reconstructed from the Ugo Stella alpha feedback as issue #2213 records it (bundle feedback-2026-09-22T15-34-02-839294Z.zip): the record's ids and the groom are hand-authored.
