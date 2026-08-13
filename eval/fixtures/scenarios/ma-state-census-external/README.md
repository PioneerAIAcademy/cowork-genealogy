# Scenario: ma-state-census-external

Mid-research state for an external-site search that targets a collection
**FamilySearch also holds** — the failure behind issue #1313.

- **Subject:** Josiah Barnes (`I1`), a synthetic (invented, not a real person)
  deceased Massachusetts man, born c. 1818, last placed in the 1850 census
  (Middlesex County). No 1855 result yet.
- **q_001** (`in_progress`): where was he in the 1855 Massachusetts State Census?
- **pl_001 / pli_001** (`planned`): a MyHeritage census search for the 1855
  Massachusetts State Census. The researcher has a MyHeritage subscription, so
  the search is legitimately actionable.

The point of this scenario: when `search-external-sites` executes the MyHeritage
search, the curated links (fixture `external-links-search-massachusetts`) include
MyHeritage's "1855 Massachusetts State Census" (collection-20822) — a collection
**FamilySearch hosts itself** (fixture `collections-search-massachusetts-census`,
FS collection 1459985). The skill should still build the MyHeritage URL the user
chose, but **note that FamilySearch also holds the 1855 census** and offer the FS
copy via `search-records`, rather than presenting MyHeritage as the sole source.
Silently recommending the competitor for an FS-held collection is the failure this
scenario guards against.

No PII: the subject is invented for this test. Reproduced live on 2026-08-10 (no
feedback zip was available for #1313); the fixtures replay the exact live tool
responses so a pre-edit run of the skill fails as required.
