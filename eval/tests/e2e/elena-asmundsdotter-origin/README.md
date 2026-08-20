# Elena Asmundsdotter — birthplace and parents (Sweden, born c. 1681)

**Source PID:** `PID-TODO`

Elena Asmundsdotter is deceased (died 23 April 1745, Barsebäck parish).

> Where was Elena Asmundsdotter — the mother of Asmund Jönsson (born 11 September
> 1718 in Barsebäck parish, Malmöhus, Sweden) — born, and who were her parents?

## What was removed from the starting tree

- Elena Asmundsdotter's origin: born c. 1681 at Henckelstorp, Västra Karaby parish
- Elena's parents: Asmund Torsson and Pernilla Jönsdotter
- The marriage of Jöns Jönsson and Elena Asmundsdotter (29 December 1712, Västra Karaby)
- Elena's paternal grandfather Tor Andersson (a deep, bonus finding)

## What the starting tree contains

- Elena Asmundsdotter herself (subject), with no origin, no parents, no vital dates
- Her husband Jöns Jönsson (bare — his own death is part of the research trail)
- Their son Asmund Jönsson (christened 11 September 1718, died 4 February 1768,
  Barsebäck) — the direct ancestor the case study anchors on

## Expected difficulty

Hard — and deliberately so. This is an indirect-evidence proof. Västra Karaby
parish registers do not begin until 1688, while Elena was born c. 1681, so her
birthplace and parentage cannot be read from a birth record. They are established
by correlating Swedish tax lists (Mantalslängder, extant from 1658) and catechism
records (Katekismilängder) across five decades to fix Asmund Torsson's household
at Henckelstorp, plus the 1712 christening of Elena's illegitimate daughter (which
first names her father) and the parents' 1712 marriage in Elena's home parish.

## Notes for reviewers

Documented conclusion from the "Beyond Parish Registers: A Case Study" FamilySearch
Wiki article (Sweden):

- Elena's death (Barsebäck, 23 April 1745, age ~64) states "barnfödd i Henckelstorp";
  the gazetteer places Henckelstorp in Västra Karaby parish → born c. 1681 there.
- Father Asmund Torsson: first named in the 11 June 1712 christening of Elena's
  illegitimate daughter Boel; his residence at Henckelstorp is proven across the
  1680–1709 tax lists and the 1696/1699/1701 catechism lists. Buried 11 January
  1711, age 67 (born c. 1643).
- Mother Pernilla Jönsdotter: named in the 1696 catechism list and 1700 tax list;
  died 18 April 1719, age 68 (born c. 1651).
- Jöns Jönsson & Elena married 29 December 1712 in Västra Karaby.
- Great-grandfather Tor Andersson appears with sons Jöns and Asmund Torsson in the
  1658–1663 Henckelstorp tax lists.

**Recoverability caveat (read before grading a failed run).** Two separate
questions with different answers: whether a record is *on* FamilySearch, and
whether an agent restricted to name and full-text search can *reach* it.

*On FamilySearch, browse-only.* The Mantalslängder for Harjager härad are here as
image volumes — groups `008978368`, `008978369`, `008978374`, `008978375` —
covering 1670–1681 and 1700–1714, which includes 1680, 1681, 1700, 1702, 1705 and
1708 inside this fixture's research window. Probate `007118856` (1688–1816) and
the häradsrätt series `008355604`–`008355613` (1691–1713) are here too and
unexamined; see the routes note below. Measured 2026-08-19, and only visible on a
post-#1598 `volume_search` — before that fix it discarded every record type and
surfaced none of this, so anyone re-checking on an older tree will see nothing.

*Not on FamilySearch.* The catechism lists of 1696, 1699 and 1701 that carry f3
and half of f2 are absent at every level checked — härad, parish and county. A
full county sweep (1,525 volumes) returned only husförhörslängder for Helsingborg
1875–1890 and one Communion Records for Tullstorp 1718–1744. The 1658–1663 tax
lists behind f5 are absent as well; the earliest Harjager list is 1670.

*Reachable by the agent: per finding, not all-or-nothing.* Every volume above
reports `recordSearchablePercent: 0` and `fulltextSearchable: false`, so nothing in
the tax lists or the catechism lists is name-indexed. But most findings also rest on
a **parish register**, and those are a different matter — grade them separately:

- **f1 — reachable.** Elena's own 1745 Barsebäck death entry, recorded *"barnfödd i
  Henckelstorp"*, plus the gazetteer placing Henckelstorp in Västra Karaby.
- **f2 — the father's identity is reachable.** The 11 June 1712 Västra Karaby
  christening of Boel names *"Asmun Tors(son's) dotter Elena from Henckelstorp"*.
  Only the household *placement* across 1680–1709 depends on the browse-only tax and
  catechism lists.
