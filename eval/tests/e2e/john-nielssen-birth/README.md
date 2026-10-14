# John Nielssen — birth about 1846, Norway

**Source PID:** `KHKC-867`
**John Nielssen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for him — no birth. Wife Anne Thorgjusdr (Torjusdatter, undated); children Ingeborg, baptized October 1870 in Bygland, Aust-Agder (entered twice, 16 and 18 October), and Nils, baptized 6 October 1872 in Bygland. The couple has no marriage fact.

## Research question

> When and where was John Nielssen born, the husband of Anne Torjusdatter whose children Ingeborg (1870) and Nils (1872) were baptized in Bygland, Aust-Agder, Norway?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHKC-867` with relatives). Nothing was
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

**Resolved 2026-10-14 (#3339): true match.** The hint record — "Norway, Church Books, 1797-1958", the Bygland baptism on 17 October 1877 of Torjus (born 24 May), son of Jon Nilson, born 1846, and Anne Torjusdatter, born 1852, of Klep (`ark:/61903/1:1:683T-H1R2`) — concerns the tree's John Nielssen. The finding is his birth year, 1846. No record found gives his birthplace. The hint batch was `filtered-list-samples-3.csv` row 18, `hint-samples.csv` row 616, flag `adds_birth`, confidence 3.

**Baseline.** The tree's sources are the 1870 and 1872 "Norway, Baptisms, 1634-1927" entries for Ingeborg and Nils (`ark:/61903/1:1:NCWK-B8T`, `ark:/61903/1:1:NHF2-9RV` and their re-indexes). They name John Nielssen / John Nilsen and Anne Torjusdr / Thorgjusdr but give no ages and no farm. The hint record is attached to no tree person (`source_attachments`), so it is not a re-index of an existing source.

**What decided the identity: the 1900 census, not the 1875 one.** The 1875 census named in the issue cannot be checked on FamilySearch. The "Norway, Census, 1875" index (collection 1529106) covers only Østfold, Akershus, Hedmark, Oppland, Buskerud and Vestfold, and even the Setesdal surname Torjussen returns no Agder hits. The 1900 census does settle it (household `ark:/61903/1:2:4NLJ-PMN2`, "Klep, Nedenes"):

- Anne Torgjusd. Klep, widowed, born 1852 in Bygland (`ark:/61903/1:1:DDYV-D52M`).
- Nils Jonson Klep, born 1872 in Bygland (`ark:/61903/1:1:DDR4-TQT2`) — the tree's Nils, baptized 6 October 1872.
- Mari (1880), Siri (1884), Torbjørg (1887) and Torgjus (1889) Jonsdatter/Jonson. The second Torgjus suggests the 1877 Torjus died young.

The hint's mother — Anne Torjusdatter, born 1852, of Klep — is matched independently on name, birth year and farm. The household carries the tree's son Nils, and Jonson/Jonsdatter for the father. A second Jon Nilsen and Anne Torjusdatter couple at Klep with a son Nils born 1872 is not credible. She is widowed by 1900, so Jon died between 1877 and 1900.

**What stays thin: the year.** 1846 has one witness, the 1877 baptism. Nothing contradicts it, and nothing independently confirms it. These searches came up empty:

- **1865 census** (collection 3756102): no Jon Nilsen born 1845–1847 anywhere in Setesdal. Surname spellings are normalised, so all variants return one set, and every page was read. Anne Thorjusdatter, born 1851, is in her widowed mother Mari Olsdatter's Bygland household (`ark:/61903/1:1:DDCT-VG6Z`). Jon may have been born outside Bygland and married onto Klep.
- **Marriage, 1865–1872:** none for the couple in Agder.
- **Burial in Bygland, 1877–1900:** none for Jon Nilsen.
- **1891 census:** neither Jon nor the Klep household appears in the index.

A run that reports "born about 1846, birthplace not found" is right. A run that names a birthplace needs a record this search did not find.

**Retrieval** was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts` against live FamilySearch); the identity judgement is the genealogist's. Only index text was read; no page image. One search caveat for whoever re-derives this: `record_search` returns 0 for any hyphenated county (`Aust-Agder`, `Vest-Agder`, `Sør-Trøndelag`), even for Ole Olsen, so every search above was run at country level and filtered by the returned places.

The tree also holds two Ingeborg persons (christened 16 and 18 October 1870, PIDs M6W2-GR5 and M6W2-GY4). That is a tree duplicate and does not affect this call.
