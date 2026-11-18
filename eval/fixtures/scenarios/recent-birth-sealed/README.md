# Scenario: recent-birth-sealed

Parentage research for **Alan Glen Applegarth** (b. 29 Apr 1936, Ogden, Weber
County, Utah) that is thorough and sitting at the exhaustiveness assessment.

The parents — **John Obrien Applegarth** (I2) and **Olive Annie Harvey** (I3) —
are established from multiple independent sources: the 1940 and 1950 U.S.
censuses (Alan in the household), the 1926 Weber County marriage (the parental
couple + the mother's maiden name), and Alan's 2023 obituary (names his
parents). The other decisive record types have also been worked: church/LDS
christening (searched, nil) and the parents' probate (searched, nil).

The **one** plan item that is not done is `pli_004`, Alan's own **1936 Utah
birth certificate** — marked `skipped` because the record is **privacy-sealed**:
Utah seals birth records for ~100 years (public ~2036), released before then
only to the registrant or a direct heir on request. The record exists but is
**not reasonably obtainable** for this project (see `log_004`).

So the sealed birth certificate is the **sole remaining item** — which makes
the agent's handling of it decisive. Used by the `research-exhaustiveness` test
(`ut_research_exhaustiveness_017`) that verifies a privacy-sealed record is
**not** counted as an exhaustiveness gap and is **not** recommended as a
next step to obtain.

## The births index is searched (2026-11-17)

pli_009 / log_011 record a search of "Utah Births and Christenings, 1892-1941"
(FamilySearch collection 1675542) with no entry for Alan. The Utah Vital
Records wiki page the agent reads lists that index as the online birth source
for 1936; without the search a careful agent declines on it and never reaches
the sealed-record rule this scenario tests. The unsearched version is
`sealed-birth-open-index-unsearched`.

`pli_010` records Alan's 2023 Utah death certificate as skipped: Utah keeps death certificates closed for 50 years. Added 2026-11-18 so that every decisive record for the parentage question is accounted for in the project.

The 1926 marriage (`src_003`) is the county record viewed as a digital image on FamilySearch. Until 2026-11-18 its assertions carried an `ancestry:` record id while the source said `original` on FamilySearch; an agent read the id as an index-only source and declined on `original_substitution` about 1 run in 14.
