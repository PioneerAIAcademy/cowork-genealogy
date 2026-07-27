# Pierre Albert Tullier — additional son Pierre Jacques Dominique (b. 1796)

**Source PID:** `GPX7-28P`
**Pierre Albert Tullier is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
4 March 1777, Stavele, Alveringem, West Flanders, Belgium; died 11 March 1846, Bambecque, Nord, France.

## Research question

> Did Pierre Albert Tullier and his wife Constance Dorothé Leys have a son, Pierre Jacques Dominique, born 1796, in addition to their five children recorded from 1805 onward?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GPX7-28P` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — a false-match adjudication (the answer is that the hint is wrong);
see "Notes for reviewers" below for the evidence that decided it.

## Notes for reviewers

**Resolved (issue #856): FALSE MATCH.** The hint — France, Nord, Parish and Civil Registration, 1524-1893: marriage entry, 21 June 1825, Bambecque, for Pierre Jacques Dominique Tuilier (b. 1796; parents named as "Pierre Tuilier" and "Constance Ley") and Constance Victoire Depuydt — does **not** establish a son of Pierre Albert Tullier and Constance Dorothé Leys. The 1796 groom is most consistent with a *different* Pierre-Tuilier/Constance-Ley couple in the same parish.

What decided it:
- **Timing conflict.** Pierre Albert Tullier married Constance Dorothé Leys on 24 September 1800; a son born 1796 predates that marriage by four years. Their own documented childbearing in Bambecque runs 1801–1816.
- **The couple's own children name the parents in full.** Their birth registrations (same France, Nord collection) record the parents as "Pierre Albert Tuilier" and "Constance Dorothé Ley" — e.g. François Cornil Albert (b. 16 Nov 1801, not yet in the tree), Barbe Henriete Constance (1805), Reine Sophie (1808), Pierre Jacques Louis (1816). The 1825 marriage names the groom's parents only as bare "Pierre"/"Constance" — no "Albert," no "Dorothé."
- **Demographics.** A groom born 1796 implies parents married in the early 1790s; Pierre Albert (b. 1777) was 19 and unmarried in 1796.
- **Common names.** "Pierre"/"Constance" and the Tuilier/Tullier + Ley/Leys spelling variants are common in Bambecque, so a same-named different couple is the parsimonious reading.

What was searched and came up empty: no birth/baptism record ties a 1796 Pierre Jacques Dominique specifically to Pierre Albert Tuilier + Constance Dorothé Ley, and the tree person carries no attached sources corroborating the hint. Accordingly `expected-findings.json` is a `polarity: "avoid"` guard (the agent must not attach the 1796 son to this couple) paired with a `required` documented-negative-conclusion finding.
