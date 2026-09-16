# Marina López — parents Manuel López and Carmen Nelia Casado (1927 marriage)

**Source PID:** `P874-7BV`
**Marina López is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of San José de Ocoa, Dominican Republic.

## Research question

> Who were the parents of Marina López, wife of Juan de Dios Pichardo Chalas of San José de Ocoa, and when was she born and married?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `P874-7BV` with relatives). Nothing was
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

**Resolved 2026-09-15 — outcome 2 (the hint's relationships are right, its
dates are wrong).** This fixture came from a hint batch
(`filtered-list-samples-2.csv` row 8, `hint-samples.csv` row 283, flag
`adds_father,adds_mother,adds_birth,adds_marriage`, confidence 3) in which
roughly half the hint records are false matches. The draft transcribed the hint
index verbatim. Adjudicated by Emruthwill, who also gave the independent second
opinion on the parents.

**The year is 1937, not 1927, and that is the key to the whole fixture.** The
register page (`ark:/61903/3:1:3Q9M-CS18-834Z-4`) reads *"a los sete dias del
mes de Octúbre del año mil novecientos treintaisiete"* — act n.º 64, San José
de Ocoa. FamilySearch's index read it as 1927 and then **derived both birth
years from that wrong year**: the groom's "b. 1894" is age 33 subtracted from
1927, and the bride's "b. 1903" is age 24 subtracted from 1927. Neither birth
year is stated anywhere in the document; only the two ages are. This is why the
draft's apparent 8-year conflict with the tree's 8 Dec 1902 birth for Juan de
Dios was never real evidence.

**The identification is documentary, not onomastic.** The groom of the marriage
act is recorded as *hijo natural de Fidelina Chalas*, holding *Cédula personal
de Identidad # 159, Serie 13*. The 1978 civil death act for the tree's Juan de
Dios Pichardo Chalas (`ark:/61903/1:1:66H3-5D6G`, register image
`ark:/61903/3:1:9396-YN6L-V`) records the same mother, **Fidelina Chalas**, the
same **cédula 159 serie 13**, a birth year of **1902**, and his spouse as
**Marina López**. The mother's-name match runs from a direct reading of the
marriage register to FamilySearch's own index of the death act, so it does not
depend on any machine transcription. The tree's compound surname corroborates
it independently: a Dominican surname is father's + mother's, so *Pichardo
Chalas* requires a Chalas mother. Born 1902, he is 33–34 across 1935–37, which
fits the act's "treintaitres años"; in 1927 he would have been 24.

**Name-variant caveat, deliberately left in.** The bride's given name on the
register is written ambiguously and reads as *Manna* about as readily as
*Marina*. The identification rests on the groom's cédula and mother, on the
death act naming his spouse as Marina López, and on the tree already recording
Marina as his wife — not on an exact-name match. Documented here as a
name-variant correlation rather than asserted as identity.

**The "is this a re-index?" question is answered.** The tree carries Juan de
Dios's death act **twice**, both entries resolving to image
`ark:/61903/3:1:9396-YN6L-V`: `WWBW-2YJ` (`1:1:66H3-5D6G`, spouse indexed
*Marina Lopez*) and `WWBW-PPB` (`1:1:6TMN-HQ5T`, the same spouse slot garbled to
*"Manuel Lopez"*). The "Manuel Lopez" source that prompted the original
author's question is a duplicate index of the death act with a mangled spouse
name — it was never the hinted father.

**Her birth year is deliberately unanswered.** The `researcher_question` asks
"when was she born and married?"; the marriage clause is answered and the birth
clause is not. She is recorded as 24 at the marriage, which would place her
birth around 1912–13, but no record states it and the draft's `f3` (b. about
1903) was an artifact of the misread year. It was dropped rather than replaced
with a derived figure. Searched and came up empty for her own birth or baptism:
"Dominican Republic, Civil Registration, 1744-2019" and "Dominican Republic,
Catholic Church Records, 1590-2022", 1898–1913, with and without the parents'
names. Every parish hit returned from Santiago, Tamboril or Distrito Nacional
and none from San José de Ocoa or Peravia, so indexed coverage for that
locality in this period looks thin — this is a coverage gap, not a negative
finding, and only index searching was done (no image-level browsing of the
registers).

**Independently corroborated by two sibling records, both found by the agent
during the live debug run rather than by the hand adjudication.** An earlier
draft of these notes said her parents were attested by the marriage act alone;
that was wrong.

- `ark:/61903/1:1:6KHD-YBR7` — **Fernando Andres Lopez**, b. 1919, death
  registered **26 Jan 1965 at San José de Ocoa, Peravia**, naming his parents as
  **Manuel Lopez** and **Carmen Nelia Casado**. Same distinctive maternal name,
  verbatim, in the same locality, on a record created 28 years after the
  marriage act and about a different person. This is the load-bearing
  corroboration.
- `ark:/61903/1:1:6R2N-51H4` — **Manuel Antonio López Casado**, b. 1925,
  married 9 Mar 1976, recorded as the child of *Manolo López* (a standard
  diminutive of Manuel) and *Carmen Nelia Casado*. Weaker: the record sits in
  the Distrito Nacional marriage register and carries no birthplace.

Neither is proven to be Marina's sibling — no record ties either man to her
directly — but `6KHD-YBR7` places the identical parent couple in San José de
Ocoa independently of the marriage act, which is what the parentage finding
needed.

A third record names the couple differently and is worth knowing about:
Marina's own civil death registration, Act No. 256, 5 Oct 1984, San José de Ocoa
(`ark:/61903/1:1:6TMN-26CT`, image `ark:/61903/3:1:9396-YN33-1`), gives her
parents as *"Manolo Lopez"* and *"Carmen Nida Lopez"* — the mother under a
married-name form rather than her birth surname, and the informant was the
attending physician, so the parentage there is secondary information.

**The live tree was not modified.** The hint was not accepted, no source was
attached, no parents were added. `snapshot --check` on 2026-09-15 reported four
DRIFT lines, all of them a name `type` changing from `""` to `"BirthName"` — no
source drift, no relationship drift.
