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

**Recoverability caveat (read before grading a failed run):** the tax lists and
catechism records that carry this proof are browse-only and largely on
SVAR/ArkivDigital, not name-indexed on FamilySearch. A benchmark agent restricted
to FamilySearch record/full-text search may be unable to reach f1–f3 and f5 at
all; the 1712 marriage (f4) and the pre-1745 parish registers are the most likely
to be reachable. A low score here is an expected signal about tool reach, not
necessarily an agent failure — weigh it against what the FamilySearch tools can
actually surface.

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
Recoverability caveat above is half wrong: the Mantalslängder *are* on FamilySearch
(Harjager 1681/1700/1702/1705/1708, browse-only), and probate 1688–1816 and häradsrätt
1697–1714 are unexamined routes.** Read #1596 before grading a future run against that
caveat.
