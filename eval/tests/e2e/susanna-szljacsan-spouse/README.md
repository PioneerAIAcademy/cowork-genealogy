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

**RESOLVED 2026-08-04 — true match. Option (a): findings kept as transcribed.** This fixture came from a hint batch (`filtered-list-samples.csv` row 29, flags `adds_spouse`/`adds_daughter`, confidence 3) in which roughly half the hint records are false matches. This one is true. `f1` (husband Joannes Janeczky) and `f2` (daughter Susanna, baptized about 1884) stand as originally transcribed, and nothing was added.

**The reasoning of record, and why "unproven" was rejected.** An earlier pass held the identity at *probable, not proved*, on the grounds that no surviving record states the mother's parentage or age. That was overturned on review: absence of a confirming document is the **normal condition** of 19th-century Slovak parish research, not a reason to withhold an identification. The test is whether anything *competes*. Once ages are applied to the candidate pool, nothing does — six of the eight same-named candidates are chronologically impossible, and the seventh would have been bearing a child at 49. The subject fits a 25→41 childbearing span, was baptized in that parish, and no evidence places her elsewhere, married to another man, or dead before 1891. Right name, right parish, right generation, best age fit, no viable alternative, no contradicting evidence — an identification a competent genealogist accepts and cites.

**What would change it back:** showing that the b. 1842 woman fits the Janeczky family better. That candidate has not been individually worked up. The age-elimination sweep above is the load-bearing analysis behind option (a); anyone doubting the verdict should re-run it rather than re-litigate the absence of a parentage statement.

**What confirmed the hint's content.** The hint record (`1:1:KHQN-MSB`, mother's persona `1:1:KHQN-MSY`) is genuine and its transcription was accurate. The couple Joannes Janeczky and Susanna Szliacsan of Lisková is corroborated by four further indexed baptisms in the same parish, independent of the hint: Joannes 1875 (`1:1:KHQN-VGS`), Maria Janecsky Hrbolec 29 Oct 1882 (`1:1:KHQN-MWR`), Anna 4 Mar 1889 (`1:1:KHQN-RFY`), and Ludovica Janetzky 4 Oct 1891 (`1:1:KHQN-Q3X`). A childbearing span of 1875-1891 fits a woman christened in 1850 at ages 25-41.

**The same-name pool, and why it does not defeat the identification.** No entry in the series records the mother's age, parentage, or residence, and Lisková did hold several contemporaneous Susanna Szliacsans — the wife of Andreas Ňemcsek Hluchi (children 1861, 1867), the wife of Josephus Blaskó (children 1890, 1894, 1895), and Susanna Szliacsan Hlinka (b. 1858, d. 6 Dec 1892) among them. Each is tied to a different husband, and each is excluded on age or on an incompatible marriage once the 1875-1891 Janeczky childbearing span is applied. The pool is therefore a reason to *do* the elimination, not a reason to stop short of the conclusion.

