# renhard-marriage-england

Charles Renhard (b. about 1866, Germany), living in Liverpool by 1901. Shaped on alpha
feedback #4743 (issue #4777): every FamilySearch marriage search under the tree's
spelling "Renhard", and the given-name variant "Charls", returns a pool of other men
(Runyard, Render). FamilySearch's fuzzy match on Renhard does not reach the spelling
the index holds, "Rheinhardt"; a written-out surname variant (Reinhard, Rheinhardt)
reaches the marriage.

- **Objective:** find whom Charles Renhard married, and when.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`), one `planned` item: pli_001, England marriages,
  1895–1897, FamilySearch. Its rationale names no other spelling of the surname.
- **Log:** 0 entries.
- **GedcomX persons:** I1 (Charles Renhard, b. about 1866, Germany; 1901 residence
  Liverpool).

## What the skill must do

Search FamilySearch marriages under Renhard (a pool without him), then, before calling
FamilySearch exhausted, under at least one written-out spelling of the surname. Under
Reinhard or Rheinhardt the search returns Charles Rheinhardt, married 22 June 1896,
Lancashire (England Marriages, 1538–1973), a candidate for the subject.

The record_search fixtures are live FamilySearch responses captured 2026-11-25; the tree
and project are hand-authored.
