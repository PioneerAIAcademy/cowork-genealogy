# Scenario: sealed-birth-open-index-unsearched

Fork of `decisive-skip-inaccessible` as it stood before 2026-11-17: Alan Glen
Applegarth (b. 1936, Ogden, Utah), parents established by the 1940 and 1950
censuses, the 1926 marriage and a 2023 obituary; his birth certificate
(pli_004) skipped as `inaccessible` under Utah's ~100-year seal.

**What makes it a decline.** The Utah Vital Records wiki page the agent reads
(`wiki-read-utah-vital-records`) lists one online birth source for 1936, the
FamilySearch index "Utah Births and Christenings, 1892-1941" (collection
1675542). No plan item and no log entry here searched it. The inaccessibility
exception applies only when the sealed record is the only known avenue, so the
index is an unsearched gap and the agent declines, naming it. The sealed
certificate is still not a gap.

Its pair is `decisive-skip-inaccessible`, which now carries pli_009 / log_011:
the same index searched, no entry. There the agent declares.

Used by `ut_research_exhaustiveness_021`.

`loc_001` (added 2026-11-18) is the saved locality guide for Weber County. It names the births index, which is how a real project carries a source the place has: the agent compares the guide with the log. Before this the index appeared only in the canned wiki page, and the agent missed it 7 times in 10 once that page was longer than 1,582 characters.

The 1926 marriage (`src_003`) is the county record viewed as a digital image on FamilySearch. Until 2026-11-18 its assertions carried an `ancestry:` record id while the source said `original` on FamilySearch; an agent read the id as an index-only source and declined on `original_substitution` about 1 run in 14.