**The couple's marriage record is indexed, and it does not settle the identity.** Do not repeat the search that missed it: the bride is indexed under the given name **Maria**, so a search on `givenName: Susanna` returns nothing. The entry is Joannes Janeczky (b. 1853) and **Maria Szliancsan (b. 1850)**, married **8 February 1875** at Liszková — the record read via `record_search` with the spouse-given-name filter dropped, image `3:1:33S7-9RQ4-9HLG`, entry 12 on the page. Two things follow. First, the 1875 Liszkófalva marriage register **has no parents column**: its printed headers run *name and religion* | *civil status, origin and residence* (`Polgári állása, származása 's lakhelye`) | witnesses | officiant | notes, with `Locus Originis et Dom.` on the facing page. So the record class that would normally carry the bride's parentage demonstrably does not carry it here — which is exactly why its absence cannot be the bar to identification: the document that would supply the statement never recorded it for anyone in this parish. Second, the given name **Maria** where every child's baptism says **Susanna** is a live and unresolved question — one woman under a double name (Maria Susanna, routine in these registers), two different Szliacsan brides, or an indexing error. Nothing located so far distinguishes those, and it does not affect the verdict either way.

**Review history — two genealogist passes, and why the second governs.** A first pass endorsed *true match on content, identity probable but not proved*, and a hedge finding (`f3`) was written to require the agent to qualify the identification. Both were withdrawn 2026-08-04. Two reasons. Substantively, the age-elimination analysis above leaves no viable competitor, so the identification stands. Structurally, "true but only probable" is not one of the three outcomes this fixture genre supports — the choices are (a) true match, keep the findings; (b) different answer, edit them; (c) no findable answer, use a `polarity: "avoid"` guard plus a paired required finding. A hedge finding bolted onto (a) was a fourth option with no slot, and it graded the agent for hedging on a question the evidence answers. `f3` has been removed; do not reintroduce it without moving the fixture to outcome (c).

**Unverified OCR — needs a human read before anyone hardens this.** The marriage-entry details above come from machine OCR (`image_transcribe`, `qwen/qwen3-vl-235b-a22b-instruct`) of a two-page 1875 Hungarian spread, and the output visibly garbles proper names (Liszkófalva → "Löckova", Lisková → "Libotin", Szliancsan → "Selancran") and bleeds columns together. The **column structure** is reliable and the existence of entry 12 is reliable; no individual name string in it is. Someone should open the image and read entry 12 directly — above all whether the bride reads Maria, Susanna, or a double name — before this paragraph is treated as settled.

**Note the indexed dates are year-only.** The index gives bare "1884" for the hint and bare "1875" for the eldest child, while Maria's and Anna's entries carry exact days. Do not tighten `f2` past "about 1884" without reading the manuscript image — an earlier draft adjudication asserted "27 April 1884" and "17 November 1875", and neither date appears in the index.

**Live-tree caveat for whoever runs this.** An unlinked duplicate cluster exists in the live FamilySearch tree — `LDK6-FV4` (Susanna Szliacsan) with `LDK6-FV7` (Joannes Janeczky) and daughter `LDK6-FV3` (Anna, chr. 4 Mar 1889) — sourceless record-stub profiles that are **not** connected to `LDK6-6SH`, which is why they are correctly absent from `starting-tree.gedcomx.json`. The starting tree is faithful to the snapshot; this is a scoring consideration, not a fixture defect. An agent could in principle reach "Joannes Janeczky" by finding that island rather than by adjudicating the hint record, so when grading a run, check *how* it got there.

**What would strengthen the citation further** (not required for the verdict, which stands on the elimination above): (a) resolving the Maria/Susanna given-name question on the marriage image; (b) a death or burial entry for the Janeczky wife giving an age or parents, fixing her birth year against the 1850 christening; (c) the Ludovica 1891 baptism (`1:1:KHQN-Q3X`) read from the original image rather than the index, in case it carries a house number or the mother's age that the index drops. House numbers are the most promising thread — the 1884 baptism image gives house no. 115, so the register does track them, and matching house numbers across entries would tie the family to one household.

**A known false trail, recorded so the next run isn't graded as clever for finding it.** A separate marriage exists: Josephus Karlik and a Susanna Sliocsan/Szliacsan, **8 January 1890**, Liszkófalva (`1:1:6N9N-WX4H`), whose bride is stated as **aged 44** — implying birth c. 1845-46, five years off the subject's 1850 christening. It is tempting to build a widow-remarriage narrative on it (Janeczky wife in 1884, widowed, remarried Karlik in 1890). **That narrative is refuted by the Ludovica Janetzky baptism of 4 October 1891**, which names the same Janeczky/Szliacsan couple: a woman who remarried in January 1890 is not bearing Janeczky children in late 1891. An agent that anchors its identity reasoning on the Karlik record has reached a defensible-sounding conclusion from the wrong evidence, and the age discrepancy it registers is a false conflict between two different women. The 2026-08-03 run did exactly this — it reached tier *probable* by way of the Karlik age gap and registered it as an unresolved identity conflict (`c_001`) — see `eval/runlogs/e2e/susanna-szljacsan-spouse/run-2026-08-03_22-34-20.*`. That is no longer a graded finding, but it remains the most instructive thing in that run log: the reasoning is wrong even though the tier sounded cautious.
