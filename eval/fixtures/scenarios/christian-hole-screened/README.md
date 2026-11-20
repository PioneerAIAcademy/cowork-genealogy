# christian-hole-screened

The `christian-hole-quality` subject, Christian P. Hole (`KD96-TV2`), in a
project where `extraction_append({ personId })` (person mode) has already run,
so `source_screen` has extracted records to score and returns verdicts. Built
for `source-evaluation`'s `screen-verdicts-reported` test (issue #3504).

**Synthetic test data**, like `christian-hole-quality`: the persons and the
`HOLE-00x` records are authored fixtures with FamilySearch-shaped ids.

- **Tree:** `KD96-TV2` (Birth 1875 Norway, Marriage 1 May 1898 Polk, Residence
  1900 Fairview, Death 10 June 1945 Erskine), wife `KD96-TV3` Inger, son
  `KD96-TV4` Ole C. Four person-level attachments, each a tree source whose
  `url` carries the record's 1:1: ARK:
  - `S1` 1900 census, `HOLE-001` (`record-read-hole-1900-census`)
  - `S2` Minnesota death index, `HOLE-002` (`record-read-hole-mn-death-index`)
  - `S3` 1885 Minnesota state census, `HOLE-003`
    (`record-read-hole-1885-state-census`), a different Christian Hole: born
    1852, Otter Tail County, wife Bergit
  - `S4` 1898 Polk County marriage, `HOLE-004` (`record-read-hole-1898-marriage`),
    which indexes no birth for either party
- **research.json and results/** are NOT hand-written. They are the output of
  `runExtractionAppend({ projectPath, personId: "KD96-TV2" })` run offline
  against the tree above, with a `readRecord` that served those four fixtures'
  responses and staged them through `stageSearchResults`, exactly as a live
  `record_read` stages a read: four `record_read` log entries with sidecars,
  four sources, the extracted assertions, and the person-mode links to
  `KD96-TV2`.
- **`source_screen` on this project** is `source-screen-hole-screened`: the real
  tool's answer with checks a, b, c, h (no image read), and a stub matcher
  because FamilySearch's matcher answers 400 for these synthetic records. S3 is
  `misattributed` and names S1 and S2, whose birth years disagree with its
  1852; S1 and S4 are `fine`; S2 is `weak` (death 1954 against the tree's 1945).

To rebuild: re-run person mode the same way against a fresh copy of the tree and
replace `research.json` and `results/`, then call `sourceScreenTool` with the
same stub and checks and replace the fixture's `response`.
