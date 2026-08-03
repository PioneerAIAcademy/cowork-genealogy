# Gertrudis Hoffmans — additional daughter Elisabeth (b. 1713)

**Source PID:** `KN19-Q19`
**Gertrudis Hoffmans is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
about 1677, Wanrooij, Noord-Brabant, Netherlands; died not recorded in the tree.

## Research question

> Did Gertrudis Hoffmans and her husband Petrus Jansen of Wanroij, North Brabant, Netherlands have a daughter named Elisabeth, baptized 1713, in addition to their three known sons (christened 1709-1717)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `KN19-Q19` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — a confirmed true match; see "Notes for reviewers" below for the
corroboration that decided it.

## Notes for reviewers

**Resolved (issue #874): TRUE MATCH.** The hint — Netherlands, Archival Indexes, Vital Records, 1600-2000: baptism, 30 March 1713, Wanroij, of Elisabeth, daughter of Petrus Jansen and Geertrudis Gerits — establishes Elisabeth Jansen as a **previously unrecorded daughter** of the tree couple Gertrudis Hoffmans (`KN19-Q19`) and Petrus Jansen (`KN19-QB1`), between their sons Gerardus (chr. 1711) and Joannes (chr. 1717).

What confirmed it:
- **The record names this couple.** The 1713 baptism names Elisabeth as daughter of Petrus Jansen and Gertrudis Geerts/Gerits — matching through the father's name, the mother's patronymic, the parish (Wanroij), and the timeframe.
- **An original + a duplicate register.** The original register is partially obscured in one filming, but a contemporary **duplicate register preserves the full entry** and confirms the same parents.
- **The mother's patronymic is her documented naming, not a mismatch.** "Gerits" ("daughter of Gerit") is how this exact woman already appears in her own attached 1709 marriage record ("Geertrudis **Gerits** Hoffmans"); her father is Gerrit Gerrits Hoffmans. The **Geerts godparent** on the baptism is likewise consistent with her paternal family.
- **No competing candidate.** No second Petrus Jansen–Gertrudis couple was found baptizing in the Wanroij parish in this period, so the record cannot belong to a same-named different family.
- **A genuinely new record.** The hint (`QL69-3BLT`) is not among the four sources already attached to the tree person — it is not a re-index of an existing source, and the 1713 baptism fills a previously empty slot between the 1711 and 1717 sons.

Together — the original register, the duplicate register, the naming/patronymic and godparent consistency, and the absence of a competing same-named couple — support identifying Elisabeth as a daughter of this family. `expected-findings.json` keeps its original finding.
