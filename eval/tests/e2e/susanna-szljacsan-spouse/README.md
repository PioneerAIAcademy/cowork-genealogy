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

**RESOLVED 2026-08-03 — true match, with the identity link held as probable rather than proved.** This fixture came from a hint batch (`filtered-list-samples.csv` row 29, flags `adds_spouse`/`adds_daughter`, confidence 3) in which roughly half the hint records are false matches. The adjudication kept `f1` (husband Joannes Janeczky) and `f2` (daughter Susanna, baptized about 1884) as originally transcribed, and **added `f3`**, a required finding that the agent must qualify the identity link instead of asserting it. That third finding is now the calibration point of the fixture.

**What confirmed the hint's content.** The hint record (`1:1:KHQN-MSB`, mother's persona `1:1:KHQN-MSY`) is genuine and its transcription was accurate. The couple Joannes Janeczky and Susanna Szliacsan of Lisková is corroborated by four further indexed baptisms in the same parish, independent of the hint: Joannes 1875 (`1:1:KHQN-VGS`), Maria Janecsky Hrbolec 29 Oct 1882 (`1:1:KHQN-MWR`), Anna 4 Mar 1889 (`1:1:KHQN-RFY`), and Ludovica Janetzky 4 Oct 1891 (`1:1:KHQN-Q3X`). A childbearing span of 1875-1891 fits a woman christened in 1850 at ages 25-41.

**Why the identity is not proved.** No entry in the series — not the hint, not the other four — records the mother's age, parentage, or residence, so none of them distinguishes her from another parishioner of the same name. Lisková also held several contemporaneous Susanna Szliacsans — the wife of Andreas Ňemcsek Hluchi (children 1861, 1867), the wife of Josephus Blaskó (children 1890, 1894, 1895), and Susanna Szliacsan Hlinka (b. 1858, d. 6 Dec 1892) — so the elimination sweep that would have settled it by exhaustion is unavailable. Each of those women is tied to a different husband, which leaves the 1850 Susanna the best available fit but not the only possible one.

**The couple's marriage record is indexed, and it does not settle the identity.** Do not repeat the search that missed it: the bride is indexed under the given name **Maria**, so a search on `givenName: Susanna` returns nothing. The entry is Joannes Janeczky (b. 1853) and **Maria Szliancsan (b. 1850)**, married **8 February 1875** at Liszková — the record read via `record_search` with the spouse-given-name filter dropped, image `3:1:33S7-9RQ4-9HLG`, entry 12 on the page. Two things follow. First, the 1875 Liszkófalva marriage register **has no parents column**: its printed headers run *name and religion* | *civil status, origin and residence* (`Polgári állása, származása 's lakhelye`) | witnesses | officiant | notes, with `Locus Originis et Dom.` on the facing page. So the record class that would normally carry the bride's parentage demonstrably does not carry it here, which is what makes `f3`'s premise structural rather than merely an absence of evidence. Second, the given name **Maria** where every child's baptism says **Susanna** is a live and unresolved question — one woman under a double name (Maria Susanna, routine in these registers), two different Szliacsan brides, or an indexing error. Nothing located so far distinguishes those.

**2026-08-04 — genealogist review confirms the adjudication.** A genealogist reviewed the evidence and endorsed the verdict unchanged: **true match on content, identity probable but not proved.** The reasoning of record: the baptisms consistently document one Joannes Janeczky × Susanna Szliacsan couple with children 1875-1891 including the 1884 daughter Susanna, but no record identifies the mother by parentage, age, or any uniquely identifying detail, and several contemporaneous women of that name were in the parish — not enough to prove she is the 1850-born Susanna. The Karlik marriage was confirmed a false trail on two independent grounds (the stated age already points to a woman born c. 1845-46, and Ludovica's October 1891 baptism is inconsistent with a January 1890 remarriage). **Do not let the hedge be grounded on Karlik:** the uncertainty comes from the absence of evidence tying the Janeczky wife to the 1850-born Susanna, not from that record. An agent reaching "probable" via the Karlik age gap has the right tier for the wrong reason — which is how the 2026-08-03 run scored `f3` partial rather than true. The review also declined to treat the indexed bride name "Maria Szliancsan" as decisive without a manual reading of the image, so the question below stands open.

**Unverified OCR — needs a human read before anyone hardens this.** The marriage-entry details above come from machine OCR (`image_transcribe`, `qwen/qwen3-vl-235b-a22b-instruct`) of a two-page 1875 Hungarian spread, and the output visibly garbles proper names (Liszkófalva → "Löckova", Lisková → "Libotin", Szliancsan → "Selancran") and bleeds columns together. The **column structure** is reliable and the existence of entry 12 is reliable; no individual name string in it is. Someone should open the image and read entry 12 directly — above all whether the bride reads Maria, Susanna, or a double name — before this paragraph is treated as settled or `f3` is reworded on the strength of it.

**Note the indexed dates are year-only.** The index gives bare "1884" for the hint and bare "1875" for the eldest child, while Maria's and Anna's entries carry exact days. Do not tighten `f2` past "about 1884" without reading the manuscript image — an earlier draft adjudication asserted "27 April 1884" and "17 November 1875", and neither date appears in the index.

**Live-tree caveat for whoever runs this.** An unlinked duplicate cluster exists in the live FamilySearch tree — `LDK6-FV4` (Susanna Szliacsan) with `LDK6-FV7` (Joannes Janeczky) and daughter `LDK6-FV3` (Anna, chr. 4 Mar 1889) — sourceless record-stub profiles that are **not** connected to `LDK6-6SH`, which is why they are correctly absent from `starting-tree.gedcomx.json`. The starting tree is faithful to the snapshot; this is a scoring consideration, not a fixture defect. An agent could in principle reach "Joannes Janeczky" by finding that island rather than by adjudicating the hint record, so when grading a run, check *how* it got there.

**What would still prove it.** Not the marriage record — see above; that avenue is closed, because this parish's 1875 register records no parentage. What remains: (a) resolving the Maria/Susanna given-name question on the marriage image, which would at least establish whether the 1875 bride is our subject at all; (b) a death or burial entry for the Janeczky wife giving an age or parents, which would fix her birth year against the 1850 christening; (c) the Ludovica 1891 baptism (`1:1:KHQN-Q3X`) read from the original image rather than the index, in case it carries a house number or the mother's age that the index drops. House numbers are the most promising thread — the 1884 baptism image gives house no. 115, so the register does track them, and matching house numbers across entries would tie the family to one household.

**A known false trail, recorded so the next run isn't graded as clever for finding it.** A separate marriage exists: Josephus Karlik and a Susanna Sliocsan/Szliacsan, **8 January 1890**, Liszkófalva (`1:1:6N9N-WX4H`), whose bride is stated as **aged 44** — implying birth c. 1845-46, five years off the subject's 1850 christening. It is tempting to build a widow-remarriage narrative on it (Janeczky wife in 1884, widowed, remarried Karlik in 1890). **That narrative is refuted by the Ludovica Janetzky baptism of 4 October 1891**, which names the same Janeczky/Szliacsan couple: a woman who remarried in January 1890 is not bearing Janeczky children in late 1891. An agent that anchors its identity reasoning on the Karlik record has reached a defensible-sounding conclusion from the wrong evidence, and the age discrepancy it registers is very likely a false conflict between two different women. The 2026-08-03 run did exactly this — see `eval/runlogs/e2e/susanna-szljacsan-spouse/run-2026-08-03_22-34-20.*`.