- **f3 — partly reachable, and the split matters.** Pernilla's 1719 death entry
  ("widow of Asmun Torson") reaches her as Asmund's wife. But the 1696 catechism list
  is, in this fixture's own words, the *only record listing her maiden name* — so
  **Jönsdotter**, which is what f3 actually asserts, is not reachable. A run that
  recovers "Pernilla, wife of Asmund" has got as far as the tools allow.
- **f4 — reachable.** The 29 December 1712 Västra Karaby marriage entry.
- **f5 — not reachable.** Its only source is the 1658–1663 tax lists, and the
  earliest Harjager list on FamilySearch is 1670.

So treat f1, f4, and f2's father-identity as reachable; treat the tax/catechism
household placement, f3's maiden surname, and f5 as beyond the agent's tool reach. A
low score is still an expected signal about tool reach rather than agent failure —
but grade it per finding, against what is *searchable*, not what is merely *held*.

**Unexamined routes (2026-08-19).** Neither has been opened, so neither appears in
`expected-findings.json`. Probate `007118856` (1688–1816, 439 + 113 images) covers
Asmund Torsson's death in January 1711, and a Swedish *bouppteckning* enumerating
heirs would be direct evidence for f2 against this fixture's indirect-evidence
premise. Häradsrätt `008355612` (1710–1712) covers both that death and Elena's
December 1712 marriage. Anyone who reads either volume should update f2's
supporting sources and revisit the difficulty rating.

**Register start date — noted, not investigated (2026-08-19).** Parish group
`004523021` reports "Church records | 1662-1850 | Vestra Karaby", while this
fixture's premise is that the registers begin in 1688 and Elena (b. c. 1681)
predates them. Deliberately out of scope for #1596, which concerns the
availability and discoverability of the tax and catechism records.

**Read this before acting on it: almost certainly a catalogue-level span, not a
register.** `004523021` is returned four times, with different image counts (221,
143, 198, 25) and the *identical* three coverages each time — coverage repeated
verbatim across separate film items is description attached at the catalogue/DGS
level, not per volume, and 188 years is the span of a holding rather than of a
register. The same group's `1687-1729` coverage is far more likely to be the real
early register, and it agrees with the documented 1688 start to within a year.
The case study this fixture was built from is itself titled "Beyond Parish
Registers", which is only a case study worth writing if the registers genuinely
do not reach 1681.

**But if it is ever shown to be real, the consequence is larger than this
caveat.** Elena was born about 1681, so a register actually running from 1662
would likely contain *her own baptism* — direct evidence for f1, and for f2 and
f3 if the entry names her parents. That would move this fixture out of the
indirect-evidence genre altogether and require rewriting its premise, its
difficulty rating and its findings, not just correcting a note.

Cheapest order to settle it, if someone takes it on: read what the case study says
about the register start date and where it got it; then check SVAR/ArkivDigital's
per-series holdings list for Västra Karaby, which publishes start dates. Open
images only after both. Note also that *adding* a finding would leave the
committed `run-2026-08-13_01-40-40` annotation without a label for it — amending
the existing f1–f6 is safe, adding an f7 is not.

**Authoring note (PID-less / Path 3):** Built from the wiki case study as ground
truth, with no FamilySearch access — the starting tree was *constructed* from the
document, not captured from a live `person_read` snapshot, so sanity-check its
fidelity. `source_pid` is an unused placeholder (`PID-TODO`); §6.1 blocks every
person-keyed tool, so neither the run nor the judge reads it. The §14
fixture-validity run is still owed; it is not CI-gated, so this PID-less draft
may land with the validity run outstanding.

**2026-08-13 — first run, `fail` (0 of 6 findings).** The agent never reached Västra
Karaby: `Karaby`, `Henckelstorp` and `Torsson` all appear 0 times in its trace. It
browsed Barsebäck and Hofterup, then an indexed hit sent it to Fulltofta (Frosta
härad), where it concluded a contradicting father — Asmund Nilsson — at `probable`,
tiered the conclusion `possible`, and wrote nothing to the tree. Stopped on the 3600 s
wall-clock cap at 197 of 200 tool calls. Four gaps found alongside it: #1593
(`image_read` refuses >700 KB), #1594 (`image_transcribe` fabricates/corrupts on early
-modern Nordic hands), #1595 (26% OpenRouter failure rate), and **#1596 — the
Recoverability caveat was half wrong: the Mantalslängder *are* on FamilySearch
(Harjager 1670–1681 and 1700–1714, browse-only), and probate 1688–1816 and
häradsrätt 1691–1713 are unexamined routes.** That caveat has since been corrected
(#1596): the tax lists are on FamilySearch browse-only, the catechism records are
not, and both unexamined routes are recorded there.
