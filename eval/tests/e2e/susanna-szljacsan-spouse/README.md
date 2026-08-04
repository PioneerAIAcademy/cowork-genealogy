# Susanna Szljacsan — husband Joannes Janeczky and daughter Susanna

**Source PID:** `LDK6-6SH`
**Susanna Szljacsan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
5 March 1850, Lisková, Ružomberok, Slovakia; died not recorded in the tree.

## Research question

> Who did Susanna Szljacsan of Lisková, Ružomberok, Slovakia marry, and did she have a daughter named Susanna, baptized about 1884?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LDK6-6SH` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**RESOLVED 2026-08-04 — true match.** This fixture came from a hint batch
(`filtered-list-samples.csv` row 29, flags `adds_spouse`/`adds_daughter`,
confidence 3) in which roughly half the hint records are false matches. This one
is true, so the findings are kept as originally transcribed: `f1` (husband
Joannes Janeczky) and `f2` (daughter Susanna Janeczky, baptized about 1884 at
Lisková). Nothing was added or edited.

**Where this evidence came from — read this before comparing against the run
log.** The case below is *hand research by the genealogist*, not a summary of
any scored run. That is the intended workflow for this genre (`/resolve-record-hint`
sends the genealogist to familysearch.org to work the question independently),
but the two are easy to conflate, so: the committed run
`run-2026-08-03_22-34-20` found the hint record and its register image and
nothing else on this list. Its `research.json` never mentions Ludovica or any of
the four corroborating baptism arks, it sat at tier *probable* by way of the
Karlik marriage, it left `c_001` unresolved, and it says in its own words
"Research is not declared exhaustive." A reviewer diffing the README against
that run **should** find the gap — it is the difference between the answer and
one agent's attempt at it, not an inconsistency.

**The evidence that decided it.** The hint record (`1:1:KHQN-MSB`, mother's
persona `1:1:KHQN-MSY`) is genuine and accurately transcribed. Four further
indexed baptisms in the same parish, independent of the hint, document the same
couple: Joannes 1875 (`1:1:KHQN-VGS`), Maria Janecsky Hrbolec 29 Oct 1882
(`1:1:KHQN-MWR`), Anna 4 Mar 1889 (`1:1:KHQN-RFY`), and Ludovica Janetzky
4 Oct 1891 (`1:1:KHQN-Q3X`). That gives a childbearing span of 1875-1891, which
fits a woman christened in 1850 at ages 25 to 41.

The parish did hold several contemporaneous women named Susanna Szliacsan — the
wife of Andreas Ňemcsek Hluchi (children 1861, 1867), the wife of Josephus
Blaskó (children 1890, 1894, 1895), and Susanna Szliacsan Hlinka (b. 1858,
d. 6 Dec 1892) among them. Applying ages to that pool eliminates it: six of the
eight candidates are chronologically impossible against a 1875-1891 span, and
the seventh would have been bearing a child at 49. Each is also tied to a
different husband. Right name, right parish, right generation, best age fit, no
viable alternative, no contradicting evidence — no record places the subject
elsewhere, married to another man, or dead before 1891.

**What was searched and came up empty.** No entry in the baptismal series
records the mother's age, parentage, or residence, so none of them names her
directly. The couple's marriage *is* indexed — Joannes Janeczky (b. 1853) and
**Maria** Szliancsan (b. 1850), 8 February 1875 at Liszková, image
`3:1:33S7-9RQ4-9HLG`, entry 12 — but note the bride's given name, and note that
a search on `givenName: Susanna` will not return it. That register carries no
parents column at all: its printed headers run *name and religion* | *civil
status, origin and residence* | witnesses | officiant | notes. So the record
class that would ordinarily state the bride's parentage never recorded it for
anyone in this parish, which is why its absence is not treated as a bar to the
identification. Whether that bride reads Maria, Susanna, or a double name is
unresolved and does not affect the verdict; the entry detail above rests on
machine OCR of a two-page Hungarian spread and has not been read by eye.

**A candidate examined and rejected.** A separate marriage exists: Josephus
Karlik and a Susanna Sliocsan/Szliacsan, 8 January 1890, Liszkófalva
(`1:1:6N9N-WX4H`), the bride stated as aged 44 (implying birth c. 1845-46). It
is tempting to read this as the subject widowed and remarried. It is not her:
the Ludovica Janetzky baptism of 4 October 1891 names the same
Janeczky/Szliacsan couple, and a woman who remarried in January 1890 is not
bearing Janeczky children in late 1891. Two different women.

**What would change the verdict.** Showing that the b. 1842 candidate fits the
Janeczky family better. She has not been individually worked up. The
age-elimination sweep above is the load-bearing analysis; re-run it rather than
re-litigating the missing parentage statement.
