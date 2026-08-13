# Wasyl Kapach — birth in Ukraine and immigration to Canada

**Source PID:** `L17M-W4Q`
**Wasyl Kapach is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> When and where was Wasyl Kapach born, and when did he immigrate to Canada?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `L17M-W4Q` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Outcome (b) — answerable, but the birth YEAR differs — resolved
2026-08-12.** The identity is a confirmed true match: the hint record
`ark:/61903/1:1:QPR9-YLYV` (1926 Canada, Prairie Provinces, Census — Wasyl
Capach household, Athabasca, Alberta) is Wasyl Kapach (`L17M-W4Q`). But the
hint's **1883** birth year is wrong: he was born **1879**. Immigration **1906**
stands and the census is its only source. Birthplace stays "Ukraine" — no
source, not even Galicia, gives a sub-place — so the reworded question (dropping
"where in Ukraine") is correct.

**Why 1879, not 1883.** Three statements converge on 1879: Find a Grave
memorial #113540812 gives birth 1879, death 5 Dec 1948 at Smoky Lake, Alberta,
burial at Eldorena Ukrainian Catholic Church Cemetery plot 72, marriage to Maria
Antosko in 1909, and cites Alberta Vital Statistics death registration #007-198;
the shared headstone reads "KAPACH / MARIA 1893-1966 / WASYL 1879-1948 / EVER
REMEMBERED"; and the 7 Dec 1948 Edmonton Journal obituary gives his age as 69 at
a death on 5 Dec 1948, bracketing birth between 6 Dec 1878 and 5 Dec 1879. The
hint's 1883 is a lone 1926-census age estimate (age 43), and that census
under-ages the whole household in the same direction (wife Mary 1894 vs 1893,
daughter Natalka 1914 vs 1913) — the weakest of the four statements. Finding f3
guards against asserting it.

**Identity locked by the children, independently of the birth year.** Andrew
Kapach's memorial (#196999027) names his parents outright — Wasyl "William"
Kapach 1879-1948 and Maria "Mary" Antosko Kapach 1893-1966. The 1948 obituary
names one son and three daughters — Henry of Radway; Mrs. Annie Holowsky of
Boyle; Mrs. Natalka Rozak of Edmonton; Mrs. Lucey Borstad of Winnipeg — matching
the 1926 Athabasca census household four for four: Henry 1917, Anna 1911, Natalka
1914, Lucy 1921. The census son "Henry" is the tree's Andrew Kapach
(`LVFX-1PX`), who went by Henry. The census wife is Mary, matching the tree's
wife Mary Antosko (`L17M-72G`). Tekla Doliney Kapach (`L1K5-ZC3`) is Wasyl's
**mother**, not his wife.

**The bundled capture is mandatory, not a convenience.** The 1879 evidence has
NO resolvable `ark:/61903/` identifier: Wasyl is absent from FamilySearch's Find
a Grave index entirely — 0 hits for surname Kapach, 0 for given names Wasyl and
William, 0 in collection 2221801 for the 1946-1950 death window — so
`external_links_search` cannot reach it either. It is therefore bundled as an
external capture (spec §6.2) at
`provided-documents/findagrave-kapach-captures.pdf` (9 pages), which the harness
auto-copies into the workspace root. Its resolvable identifiers are Find a Grave
memorial IDs, not arks:

- Wasyl "William" Kapach — findagrave.com/memorial/113540812
- Andrew "Henry" Kapach — findagrave.com/memorial/196999027
- Mary Zubick Kapach — findagrave.com/memorial/196999006 — a DIFFERENT woman,
  included deliberately as a decoy the agent must reject (the correct wife is
  Mary Antosko, `L17M-72G`).

The only `ark:/61903/` still in play is the census, `ark:/61903/1:1:QPR9-YLYV`,
which carries the fixture's ark requirement (on f2) and is both the sole source
of immigration 1906 and the source of the wrong 1883.

**What this fixture measures.** (1) Reading the bundled documents; (2) finding
the 1926 census under the "Capach" C-initial transliteration — immigration 1906
exists only there, and a collection-scoped `record_search` on surname Capach in
collection 3005862 returns the full household; (3) preferring the headstone and
obituary (1879) over the census age estimate (1883).

**Rivals eliminated.** Wasyl Kapicky (`ark:/61903/1:1:QPRH-RDGT`, Vegreville
1926, b. 1896 Bukowina) sits in a Palahniuk household with no matching wife or
children. Wasyl Kapick (`ark:/61903/1:1:6KQZ-KXZ4`, Find a Grave, b. 1890
d. 1965) has no connection to a Mary or an Andrew/Henry.

**Known agent failure (being mined separately).** The Step 4 debug run failed to
find the census: it swept Kapach / Kapatch / Kopach / Kapacz across 15 indexed
searches, never tried the C-initial "Capach" variant, and then wrongly concluded
Wasyl is not name-indexed. That transliteration blind spot is being mined as a
separate `search-records` unit test.

**Changelog.**

- 2026-08-12: Resolved from DRAFT as a TRUE MATCH keeping the hint's 1883 birth.
- 2026-08-12: Revised to outcome (b) — birth year corrected to 1879 on the
  headstone/obituary/memorial evidence; census 1883 demoted to an `avoid` guard
  (f3); death added as a bonus finding (f4); Find a Grave capture bundled under
  `provided-documents/`.
