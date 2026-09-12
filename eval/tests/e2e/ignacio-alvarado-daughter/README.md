# Ignacio Alvarado — infant daughter Angela, buried 1880 at El Carmen, San José

**Source PID:** `K21K-P1C`
**Ignacio Alvarado is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of San José, Costa Rica.

## Research question

> Did Ignacio Alvarado and Teodosia Durán of San José, Costa Rica have an infant daughter, Angela, who died and was buried in June 1880?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K21K-P1C` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: the hint is a true match on the relationship, with a corrected
birth year.** The burial record is the couple's daughter, but she was born in
spring 1879, not 1880, and her surname is Alvarado — not the "Charado" the
index gives.

**What the register actually says.** The burial image behind the hint
(`ark:/61903/3:1:S3HT-63K2-3Z`, San José city burials, p. 297) carries entry
no. 814: *"En la Ciudad de San José, á veinte de Junio de mil ochocientos
ochenta, se dió sepultura Ecca. á Angela Alvarado, hija legitima de Ygnacio
Alvarado y Teodosia Duran, de año y dos meses, murió de Alfericia."* Three
things follow. The parentage is stated outright, so it is not an index
inference. *Hija legitima* means the parents were married. And *de año y dos
meses* — an age in completed years and months, so at least one year two
months and not yet one year three — places her birth between 21 March and
20 April 1879. The "1880" in the hint index
(`ark:/61903/1:1:NQ5N-RXJ`) is the indexer's, not the register's; a second
indexing of the same image (`ark:/61903/1:1:6JPG-ZB6D`) reads the year as 1879
and the surname as "Alvarado Duran". The age phrase was read off the image
rather than taken from the index, and the page supplies its own control: the
same scribe, in the same hand within a few entries, writes *"de año y seis
meses"* at no. 813 (the identical *año y … meses* construction) and *"de dos
años, seis meses"* at no. 810 and *"de dos años"* at no. 817. The two readings
that would overturn the correction are therefore both present on the page for
comparison, and neither resembles no. 814.

**The independent corroboration** is her own baptism:
`ark:/61903/1:1:NQ24-QZQ`, Angela Procesa Maria de las Piedades Alvarado Duran,
27 Mar 1879 at San Vicente Ferrer, daughter of Ygnacio Alvarado and Teodosia
Duran — a different event on a different image
(`ark:/61903/3:1:S3HY-DYZS-JNJ`). That baptism falls inside the window the
burial age defines, so the two records do not merely agree to within a month —
they agree exactly, and together they fix her birth in the week of 21–27 March
1879. She is the only Angela among the couple's children.

**The two Duráns are one woman.** The starting tree's `K4JL-NPF` (Teodosia
Duran, b. 1876) and `K21K-P18` (Teodora Durán, no dates) are a duplicate, and
the proof is inside the tree's own data: `K21K-P1H`'s christening of 5 Jun 1889
is indexed twice off one image (`ark:/61903/3:1:S3HT-69BQ-SRL`) —
`ark:/61903/1:1:NQV5-DPB` names the mother Teodora Durán,
`ark:/61903/1:1:6ZPT-KTZR` names her Teodosia Durán. Across this couple's
38 record personas in the collection she is also indexed Teodocia, Teodossia,
Teodoria, Todocia, Eudocia, Eudosia, Cerdocia and Tesdosia; the spelling is
indexer variance, not two people. **The duplicate was deliberately not merged
on familysearch.org** — merging would redirect one PID and invalidate the
snapshot that `snapshot --check` audits, and the ambiguity is part of what the
fixture measures.

**The father-identity question, and why it does not weaken the match.** The
hint's father persona (`ark:/61903/1:1:NQ5N-RXV`) matches four tree persons,
and `K21K-P1C` is not the top one: FamilySearch ranks `K2BX-QFF` at confidence
5 / 0.996 and `K21K-P1C` at confidence 3 / 0.745 — which is the "confidence 3"
the sampling CSV recorded. That ranking is an artifact of a bare persona. The
burial entry gives the father a name and nothing else — no dates, no places —
so the matcher has almost nothing to score. All four candidates are duplicate
records of one man, each created from a different indexed entry and carrying
that entry's spelling: `K21K-P1C` (Ignacio Alvarado, holding María Rosa,
chr. 5 Jun 1889), `K2BX-QFF` (Ygnacio Alvarado, Maclovia, chr. 10 Mar 1891),
`K2B4-P75` (Ygnacio Albarado, Oliba Monica, chr. 5 May 1885) and `GPH8-7RX`
(Ignacio Alvarado). `GPH8-7RX` settles it: it is a Couple with **`K4JL-NPF`**,
the identical wife PID `K21K-P1C` is married to — two father records on one
wife record. Alvarado/Albarado and Ignacio/Ygnacio vary with the record exactly
as Teodosia/Teodora/Teodocia/Todocia do; the same burial image yields "Ygnacio"
in one indexing (`NQ5N-RXV`) and "Ignacio" in the other (`6JPG-ZB66`). The link
that actually carries weight runs through the tree's own child rather than the
empty father persona: `NQV5-DP1`, the father on María Rosa's 5 Jun 1889 entry,
matches `K21K-P1C` at 0.9999994, and María Rosa is `K21K-P1H`. None of these
duplicates were merged, for the same snapshot reason as the Durán pair.

**The tree's 1876 birth year for her is impossible** and does not need the
duplicate to fall. The disproof is the record this finding rests on: a woman
born in 1876 is no more than three when she bears Angela, baptized 27 Mar 1879.
That instance is not a probable identification — it is the finding's own
record. Beyond it, this couple baptizes children at El Carmen in 1881, 1885,
1886, 1889, 1891, 1893 and 1895 and buries infants there in 1880 and 1884; a
woman born in 1876 is four at the first of those burials. An earlier run of
baptisms at San Vicente Ferrer, 1870–1879, is very probably the same couple —
same distinctive "de las Piedades" naming, and the parishes do not overlap in
time — but the refutation holds on the El Carmen records alone. Every date in
the starting tree is unsourced: `sources: []` at the top level and zero
attached sources on all five persons, re-confirmed against the live tree at
adjudication time.

**Review.** Adjudicated and signed off by Emruthwill (genealogist), 2026-09-10,
against the register images rather than the index: the burial page
(`ark:/61903/3:1:S3HT-63K2-3Z`, entry 814) for the age phrase and the stated
parentage, the baptism page (`ark:/61903/3:1:S3HY-DYZS-JNJ`) for the 27 Mar 1879
entry, and the christening page (`ark:/61903/3:1:S3HT-69BQ-SRL`) for the single
entry behind both `NQV5-DPB` and `6ZPT-KTZR`. The father-identity question was
raised in review rather than found in drafting, and is answered in the paragraph
above.

**Searched and empty.** No marriage record for the couple surfaced in "Costa
Rica, registros parroquiales y diocesanos, 1595-2022" (collection `1460016`)
across 1860–1875; the *hija legitima* wording is what establishes the marriage.
No second Angela, and no record placing any other Ignacio Alvarado × Durán
couple in these two parishes in this period.

**Why `f1` changed rather than being kept as drafted.** The draft asserted
"born and buried in 1880" as one claim. The relationship and the 20 June 1880
burial are confirmed; the 1880 birth is not, so the finding states an April
1879 birth with the age-at-death and baptism as its warrant. Under
§3.4.2 only `link` components score, so the corrected year sits in `details` as
an identifying detail. The `researcher_question` is unchanged — it is the hint
record's own spelling of the mother's name and stays answerable.
