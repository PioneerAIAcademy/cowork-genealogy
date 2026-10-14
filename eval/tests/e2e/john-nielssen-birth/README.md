# John Nielssen — birth 1844, Bygland or Åseral, Norway

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

**Resolved 2026-10-14 (#3339): true match, fuller answer (outcome 2).** The hint record is about the tree's John Nielssen. It is "Norway, Church Books, 1797-1958", the Bygland baptism on 17 October 1877 of Torjus (born 24 May), son of Jon Nilson, born 1846, and Anne Torjusdatter, born 1852, of Klep (`ark:/61903/1:1:683T-H1R2`). Its 1846 is the wrong year. John was born in **1844, in Bygland or Åseral parish**; the records conflict on the parish. The hint batch was `filtered-list-samples-3.csv` row 18, `hint-samples.csv` row 616, flag `adds_birth`, confidence 3.

**Baseline.** The tree's sources are the 1870 and 1872 "Norway, Baptisms, 1634-1927" entries for Ingeborg and Nils (`ark:/61903/1:1:NCWK-B8T`, `ark:/61903/1:1:NHF2-9RV` and their re-indexes). They name John Nielssen / John Nilsen and Anne Torjusdr / Thorgjusdr but give no ages and no farm. The hint record is attached to no tree person (`source_attachments`), so it is not a re-index of an existing source.

**What decided it: the 1875 census, on Digitalarkivet.** FamilySearch's "Norway, Census, 1875" index (collection 1529106) covers only Østfold, Akershus, Hedmark, Oppland, Buskerud and Vestfold, so the census is not searchable there. Digitalarkivet holds the Bygland returns (Folketelling 1875 for 0938P Bygland prestegjeld, Klep, https://www.digitalarkivet.no/census/rural-residence/bf01052207002757):

- **Household 02:** John Nilsen, married, born 1844 in "Aaserals S og Prgj" (person `pf01052207002762`); wife Anne Torjusdatter, born 1852; Nils Johnsen, born 1872; Ingeborg Johnsdatter, born 1870. The last three were all born in "Aardal S Bygland Prgj". This is the household the issue asked for: the tree's wife and both of the tree's children.
- **Household 01:** his father Nils Johnsen, born 1821 in Åseral; Ingeborg Grundesdatter, born 1813; and Gunstein (1856) and Birgit (1854) Nilsen/Nilsdatter, both born in Åseral.

**The year: 1844, not 1846.** There are three witnesses, and the two closest to the event agree:

- **1844 baptism** (`ark:/61903/1:1:683T-XFQ9`): John Nielsen Klefs, born 19 March, baptized 4 April 1844 in Bygland, son of Niels Johnsen and Ingeborg Grundsdatter of Klep. These are the same parents as the 1865 and 1875 households. It is recorded at the event, so it is the best witness for the date.
- **1865 census** (`ark:/61903/1:1:DDCG-V3ZM`): John Niltsøn, born 1843 in Åseral, single, at Klep in the household of Nils Johnsøn (born 1818), Ingeborg Grundesdatter and siblings Torgrim (1847), Berit (1849), Birgit (1853) and Gunstein (1855), all born in Åseral. That census recorded age, not birth year, so 1843 is one year from 1844.
- **1877 baptism** (the hint): 1846, a parent's age entered in his son's baptism 33 years later. This is the outlier.

**The place: Bygland or Åseral; the records conflict.** The finding accepts either parish.

- **For Bygland:** the 1844 baptism is the only record made at his birth. It was entered in Bygland's church book and puts the family at Klep, in Bygland, sixteen days after he was born.
- **For Åseral:** both censuses (1865 and 1875) give his birth parish as Åseral.
- **Why the censuses may be wrong for John:** the family's Åseral years come after 1844. His brother Torgrim was baptized at Breland in Åseral on 5 November 1848, born 24 September (`ark:/61903/1:1:6831-YXLF`, indexed as "Torgerine Ayesn", parents Niels Johnsen and Ingeborg). Gunstein was baptized in Åseral on 19 October 1856, born 20 September (`ark:/61903/1:1:68QM-DBKP`, indexed as "Gunstein Agenes", parents Nils Johnsen and Ingborg Gundersdatter). So "Aaseralds Prgj." is right for the children born 1847–1855 and may simply have been repeated for John.
- **The censuses are not independent:** both come from the same family on the same farm.

Nothing found settles it, so a run that names either parish, or reports the conflict, is right.

**The identity.** The 1875 household above settles it. The 1900 census confirms it after Jon's death (household `ark:/61903/1:2:4NLJ-PMN2`, "Klep, Nedenes"):

- Anne Torgjusd. Klep, widowed, born 1852 in Bygland (`ark:/61903/1:1:DDYV-D52M`).
- Nils Jonson Klep, born 1872 in Bygland (`ark:/61903/1:1:DDR4-TQT2`).
- Mari (1880), Siri (1884), Torbjørg (1887) and Torgjus (1889) Jonsdatter/Jonson. The second Torgjus suggests the 1877 Torjus died young.

Jon died between 1877 and 1900.

**Why the first pass missed him.** The 1865 search looked only in Setesdal and only for births in 1845–1847, following the hint's 1846. A man born in 1843–1844 in Åseral fell outside it, and the index's "Niltsøn" spelling did not rank him in the first page. He was found through his brother Gunstein. Other searches:

- **Marriage, 1865–1872:** none for the couple in Agder (all 250 results read).
- **Burial, 1877–1900:** none found. The country-wide death search has 3,949 results and only the top 100 were read; filtering by Bygland as the death place returned no burial records at all. Not proved absent.
- **1891 census:** neither Jon nor the Klep household appears in the index.

**Retrieval** was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts` against live FamilySearch). The 1875 census was read from Digitalarkivet's transcription, and no page image was read. The identity judgement is the genealogist's. One search caveat for whoever re-derives this: `record_search` returns 0 for any hyphenated county (issue #3455), so every search above was run at country level and filtered by the returned places.

The tree also holds two Ingeborg persons (christened 16 and 18 October 1870, PIDs M6W2-GR5 and M6W2-GY4). That is a tree duplicate and does not affect this call.
