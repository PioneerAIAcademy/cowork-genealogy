# england-census-timeline

Minimal non-US timeline scenario for issue #2261 (timeline reads census years from the jurisdiction's `{Country}_Census` wiki page, not the US federal schedule).

**Subject:** William Ashford, b. ~1838 Canterbury, Kent, England; d. 1874 Canterbury. Documented facts: birth (~1838), 1851 census residence, marriage (1859), death (1874) — all in England.

**What it exercises:** the person is alive and resident in England across the English decennial censuses of 1841, 1851, 1861, and 1871. Only 1851 is documented, so the timeline should surface gaps expecting the **English** census years (1841, 1861, 1871) — none of which are US federal census years. The census years must be read from `England_Census` (fetched via `wiki_read`), not assumed from the US schedule. All persons are deceased.

Authored for the `census-from-wiki` unit test `ut_timeline_eng`; kept intentionally small (one person, four facts) so the expected English census years are deterministically checkable against the `wiki-read-england-census` fixture page.
