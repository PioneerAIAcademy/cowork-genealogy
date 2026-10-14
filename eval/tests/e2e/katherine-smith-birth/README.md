# Katherine Ganden Smith — birth in July 1831, Bermondsey, Surrey, England

**Source PID:** `GLPD-4GL`
**Katherine Ganden Smith is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, no parents and an undated Death fact. Wife of Richard Henry Cullen (christened 1828 at St Mary Magdalene, Bermondsey); children Kate Kingsnorth Cullen (born 17 April 1852) and Richard Alma Cullen (born 1854), both in Camberwell.

## Research question

> When and where was Katherine Ganden Smith, wife of Richard Henry Cullen and mother of Kate Kingsnorth Cullen (born 1852 in Camberwell, London), born, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GLPD-4GL` with relatives). Nothing was
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

**Resolved 2026-10-14: true match.** The hint record (`ark:/61903/1:1:C6B4-MMW2`) is the birth of tree person Katherine Ganden Smith `GLPD-4GL`. Her nonconformist birth entry gives 12 July 1831, New Church Street, Bermondsey, Surrey, and names her parents as James Smith and Mary Ann Hunt. The identity call was made by the assigned genealogist (@Emruthwill). Retrieval was tool-assisted: `packages/engine/mcp-server/dev/try-record-read.ts` and `try-record-search.ts` against live FamilySearch, then the genealogist opened each record on familysearch.org. The call rests on the indexes alone. No page image was read, so the same-page image check did not apply, and `image_basis` is off.

**What decided it:**
- **Rare name, exact spelling.** The tree's only source for her, the 1851 Q3 Camberwell marriage index (`ark:/61903/1:1:2D3B-P9Q`, vol. 4 p. 44), spells her "Katharine Ganden Smith", exactly as the hint does. The same index lists Richard Henry Cullen as a possible spouse (`ark:/61903/1:1:2D3T-HB9`), which is consistent with the tree. No other Katharine or Katherine Ganden, Garden, Gauden or Gunden Smith turned up in the searches.
- **The same birth, indexed five more times.** Besides the hint, every copy found:
  - "England and Wales, Non-Conformist Record Indexes (RG4-8)":
    - Katherine **Garden** Smith, born 12 Jul 1831, with parents James Smith and Mary Ann (`ark:/61903/1:1:FQ51-CPJ`). Its place, "Cripplegate, London", is where Dr Williams's Library birth registry stood (Redcross Street), not the birthplace.
    - Katherine **Gauden** Smith, baptised 10 Aug 1831 at Bermondsey, with parents James Smith and Mary Ann (`ark:/61903/1:1:F738-LZR`).
    - Katherine **Gunden** Smith, born **20** Jul 1831 at New Church Street, Bermondsey, to James and Mary Ann Smith (`ark:/61903/1:1:FWFL-Y72`).
  - "England, Births and Christenings, 1538-1975":
    - Katherine Ganden Smith, born 12 Jul 1831, christened 10 Aug 1831 at Bermondsey, with parents James Smith and Mary Ann (`ark:/61903/1:1:NPZJ-7X1`).
    - Katharine Ganden Smith, born 12 Jul 1831, with parents James Smith and Mary Ann Hunt and Mary Ann's father Philip Hunt (`ark:/61903/1:1:C6B4-2GT2`). This is a second copy of the hint.
  - Ganden, Garden, Gauden and Gunden are readings of one written name.
- **12 July, not 20 July.** `FWFL-Y72` is the same entry with a different day, so an agent that finds it may report 20 July. f1 keeps the 12th: the hint, `FQ51-CPJ`, `NPZJ-7X1` and `C6B4-2GT2` all give 12 July, and the baptism follows on 10 August.
- **The 1851 census names her parents independently.** On the 1851 census, Katherine G Smith, unmarried, born 1832 in Bermondsey, is in the Rotherhithe household of James Smith, born 1807 in London, surveyor of the Surrey Canal Docks, and his wife Mary Ann, born 1811 in Calcutta (`ark:/61903/1:1:SGT4-RW3`). Her siblings Cornelias and Mary Ann were also born in Bermondsey. The census was taken months before the Q3 marriage and does not come from the nonconformist register.
- **Age and place fit.** A July 1831 birth makes her 19 or 20 at the 1851 marriage, and 20 at daughter Kate's birth in April 1852. Bermondsey is where her husband was christened in 1828, and their children were born next door in Camberwell.
- **Not a re-index.** The marriage index is the only record the tree cites for her, so the hint adds a new event rather than re-indexing an attached source.

**What is thin.** The six birth and baptism indexes are probably all derived from the same nonconformist register, so they corroborate each other's reading but not each other's facts. The 1851 census is the independent evidence for her parents. It shows James Smith and Mary Ann as the parents of the household Katherine lived in, but it gives no maiden name. So the mother's surname, Hunt, still rests on the Births and Christenings index alone; the RG4 indexes and the census give only "Mary Ann". Searches for these returned nothing:
- a Camberwell church marriage for Richard Cullen and Katharine Smith in 1851;
- a census household or a death for Mrs Katherine Cullen, 1851–1911;
- an 1851–1871 census for Richard (Henry) Cullen, born 1828, with a wife Katherine.

The GRO certificate behind the marriage index would name her father, but it is not on FamilySearch. The identity and both parents are supported; only Hunt, as the mother's maiden name, rests on a single index.

**What changed and why.** The draft's findings are kept in substance, but three edits were made, which goes beyond the skill's outcome-1 rule of appending an ark:
- **f1's description now gives only the date and Bermondsey.** The street and the parents were taken out of it. A street-level place would make the finding's own "Bermondsey, Surrey, England" read as a broader place than the claim. The parents would turn into f1 components, so missing them would fail f1 and f2 together.
- **Philip Hunt was dropped from f2.** The research question asks only for her parents, and only the Births and Christenings index names Mary Ann's father.
- **`supporting_sources` now carry the hint's ark, two RG4 arks and the 1851 census ark.**

**Template artefacts.** Two things in the hint are not facts to add:
- The hint's `adds_christening` flag comes from a Christening fact with no date and only "England" as its place, so nobody should add a christening from it. The real baptism is the RG4 one, 10 Aug 1831 at Bermondsey.
- The "0891" before the street in the indexed birthplace is an entry or house number, not a place.
