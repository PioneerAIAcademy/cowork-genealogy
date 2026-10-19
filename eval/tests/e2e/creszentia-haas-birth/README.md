# Creszentia Haas — birth and christening (May 1830, Durbach, Baden)

**Source PID:** `9DZX-B29`
**Creszentia Haas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; known only as the mother of Genofeva Haas, christened 7 January 1855 at Durbach, Amt Offenburg, Baden.

## Research question

> When and where was Creszentia Haas — mother of Genofeva Haas (chr. 1855, Durbach, Baden) — born and christened?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `9DZX-B29` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — the hint record is a plausible false match that has to be
displaced by an independently-found record, not merely doubted.

## Notes for reviewers

**Resolved 2026-09-10: the hint is a false match, and the real answer was
found.** Creszentia Haas was born **28 May 1830** and christened **29 May
1830** at **Durbach, Amt Offenburg, Baden** — the same parish as her
daughter Genofeva's 1855 christening — as the daughter of Mathias Haas and
Maria Anna Schmieder. The hinted record (`ark:/61903/1:1:NJB1-3BM`,
25/26 May 1835 at Lichtental, Amt Baden, parents Mathias Haas and M. Anna
Steinel) belongs to a different family and is carried as a
`"polarity": "avoid"` finding.

**What decided it.** The tree's only source is the daughter Genofeva's 1855
Durbach entry, and that entry itself names the mother's parents — it carries
four personas, with Matthias Haas and Maria Anna Schmieder as a couple who
are Creszentia's parents (`ark:/61903/1:1:C4GD-34N2`; the same tree source's
other ark, `ark:/61903/1:1:N27V-K25`, resolves to the same entry, the
citations differing only by the word "database"). Genofeva was illegitimate
— she carries her mother's surname with no father recorded — which is why
the Baden register names the mother's parents. So the tree's grandparent
names come from a Durbach register, not from a guess.

Searching that couple's children then produces the answer directly. Mathias
Haas and Maria Anna Schmieder are a documented Durbach family:

| Child | Event | Arks |
|---|---|---|
| Mathias | chr. 10 Feb 1829, d. 1829 (bur. 18 May 1829) | `1:1:C4GH-B5T2`, `1:1:7MVL-LJT2` |
| **Crescentia** | **b. 28 May 1830, chr. 29 May 1830** | **`1:1:QP3D-5ZR5`, `1:1:C4GZ-FYZM`** |
| Francisca | chr. 26 Mar 1832, d. 1833 (bur. 6 Mar 1833) | `1:1:C4G8-Z72M`, `1:1:7MVP-W1MM` |
| Barbara | chr. 16 Aug 1833, d. 1834 (bur. 23 Mar 1834) | `1:1:C4GZ-FT2M`, `1:1:7MVG-SHN2` |

Crescentia's birth and christening are attested in **two independent
collections** — "Germany, Births and Baptisms, 1558-1898" (extraction batch
`C39733-1`) and "Germany, Baden, Archdiocese of Freiburg im Breisgau,
Catholic Church Records, 1463-1931" — so neither finding rests on the
collection the hint came from alone. She also survived to marry: Franz
Klausmann and Kreszentia Haas, daughter of Matthias Haas and Maria Anna
Schmieder, married **12 Dec 1859 at Durbach** (`ark:/61903/1:1:WXK5-XQ6Z`),
four years after Genofeva's birth and death. Born May 1830, she was 24 at
Genofeva's January 1855 birth and 29 at her own marriage.

**Why the hint was plausible, and why it fails.** Both girls are a Creszentia
Haas, each the daughter of a Mathias Haas, each born in late May — 25 May 1835
at Lichtental against 28 May 1830 at Durbach. What separates them is the
mother and the parish: Steinel at Lichtental in Amt Baden, Schmieder at
Durbach in Amt Offenburg, roughly 45 km apart. The Lichtental family is real
and independently attested (`ark:/61903/1:1:7MF8-6C3Z`, a second entry for
Mathias Haas and M Anna Steinel at neighbouring Oberbeuern), so this is two
distinct families rather than one bad index entry — which is what makes it a
good trap. The earlier draft's reading, that the tree might be the weaker
document, does not survive: the tree's grandparent names are corroborated by
seven Durbach register entries across two collections, and the mother-surname
conflict resolves in the tree's favour.

**What was searched.** "Germany, Births and Baptisms, 1558-1898" and the
Freiburg Archdiocese Catholic Church Records, Baden, for Haas children of
Matthias Haas and Maria Anna Schmieder (11 hits, all Durbach); and Creszentia
Haas born 1826–1842 in Germany (3,965 fuzzy hits, top 50 read — "Schmieder"
appears in exactly one, the tree's own source). No competing Creszentia Haas
of this couple exists.

**Limits of this adjudication.** It is index-level. Both Freiburg register
images (`ark:/61903/3:1:3Q9M-CSJL-CSQJ-M` for the 1830 baptism,
`ark:/61903/3:1:3Q9M-CSLY-6Q53-J` for the 1859 marriage) return HTTP 403 and
could not be read, so no original register page was examined. The two
independent collections and the 1859 marriage carry the call instead. The
birth date has one index variant: the marriage entry gives 8 May 1830 against
the internally consistent 28 May birth / 29 May christening pair, which is
why `f1` uses 28 May.

**Why `f3` is not `required: true`.** `f3` is the `polarity: "avoid"` guard
against the 1835 Lichtental hint. Its avoided claim is a Birth fact on the
*subject herself*, not a wrongly-attached different person, and
`apply_avoid_guard` exempts the fixture's own subject from its matcher
(`eval/harness/e2e/judge.py`, `subject_person_ids`) — so the deterministic
backstop described in spec §3.4.1 cannot fire here, and `f3` is graded by the
judge alone. The verdict gate therefore rests on `f1`, which a do-nothing run
cannot pass; `f3` records restraint without gating the fixture on an
unbackstopped subjective call. Do not promote it to `required` without first
giving the guard a way to distinguish the 1835 fact from the 1830 one.

Second opinion: Edmund Oware, 2026-09-11, concurs with outcome 2.

Age does not separate the two candidates and the adjudication is right not
to lean on it: born 1830 she is 24 at Genofeva's 1855 birth and 29 at her
own marriage, born 1835 she would be 19 and 24, and both are ordinary. What
carries the call is that Genofeva was illegitimate, so the 1855 Durbach
entry names her mother's parents rather than her father, and the couple
those names identify has four Durbach children of whom three carry burials
in 1829, 1833 and 1834. Crescentia is the only one of the four without one,
and she is the one who marries at Durbach in 1859 as that couple's daughter.
The Lichtental family is independently attested at Oberbeuern, so the two
are distinct families rather than one mis-indexed entry.

Two qualifications are carried rather than resolved. The 1859 marriage entry
gives a birth of 8 May 1830 against the internally consistent 28 May birth
and 29 May christening pair; f1 asserts 28 May, which is the right reading,
and the variant is better explained as a dropped digit than as a second
candidate. And the adjudication is index level throughout, since both
Freiburg register images return HTTP 403 and no original page was read. This
second opinion inherits that limit and does not rest on an original page
either.
